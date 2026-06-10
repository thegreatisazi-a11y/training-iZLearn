# izLearn — Going Live for Free (Step‑by‑Step)

This guide takes the izLearn LMS from your laptop to a **public HTTPS website**, using
**only free services** and the best free option at each step.

## Why this stack (and why these choices)

izLearn is a Docker stack (React frontend + Node/Express backend + **PostgreSQL** +
**Redis**), and it **stores uploaded files on disk** (training materials, certificates,
backups) and bundles **Chromium** for PDF generation. That means it needs:

- A host that can run `docker compose` **with persistent storage** (uploaded files must
  survive restarts), and
- Enough RAM (~2 GB+) for Postgres + Redis + Node + Chromium.

Free “app platforms” (Render/Railway free tiers, etc.) either **wipe the filesystem on
every deploy** (you’d lose uploaded materials), expire the free database after ~90 days,
or don’t give enough RAM. So the best **free‑forever** choice is a small **Always‑Free
cloud VM** running the existing `docker compose`, with free HTTPS in front.

| Need | Best free choice | Cost |
|------|------------------|------|
| Server (VM) | **Oracle Cloud — Always Free** (Ampere ARM, up to 4 CPU / 24 GB RAM, 200 GB disk, **never expires**) | Free |
| Domain name | **DuckDNS** (`yourname.duckdns.org`) | Free |
| HTTPS / TLS cert | **Caddy** (automatic Let’s Encrypt) | Free |
| Outgoing email (optional) | **Brevo** SMTP (300 emails/day) | Free |
| Source hosting | **GitHub** private repo | Free |

