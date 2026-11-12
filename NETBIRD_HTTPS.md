# Private NetBird access and HTTPS for izLearn

The intended browser address is **`https://izlearn.internal.company.com`**. The website runs in `izlearn-vm` and is reachable only by authorized NetBird peers. Replace `company.com` if it is a placeholder for the real company domain. Run VM commands inside the VM, not on the physical host.

This guide uses your existing NetBird DNS and **one temporary public TXT record at Namecheap** to obtain a free Let's Encrypt certificate. It needs no DuckDNS account, public website A record, static public IP, or router forwarding.

**Renewal is manual with this setup.** DNS-01 requires a fresh TXT value for each renewal. It is suitable for the one-month training period if someone owns the renewal task and checks expiry. Do not assume that installing Certbot makes this certificate renew automatically. For unattended renewal later, see [long-term options](#6-long-term-renewal-options).

## 1. Verify the private website name

In the NetBird administrative panel, use the zone `internal.company.com` with an A record named `izlearn` pointing to the VM's NetBird IP, `100.85.198.38`. This gives `izlearn.internal.company.com`. On a **remote Windows PC connected to NetBird**:

```powershell
Resolve-DnsName izlearn.internal.company.com
Test-NetConnection izlearn.internal.company.com -Port 80
curl.exe -I http://izlearn.internal.company.com/
```

Expect the VM IP, a successful TCP connection, and an HTTP response. If the old broad `company.com` NetBird zone is still distributed, disable it only after this narrow name works. Confirm the self-hosted NetBird management name and other company services still resolve afterward.

Keep this website A record in **NetBird DNS**, not in public Namecheap DNS. Publishing `100.85.198.38` at Namecheap might work for some NetBird-connected clients, but some resolvers filter public names that return shared/private addresses. It also publishes the private hostname and address, and a VM peer re-registration can change the NetBird IP. The public Namecheap **TXT challenge** in step 2 is separate; it proves domain ownership for HTTPS without changing where users resolve the website.

For the temporary HTTP test, add `http://izlearn.internal.company.com` to `FRONTEND_ORIGIN` in the VM's `~/izlearn/.env`. Keep other origins still used, separated by commas. Apply the change:

```bash
cd ~/izlearn
sudo docker compose -f docker-compose.server.yml up -d --force-recreate backend
```

`FRONTEND_ORIGIN` is the browser API origin allowlist. It does not create a DNS record or redirect traffic.

## 2. Request the certificate

On the **VM**, install Certbot and start a DNS-01 certificate request. Replace `admin@company.com` with a real email address you control. The `-m` option is a Certbot/ACME account contact field; it is **not** the izLearn admin login, and the mailbox does not have to be under `company.com`. Let's Encrypt no longer sends certificate-expiry reminders, so use the expiry check in step 5.

```bash
sudo apt update
sudo apt install -y certbot
sudo certbot certonly --manual --preferred-challenges dns \
  --agree-tos -m admin@company.com \
  -d izlearn.internal.company.com
```

Certbot will show a **TXT value** and pause. Leave that terminal open. In **Namecheap → Advanced DNS** for `company.com`, add:

| Field | Value |
| --- | --- |
| Type | TXT Record |
| Host | `_acme-challenge.izlearn.internal` |
| Value | The exact TXT value shown by Certbot |

Owning `company.com` authorizes you to create subdomains, but Let's Encrypt verifies control by looking up this TXT record in the domain's **authoritative public DNS**. If Namecheap also hosts your DNS records, add it there. If the domain merely was purchased through Namecheap but its nameservers point elsewhere, add the TXT record at that DNS provider. This public TXT does not expose the website or point users to the VM. Check propagation from Windows against a **public resolver**:

```powershell
Resolve-DnsName _acme-challenge.izlearn.internal.company.com -Type TXT -Server 1.1.1.1
```

Only after the new value appears, return to Certbot and press Enter. Confirm it reports success and writes a certificate under `/etc/letsencrypt/live/izlearn.internal.company.com/`. The TXT record can be removed after successful issuance. [Let's Encrypt DNS-01](https://letsencrypt.org/docs/challenge-types/), [Namecheap host records](https://www.namecheap.com/support/knowledgebase/article.aspx/434/2237/how-do-i-set-up-host-records-for-a-domain/).

## 3. Put the certificate where Docker can read it

On the VM:

```bash
sudo install -d -m 700 /etc/ssl/izlearn
sudo install -m 644 /etc/letsencrypt/live/izlearn.internal.company.com/fullchain.pem /etc/ssl/izlearn/fullchain.pem
sudo install -m 600 /etc/letsencrypt/live/izlearn.internal.company.com/privkey.pem /etc/ssl/izlearn/privkey.pem
```

Keep the private key out of Git, chat, and `.env`. The frontend Docker container reads these files through a read-only mount.

## 4. Enable HTTPS in Docker

Confirm `docker-compose.server.https.yml` and `frontend/nginx.https.conf` exist in `~/izlearn`. If needed, update the checkout yourself using [KVM_DEPLOYMENT_PLAYBOOK.md](KVM_DEPLOYMENT_PLAYBOOK.md). No database migration or bootstrap is needed for the HTTPS overlay.

In `~/izlearn/.env`, include the exact HTTPS browser origin. During the transition, keep the HTTP origin only if you still use it:

```ini
FRONTEND_ORIGIN=http://izlearn.internal.company.com,https://izlearn.internal.company.com
```

Validate and recreate the two services that need the new settings:

```bash
cd ~/izlearn
sudo docker compose -f docker-compose.server.yml -f docker-compose.server.https.yml config -q
sudo docker compose -f docker-compose.server.yml -f docker-compose.server.https.yml up -d --force-recreate backend frontend
sudo docker compose -f docker-compose.server.yml -f docker-compose.server.https.yml exec frontend nginx -t
sudo docker compose -f docker-compose.server.yml -f docker-compose.server.https.yml ps
```

The overlay adds TCP 443, mounts the certificate, and redirects HTTP to HTTPS. From a remote NetBird PC:

```powershell
Test-NetConnection izlearn.internal.company.com -Port 443
curl.exe -I https://izlearn.internal.company.com/
curl.exe https://izlearn.internal.company.com/api/health
```

Sign in through `https://izlearn.internal.company.com`, open a PDF, and perform a normal API action. The browser should show no certificate warning. After HTTPS works, remove unused HTTP origins from `FRONTEND_ORIGIN` and recreate the backend.

## 5. Restrict access and plan manual renewal

In NetBird, give the training-user group access to the VM peer on **TCP 443**. Keep separate administrator policies for SSH and the physical host. Review existing policies before removing a permissive default policy. NetBird DNS distributes the private name; [access policies](https://docs.netbird.io/manage/access-control/manage-network-access) determine who can connect. Keep MongoDB, Redis, and the backend port unpublished. The VM's [web guard](NETBIRD_WEB_GUARD.md) already blocks TCP 80 and 443 arriving through its ordinary network interface; repeat its tests on port 443 after enabling HTTPS.

Assign a named operator to renew the certificate **at least 30 days before it expires**. Check expiry monthly on the VM:

```bash
sudo certbot certificates
sudo openssl x509 -in /etc/ssl/izlearn/fullchain.pem -noout -dates -subject
```

For renewal, repeat the DNS challenge with a **new** TXT value:

```bash
sudo certbot certonly --manual --preferred-challenges dns \
  --cert-name izlearn.internal.company.com --force-renewal \
  -d izlearn.internal.company.com
```

After Certbot succeeds, install the new files and reload the frontend:

```bash
sudo install -m 644 /etc/letsencrypt/live/izlearn.internal.company.com/fullchain.pem /etc/ssl/izlearn/fullchain.pem
sudo install -m 600 /etc/letsencrypt/live/izlearn.internal.company.com/privkey.pem /etc/ssl/izlearn/privkey.pem
cd ~/izlearn
sudo docker compose -f docker-compose.server.yml -f docker-compose.server.https.yml exec -T frontend nginx -s reload
```

Verify the browser presents the new certificate. Do not leave the old TXT value in place when adding the new one. For future application updates, use **both Compose files** when recreating the frontend so its HTTPS configuration remains active.

## 6. Long-term renewal options

The single TXT record is simplest for the training period, but **it cannot renew unattended**. If automatic renewal becomes a requirement, the established route is to use a DNS provider with an API that the VM can access reliably. For example, IT could move the company's authoritative DNS to a provider with API tokens and then use Certbot or another ACME client for automatic DNS-01 updates. That move requires checking and copying **all existing DNS records**, including mail and NetBird management records, before switching nameservers; treat it as a separate planned change.

Namecheap's own DNS API requires whitelisting the caller's public IPv4 address, which makes renewal unreliable when the VM exits through a changing CGNAT address. [Namecheap API requirements](https://www.namecheap.com/support/api/intro/). A newer one-record automatic method, DNS-PERSIST-01, is supported by Google Trust Services, but it is still based on a draft specification and needs a Google Cloud ACME account. For this rollout, use the manual method above rather than depending on that newer protocol. [Google's DNS-PERSIST-01 announcement](https://developers.google.com/public-key-infrastructure/updates/september2026-dns-persist-01).
