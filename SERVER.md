# izLearn — On-Premises Server Deployment (intranet)

This guide runs the **whole** izLearn app on a single on-prem server using Docker:
MongoDB (self-hosted, single-node replica set), Redis, the backend API, and an
nginx frontend that serves the SPA and proxies `/api`.

It is the **self-hosted** counterpart to the cloud guide in
[`DEPLOYMENT.md`](./DEPLOYMENT.md) (Vercel + Render + Atlas). The two are
independent — the files used here (`docker-compose.server.yml`,
`.env.server.example`) are additive and do not affect the local or cloud setups.

**Target setup this guide assumes**
- Host: an on-prem **Windows Server**, with a **Hyper-V Ubuntu Server VM** that
  runs Docker. (Docker runs inside the Linux VM so it auto-starts on boot as a
  service and survives reboots unattended — see "Why a VM" below.)
- Access: **intranet only**.
- Address: an internal **domain name** (e.g. `izlearn.yourco.local`).
- TLS: **HTTP for the initial pilot**, HTTPS added later (last section).
- Database: **self-hosted MongoDB** (in a container), not Atlas.

```
 Office LAN ──http://izlearn.yourco.local──▶  Ubuntu VM (Hyper-V on the Windows Server)
                                              ┌──────────────────────────────────────┐
                                              │ Docker (docker-compose.server.yml)     │
                                              │   nginx (frontend) :80                 │
                                              │     ├── serves the React SPA           │
                                              │     └── /api ─▶ backend:4000           │
                                              │              ├─▶ mongo  (replica set)  │
                                              │              ├─▶ redis  (job queues)   │
                                              │              └─▶ storage volume (files)│
                                              └──────────────────────────────────────┘
```

---

## Why a Linux VM (not Docker directly on Windows)
A server must come back **by itself** after a reboot, with **nobody logged in**.
Docker Desktop on Windows starts when a *user logs into the desktop* — wrong for a
headless server (and it has licensing limits for larger orgs). Running Docker
inside a small **Hyper-V Ubuntu VM** gives you Docker as a real `systemd` service
that starts at boot, no Docker Desktop licensing, and a native Linux filesystem
(which MongoDB prefers). Same `docker compose` workflow either way.

---

## 1. Prepare the Ubuntu VM (one time)
On the Windows Server, create a Hyper-V **Ubuntu Server 22.04+** VM (suggested:
2 vCPU, 4 GB RAM, 60 GB disk — scale up for many users / large files). Set the VM
to **auto-start with the host** (Hyper-V → VM Settings → Automatic Start Action →
*Always start automatically*).

Inside the VM, install Docker Engine + Compose plugin:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # log out/in afterwards so `docker` works without sudo
docker --version && docker compose version
```
Docker Engine installs as a `systemd` service that starts on boot. With
`restart: unless-stopped` on every container, the whole app self-heals after a
reboot.

## 2. Internal DNS
On your Windows DNS (the AD DNS role, typically), add an **A record**:
```
izlearn.yourco.local  ->  <the VM's IP address>
```
Domain-joined PCs will then resolve the name to the VM.

## 3. Get the code onto the VM
```bash
git clone <your-repo-url> izlearn
cd izlearn
```
For updates later: `git pull` (see "Updating" below). Deploying a specific
**git tag** (e.g. `v1.0.0`) rather than a moving branch is recommended for
traceability.

## 4. Create the .env (secrets — never committed)
```bash
cp .env.server.example .env
nano .env
```
Fill in at least:
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — generate with `openssl rand -base64 48`
- `FRONTEND_ORIGIN` — `http://izlearn.yourco.local`
- `SEED_ADMIN_*` — the first admin (change the password after first login)

Leave `DATABASE_URL` and `STORAGE_DRIVER=local` as the template has them (they
already point at the self-hosted Mongo and local file storage).

## 5. Build and start
```bash
docker compose -f docker-compose.server.yml up -d --build
```
First boot: Mongo initialises its replica set, then the backend runs
`prisma db push` (creates indexes) → `seed` (admin + roles) → starts. Watch it:
```bash
docker compose -f docker-compose.server.yml ps
docker compose -f docker-compose.server.yml logs -f backend
```
You're up when the backend logs `izLearn API listening on ...`.

## 6. Firewall
Allow only the web port from the LAN; keep everything else internal.
```bash
sudo ufw allow 80/tcp
sudo ufw enable
```
Mongo (27017), Redis (6379) and the backend (4000) are **not** published to the
host — they live only on Docker's internal network. Don't open them.

## 7. First login
Open `http://izlearn.yourco.local` from a PC on the LAN and sign in with
`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.
1. Change the admin password immediately.
2. **My Profile → set a signature password** (required for e-signed actions:
   publishing a course, role changes, approvals, etc.).
3. Optional hardening in **System Config**: set the IP allowlist
   (`security.allowed_ip_ranges`) to your office subnets, configure SMTP for
   emails, and review the password policy.

---

## Updating to a new version
```bash
cd izlearn
git pull                                              # bring new code
docker compose -f docker-compose.server.yml up -d --build   # rebuild + restart
```
A plain restart will **not** pick up code/schema changes — always use `--build`
after a `git pull`.

## Backups (you own these now — do them)
Two things must be backed up regularly and stored **off the VM**:

1. **Database** (includes the audit trail):
   ```bash
   docker compose -f docker-compose.server.yml exec mongo \
     mongodump --uri="mongodb://mongo:27017/izlearn?replicaSet=rs0" --archive=/data/db/izlearn-$(date +%F).archive
   # then copy the archive off the VM (scp / network share / backup agent)
   ```
2. **Uploaded files volume** (`izlearn-server_storage`) and your **`.env`** —
   back these up too; they are not in git.

Schedule the above with `cron`. Test a restore periodically (see
[`RESTORE.md`](./RESTORE.md)). The in-app backup feature also writes to the
`backups` volume as a convenience.

## Enabling HTTPS later (when you're ready)
On an internal-only domain, **Let's Encrypt usually won't work** (it needs public
DNS). Issue a certificate from your **organisation's internal CA** (e.g. AD
Certificate Services) for `izlearn.yourco.local` — domain-joined PCs already trust
it. Then:
1. Place `fullchain.pem` + `privkey.pem` on the VM (e.g. `/etc/ssl/izlearn/`).
2. Use the provided TLS template [`nginx-ssl.conf.example`](./nginx-ssl.conf.example)
   as the frontend's nginx config and mount the certs into the frontend
   container; publish port `443` (and keep `80` for redirect).
3. Update `FRONTEND_ORIGIN` in `.env` to `https://izlearn.yourco.local` and
   rebuild.

Until then, HTTP works functionally (auth uses bearer tokens in the request body,
not Secure cookies). Be aware that over HTTP, passwords and e-signature
credentials travel in cleartext on the LAN — fine for a pilot, **not** for go-live
with real GMP records. Treat HTTPS as the immediate next step.

## Optional: harden MongoDB with authentication
The pilot runs Mongo without auth (reachable only on the internal Docker network).
To require credentials you enable Mongo auth with a replica-set **keyfile** and add
the user/password to `DATABASE_URL`. This is a recommended hardening step before
broad rollout — ask and it can be wired into `docker-compose.server.yml`.