> **Heads‑up:** Oracle requires a credit/debit card **for identity verification only** at
> sign‑up. Always‑Free resources are **never charged**. If you don’t want to use Oracle,
> see [Alternatives](#alternatives) at the end.

> **Time required:** ~45–60 minutes the first time.

---

## What you’ll end up with

```
Browser ──HTTPS──▶ Caddy (:443, auto TLS) ──▶ frontend container (nginx :80)
                                                   │  /api/* proxied to
                                                   ▼
                                              backend container (:4000)
                                                   │
                                       Postgres + Redis + file storage (Docker volumes)
```

---

## Part 0 — One‑time prep on your own PC

1. **Put the code on GitHub** (so the server can pull it). In the project folder:
   ```bash
   git add -A
   git commit -m "Prepare for deployment"
   ```
   Create a **private** repo on GitHub, then:
   ```bash
   git remote add origin https://github.com/<you>/izlearn.git   # skip if a remote already exists
   git push -u origin HEAD
   ```
   > No GitHub? You can instead copy the folder to the server later with `scp -r` — see
   > the note in [Part 3](#part-3--get-the-code-onto-the-server).

---

## Part 1 — Create the free server (Oracle Cloud Always Free)

1. Sign up at **https://www.oracle.com/cloud/free/** → “Start for free”. Choose your
   country, verify email, and add a card (verification only). Pick a **Home Region** close
   to your users — you can’t change it later.
2. In the console: **☰ Menu → Compute → Instances → Create instance**.
3. Configure:
   - **Name:** `izlearn`
   - **Image:** *Canonical Ubuntu 22.04*
   - **Shape:** click **Change shape → Ampere (ARM)** → `VM.Standard.A1.Flex` →
     set **2 OCPUs** and **12 GB RAM** (well within the Always‑Free limit). *(If Ampere
     capacity is unavailable in your region, retry later or pick another region.)*
   - **Boot volume:** leave default (~50 GB is plenty; up to 200 GB is free).
4. **SSH keys:** choose **Generate a key pair** and **download the private key** (e.g.
   `izlearn.key`). Keep it safe.
5. Click **Create**. When it’s **Running**, copy the **Public IP address** (e.g.
   `140.x.x.x`).
6. Connect from your PC (Git Bash / macOS / Linux / Windows PowerShell):
   ```bash
   chmod 400 izlearn.key            # macOS/Linux only
   ssh -i izlearn.key ubuntu@<PUBLIC_IP>
   ```

---

## Part 2 — Install Docker on the server

Run these on the server (one block):

```bash
sudo apt-get update && sudo apt-get upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker        # apply the new group without logging out
docker --version && docker compose version
```

---

## Part 3 — Get the code onto the server

```bash
sudo apt-get install -y git
git clone https://github.com/<you>/izlearn.git
cd izlearn
```
> Private repo? When prompted, use a **GitHub Personal Access Token** as the password
> (GitHub → Settings → Developer settings → Tokens), or set up an SSH deploy key.

> **No GitHub?** From your PC instead:
> `scp -i izlearn.key -r f:/training-tran-main ubuntu@<PUBLIC_IP>:~/izlearn`

---

## Part 4 — Configure secrets (`.env`)

The stack reads a single `.env` at the project root. Create it from the template and set
**strong, unique** values:

```bash
cp .env.example .env

# Generate two long random secrets and a DB password:
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
```

Open the file (`nano .env`) and set every value. It must end up looking like:

```ini
# PostgreSQL
POSTGRES_USER=izlearn
POSTGRES_PASSWORD=<paste the generated 32-char password>
POSTGRES_DB=izlearn

# Auth secrets (paste the generated values)
JWT_ACCESS_SECRET=<paste 64-char hex>
JWT_REFRESH_SECRET=<paste a DIFFERENT 64-char hex>

# Public URL of the site (set this to your DuckDNS domain from Part 6, with https://)
FRONTEND_ORIGIN=https://YOURNAME.duckdns.org

# First admin account (you will log in with these, then change the password)
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=<a strong password you choose>
SEED_ADMIN_EMAIL=you@example.com
```

Save and exit (in nano: `Ctrl‑O`, `Enter`, `Ctrl‑X`).

> Keep `.env` secret — it’s already in `.gitignore`, so it is **not** committed.

---

## Part 5 — Open the firewall (the #1 gotcha on Oracle)

Oracle blocks inbound traffic in **two** places. You must open **80** and **443** in both.

**5a. Cloud firewall (OCI console):**
- **☰ → Networking → Virtual Cloud Networks →** your VCN **→ Security Lists →** the
  *Default Security List*.
- **Add Ingress Rules** (do this twice):
  - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination port **80**
  - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination port **443**

**5b. Server firewall (Ubuntu ships with restrictive iptables):**
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## Part 6 — Free domain (DuckDNS)

A domain is required for free HTTPS certificates.

1. Go to **https://www.duckdns.org**, sign in (Google/GitHub), and create a subdomain,
   e.g. `yourname` → gives you **`yourname.duckdns.org`**.
2. In the **current ip** box, enter your server’s **Public IP** and click **update ip**.
3. Make sure `FRONTEND_ORIGIN` in `.env` matches: `https://yourname.duckdns.org`.

> Optional auto‑update (keeps DNS correct if the IP ever changes): add a cron job using
> the token shown on the DuckDNS page —
> `*/5 * * * * curl -s "https://www.duckdns.org/update?domains=yourname&token=<TOKEN>&ip="`

---

## Part 7 — Keep the app private behind HTTPS

So only Caddy is exposed publicly, bind the frontend container to localhost. Edit the
ports line for the **frontend** service in `docker-compose.yml`:

```yaml
  frontend:
    ...
    ports:
      - '127.0.0.1:8081:80'     # was '8081:80'
```

(Use `nano docker-compose.yml`.) Now port 8081 is reachable **only** by Caddy on the same
machine, never from the internet.

---

## Part 8 — Launch the stack

```bash
docker compose up -d --build
```

First build takes a few minutes (it compiles the frontend and installs Chromium). On
start the backend **automatically runs database migrations and seeds the admin account**.

Check it’s healthy:
```bash
docker compose ps
docker compose logs -f backend     # Ctrl-C to stop watching; look for "listening on 4000"
curl -I http://127.0.0.1:8081      # should return HTTP/1.1 200
```

---

## Part 9 — Free automatic HTTPS (Caddy)

Install Caddy on the host:
```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Configure it — replace the file with your domain:
```bash
sudo nano /etc/caddy/Caddyfile
```
```caddy
yourname.duckdns.org {
    encode gzip
    reverse_proxy 127.0.0.1:8081 {
        # allow large training-material uploads
        flush_interval -1
    }
}
```
Reload and Caddy will fetch a free Let’s Encrypt certificate automatically:
```bash
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager     # should be active (running)
```

🎉 Open **https://yourname.duckdns.org** in a browser — the site is live with HTTPS.

---

## Part 10 — First login & essential setup

1. **Log in** with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` from your `.env`.
2. **Change the admin password** immediately (top‑right user menu → Change Password).
3. **Set your e‑signature password** (Profile/account settings). This is **required** to
   Publish, Archive, Revise topics, change passing scores, and assign bundles — the
   controlled actions all demand a two‑component e‑signature.
4. **(Optional) Enable email notifications** — free via **Brevo**:
   - Create a free account at **https://www.brevo.com**, then **SMTP & API → SMTP**.
   - In izLearn: **System Setup / System Config**, set:
     - `smtp.host` = `smtp-relay.brevo.com`
     - `smtp.port` = `587`
     - `smtp.user` = your Brevo SMTP login
     - `smtp.password` = your Brevo SMTP **key**
     - `smtp.from` = `izLearn <you@yourdomain>`
   - *(Gmail works too: host `smtp.gmail.com`, port `587`, and a Google “App Password”.)*
5. Create your real roles, departments, designations, users, topics and bundles.

---

## Maintenance

**Deploy updates** (after pushing new code to GitHub):
```bash
cd ~/izlearn
git pull
docker compose up -d --build      # migrations re-run automatically and safely
```

**View logs:** `docker compose logs -f backend`

**Restart everything:** `docker compose restart`

**Backups (your data lives in Docker volumes):**
- Database snapshot:
  ```bash
  docker compose exec -T postgres pg_dump -U izlearn izlearn > backup_$(date +%F).sql
  ```
- Uploaded files live in the `storage` volume; the app also has a built‑in Backup feature
  (Admin → Backup). For off‑site safety, periodically copy `backup_*.sql` to your PC:
  `scp -i izlearn.key ubuntu@<PUBLIC_IP>:~/izlearn/backup_*.sql .`

**Auto‑restart on reboot:** already handled — every service uses
`restart: unless-stopped`, and Caddy runs as a systemd service.

---

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| Browser can’t reach the site | Re‑check **Part 5** (both OCI ingress rules **and** the iptables rules) and that DuckDNS points to the current public IP. |
| HTTPS cert fails to issue | Port **80** must be open (Let’s Encrypt validates over it). Confirm DNS resolves: `dig yourname.duckdns.org`. Check `sudo journalctl -u caddy -n 50`. |
| Backend keeps restarting | `docker compose logs backend`. Usually a missing/blank value in `.env` (in production, missing `DATABASE_URL`/JWT secrets hard‑fail at boot). |
| “Ampere capacity unavailable” at instance create | Try a different Availability Domain, retry later, or temporarily use a smaller A1 (1 OCPU/6 GB) — still free. |
| Uploads fail for large files | Caddy streams by default; ensure you didn’t add a size limit, and the frontend nginx already allows 1 GB. |
| Out of disk over time | `docker system prune -af` to clear old build layers (does **not** touch your data volumes). |

---

## Alternatives

- **You already own a domain + use Cloudflare:** skip DuckDNS/Caddy and run a free
  **Cloudflare Tunnel** (`cloudflared`) to `localhost:8081` — gives HTTPS with **no open
  inbound ports** at all.
- **Don’t want Oracle:** **Google Cloud** has an always‑free `e2-micro`, but its **1 GB
  RAM is too small** for this stack (Postgres + Redis + Chromium). **AWS/Azure** free tiers
  **expire after 12 months**. **Render/Railway** free tiers don’t give **persistent disk**,
  so uploaded materials would be lost — not suitable for this app.
- **Internal/LAN only (no internet host):** run `docker compose up -d --build` on any
  always‑on PC and access it at `http://<that-PC-IP>:8081` (add that IP to
  `FRONTEND_ORIGIN`). No domain or HTTPS needed for a closed network.

---

### Quick reference — full first deploy

```bash
# on the server, after Docker is installed and firewall opened
git clone https://github.com/<you>/izlearn.git && cd izlearn
cp .env.example .env && nano .env          # set strong secrets + FRONTEND_ORIGIN
nano docker-compose.yml                     # frontend ports -> '127.0.0.1:8081:80'
docker compose up -d --build
# then install Caddy (Part 9) and point DuckDNS at the public IP
```
