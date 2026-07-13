# izLearn — On-Premises Server Setup

A step-by-step runbook for running the **whole** izLearn stack on a single on-prem server
with Docker, plus a **Troubleshooting** section covering every issue we hit during a real
setup so you don't have to rediscover them.

The stack (one host, `docker-compose.server.yml`):
- **mongo** — MongoDB 7 as a single-node **replica set** (transactions require it)
- **redis** — Bull job queues (email / reminders / backups)
- **backend** — Node/Express API (internal only)
- **frontend** — nginx serving the React SPA and proxying `/api` → backend

```
 Users ─http──▶ nginx (frontend :80) ──┬─ serves the SPA
                                        └─ /api ─▶ backend:4000 ─┬─▶ mongo (replica set)
                                                                 ├─▶ redis (jobs)
                                                                 └─▶ storage volume (files)
```

> This is the self-hosted counterpart to the cloud guide in [`DEPLOYMENT.md`](./DEPLOYMENT.md).
> The files it uses — `docker-compose.server.yml`, `.env.server.example` — are additive and
> don't affect the local or cloud setups.

**Setup this guide assumes:** an on-prem **Windows Server** hosting a **Hyper-V Ubuntu VM**
that runs Docker (Docker as a real Linux service → auto-starts on boot, survives reboots),
reached over the LAN and/or a **Tailscale** VPN, initially over **HTTP** (HTTPS is a later step).

---

## Quick start (already-set-up VM)

For a VM that's already provisioned (Docker installed, repo cloned, `.env` in place) — just
redeploy the latest code:

```bash
ssh <username>@<VM-IP>                                    # 1. connect
cd ~/izlearn                                              # 2. go to the repo
git pull                                                  # 3. get latest code
docker compose -f docker-compose.server.yml up -d --build # 4. rebuild + restart
docker compose -f docker-compose.server.yml ps            # 5. all services Up / healthy?
docker compose -f docker-compose.server.yml logs -f backend   # 6. wait for "izLearn API listening"
```

Then open **`http://<VM-IP>`** (or the Tailscale address). First time on this VM instead?
Follow the full guide below. Redeploy not behaving? See **Troubleshooting** (especially **T6**
stale image, **T7** CORS/`FRONTEND_ORIGIN`, **T8** `.env` not applied).

---

## Part 1 — Provision the Ubuntu VM (Hyper-V)

### 1.1 Enable Hyper-V (on the Windows host)
Server Manager → **Add Roles and Features** → **Role-based** → select this server → tick
**Hyper-V** (add the management tools) → install → reboot.
*(PowerShell as admin: `Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart`.)*

> ⚠️ **Do not** use a **Domain Controller** as the Hyper-V host. Use a dedicated / non-DC box.

### 1.2 Download Ubuntu Server
Get **Ubuntu Server 22.04 or 24.04 LTS** (`.iso`) from ubuntu.com/download/server, e.g.
`C:\ISOs\ubuntu-server.iso`. (Server edition, not Desktop.)

### 1.3 Create an External virtual switch
Hyper-V Manager → **Virtual Switch Manager** → **External** → **Create** → name it
`LAN-Switch` → bind it to the server's physical NIC → OK.
*(External puts the VM on your real LAN so others can reach it; the "Default Switch" NATs it and is not suitable for a server.)*

### 1.4 Create the VM
Hyper-V Manager → **New → Virtual Machine**:
- Name: `izlearn-server`
- **Generation 2**
- Memory: give it a comfortable fixed amount (Dynamic Memory **off** for Linux)
- Network: **LAN-Switch**
- Virtual disk: **60 GB+**
- Install media: point to `ubuntu-server.iso`

Then **Settings** before first boot:
- **Security → Secure Boot → Template = "Microsoft UEFI Certificate Authority"**
  (Gen 2 blocks Ubuntu from booting without this).
- **Processor → 2 vCPU** (or more).

### 1.5 Install Ubuntu
Start + Connect. In the installer:
- Language / keyboard → defaults.
- Network → note the assigned IP.
- **Storage** → "Use an entire disk", then on the summary **edit `ubuntu-lv` and set its size
  to the maximum** (the installer defaults to ~half the disk — expand it to use all ~56 GB).
  → Done → Continue (confirm — it formats the empty virtual disk only).
- **Profile** → set server name `izlearn`, a username, and a password — **write these down.**
- ✅ **Install OpenSSH server** (tick it).
- Skip featured snaps.
- Let it **finish completely** ("Installation complete") → **Reboot** → eject the ISO
  (Media → DVD Drive → Eject).

### 1.6 Give the VM a stable IP
The IP must not change (DNS / port-forwarding depend on it). Either add a **DHCP reservation**
for the VM's MAC on your router, or set a static IP in Ubuntu (netplan). Confirm with `ip a`.

### 1.7 Set the VM to auto-start
Hyper-V Manager → VM **Settings → Management → Automatic Start Action → "Always start
automatically"**; **Automatic Stop Action → "Shut down the guest OS"**.

### 1.8 Connect over SSH
From the Windows host (PowerShell / Terminal):
```powershell
ssh <username>@<VM-IP>
```
*(Use just the IP — do **not** include the `/24` from `ip a`.)*

---

## Part 2 — Install Docker (inside the VM)
```bash
sudo apt update
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # then log out & back in so `docker` works without sudo
docker --version && docker compose version && docker run --rm hello-world
```
Docker installs as a systemd service that starts on boot; with `restart: unless-stopped` on
the containers, the whole app self-heals after a reboot.

---

## Part 3 — Get the code and configure `.env`
```bash
git clone <your-repo-url> izlearn      # a private repo prompts for a GitHub username + a
cd izlearn                             # Personal Access Token (not your account password)
```
Create the environment file (secrets — never committed):
```bash
cp .env.server.example .env
# generate two strong secrets and set the app URL (HTTP for now):
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
sed -i "s|^FRONTEND_ORIGIN=.*|FRONTEND_ORIGIN=http://<VM-IP-or-domain>|" .env
grep -E '^(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|FRONTEND_ORIGIN|STORAGE_DRIVER|DATABASE_URL)' .env
```
> 🔴 **`FRONTEND_ORIGIN` must exactly match how you open the site.** If you browse to
> `http://192.168.x.x`, set `http://192.168.x.x` — **not** `https://…`. A mismatch causes a
> **500 "Origin not allowed by CORS policy"** on login. (See Troubleshooting §T7.)

`DATABASE_URL` and `STORAGE_DRIVER=local` in the template already point at the self-hosted
Mongo and on-disk file storage — leave them.

---

## Part 4 — Build and launch
```bash
docker compose -f docker-compose.server.yml up -d --build
```
First boot: Mongo initialises its replica set → backend runs `prisma db push` (indexes) →
`seed` (baseline roles + first admin) → starts. Watch it:
```bash
docker compose -f docker-compose.server.yml ps
docker compose -f docker-compose.server.yml logs -f backend   # wait for "izLearn API listening"
```
Open **`http://<VM-IP>`** from a LAN machine.

---

## Part 5 — Firewall
```bash
sudo ufw allow OpenSSH        # 🔴 ALLOW SSH FIRST — or enabling ufw locks you out (§T5)
sudo ufw allow 80/tcp
sudo ufw enable
```
Mongo (27017), Redis (6379) and the backend (4000) are **not** published to the host — they
live only on Docker's internal network. Don't open them.

---

## Part 6 — First login & hardening
Sign in — `admin` / `ChangeMe@123` on a fresh install (or your migrated admin creds, Part 8).
1. **Change the admin password** immediately.
2. **Profile → Set Signature Password** (required for e-signed actions).
3. **System Config**: configure SMTP (email), the password policy, and — for lockdown — the
   IP allowlist (`security.allowed_ip_ranges`).

---

## Part 7 — Remote access via Tailscale (recommended VPN)
Keeps the app private; remote staff reach it over an encrypted tunnel with no port-forwarding.

**On the VM:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=izlearn      # open the printed URL, log in with your account
tailscale ip -4                           # the 100.x.y.z address users will use
```
**Allow the Tailscale address in the app** (else login 500s on CORS): add `http://100.x.y.z`
to `FRONTEND_ORIGIN` (comma-separated) and recreate the backend:
```bash
TS_IP=$(tailscale ip -4)
sed -i "s#^FRONTEND_ORIGIN=.*#FRONTEND_ORIGIN=http://<VM-IP>,http://$TS_IP#" .env
docker compose -f docker-compose.server.yml up -d --force-recreate backend
```
**Each remote user:** installs the Tailscale app, logs in with **their own** account (invite
them from the Tailscale admin console → Users → Invite — never share your login), then browses
to `http://100.x.y.z`.

> Don't **delete the server's machine** in the Tailscale console — it drops the server off the
> tailnet / changes its IP. If that happens: `sudo tailscale up` again, re-check `tailscale ip -4`,
> and update the whitelist above.

---

## Part 8 — (Optional) Migrate existing data from MongoDB Atlas
The server's Mongo starts **empty** (seeded defaults only). If you already have data in an
Atlas database (e.g. from local/dev), copy it in — otherwise the server shows only baseline
roles and your earlier configuration/data is missing (see §T12).

> Make sure **Atlas → Network Access** allows the server's public IP (or `0.0.0.0/0`).

```bash
# 1. Dump from Atlas — use the bare connection string, NO query params (see §T13):
docker exec izlearn-server-mongo-1 sh -c \
  'mongodump --uri="mongodb+srv://USER:PASS@CLUSTER.mongodb.net/izlearn" --gzip --archive=/tmp/atlas.archive'

# 2. Verify it dumped:
docker exec izlearn-server-mongo-1 ls -lh /tmp/atlas.archive

# 3. Restore into the server's Mongo (replaces the seeded data):
docker exec izlearn-server-mongo-1 sh -c \
  'mongorestore --uri="mongodb://localhost:27017/?directConnection=true" --gzip --archive=/tmp/atlas.archive --drop'

# 4. Restart the backend:
docker compose -f docker-compose.server.yml restart backend
```
After this, log in with your **Atlas** admin credentials. ⚠️ The server DB is now **independent**
of Atlas — they will drift apart, so pick **one** as your source of truth going forward.

---

## Part 9 — Updating the app
```bash
cd ~/izlearn
git pull
docker compose -f docker-compose.server.yml up -d --build   # rebuild the changed images
```
> Always use **`--build`** after a `git pull`. A plain restart keeps running the **old** image
> baked at build time and will not pick up code or schema changes (§T6).
> You can limit the rebuild, e.g. `... up -d --build backend` or `... --build frontend`.

---

## Part 10 — Backups (you own these)
Back up **off the VM**, regularly:
1. **Database** (includes the audit trail):
   ```bash
   docker exec izlearn-server-mongo-1 sh -c \
     'mongodump --uri="mongodb://localhost:27017/izlearn?replicaSet=rs0" --gzip --archive=/tmp/izlearn-$(date +%F).archive'
   docker cp izlearn-server-mongo-1:/tmp/izlearn-$(date +%F).archive ./   # then copy off-box
   ```
2. **The uploaded-files volume** (`izlearn-server_storage`) and your **`.env`** — not in git.

Schedule with `cron`; test a restore periodically (see [`RESTORE.md`](./RESTORE.md)).

---

# Troubleshooting — issues we actually hit

### T1. Hyper-V Manager shows no VM / can't create one
The left tree has no server under "Hyper-V Manager". → **Actions → Connect to Server → Local
computer**. If it errors with *"…Virtual Machine Management service…"*, that service is stopped:
open **services.msc** → start **"Hyper-V Virtual Machine Management"** (set Startup = Automatic),
or PowerShell (admin): `Set-Service vmms -StartupType Automatic; Start-Service vmms`.

### T2. VM won't boot the installer / "No operating system was loaded"
The VM booted from an empty disk or the ISO wasn't attached. VM off → **Settings**:
- **SCSI Controller → DVD Drive → Image file** = the Ubuntu ISO (not "None").
- **Firmware → Boot order**: move **DVD Drive** to the top.
- (Gen 2) **Security → Secure Boot template = "Microsoft UEFI Certificate Authority"**.
After a successful install, **eject the ISO** so it boots from disk.

### T3. Ubuntu installer only uses ~half the disk
On the Storage step, the default `ubuntu-lv` is ~50% of the disk. **Edit `ubuntu-lv` → set size
to maximum** before continuing, or the OS runs out of space later.

### T4. Forgot the Ubuntu login
Fastest on a fresh VM: **reinstall** (§1.5) and record the credentials. Or reset via **GRUB
recovery**: at boot press `Esc`/hold `Shift` → Advanced options → *(recovery mode)* → root shell
→ `mount -o remount,rw /` → `ls /home` (find username) → `passwd <user>` → `exit` → resume.

### T5. `ssh … : Connection timed out`
- The VM is **off / mid-reboot** → start it (the app still runs regardless of the folder path).
- **Wrong address** → don't include `/24`; confirm the IP with `ip a` (DHCP may have changed it).
- **ufw blocked SSH** → if you ran `ufw enable` with only port 80 allowed, port 22 is blocked.
  Fix from the **Hyper-V console** (always works): `sudo ufw allow OpenSSH`.
  Prevention: **always `sudo ufw allow OpenSSH` *before* `sudo ufw enable`.**

### T6. Backend container crash-loops (restarting, exit 1) on a Prisma/Mongo index error
Symptom in `logs backend`: e.g. `E11000 duplicate key … Index build failed …` during
`prisma db push`. Cause: the running **image is stale** — it was built from older source whose
schema no longer matches. Fix: rebuild from current source —
`docker compose -f docker-compose.server.yml up -d --build backend`. `db push` reconciles
indexes (drops obsolete ones); it does **not** touch data.

### T7. Login returns **500 "Origin not allowed by CORS policy"**
`FRONTEND_ORIGIN` doesn't match the URL you're opening — almost always **`https://` vs `http://`**,
a wrong host, or a missing Tailscale address. Set it to the **exact** origin(s), comma-separated:
```bash
sed -i "s#^FRONTEND_ORIGIN=.*#FRONTEND_ORIGIN=http://<the-exact-host>#" .env
docker compose -f docker-compose.server.yml up -d --force-recreate backend
docker compose -f docker-compose.server.yml logs backend | grep "CORS whitelist"   # verify
```

### T8. Edited `.env` but nothing changed
Compose injects env vars at **container-create** time. A plain `restart` reuses the old env.
Recreate: `docker compose -f docker-compose.server.yml up -d --force-recreate backend`
(confirm with `docker compose -f docker-compose.server.yml exec backend printenv FRONTEND_ORIGIN`).

### T9. File upload fails with `EXDEV: cross-device link not permitted`
The uploaded temp file and the storage volume are on different filesystems, so `rename` can't
move across them. **Fixed in the code** (the local storage driver falls back to copy+delete).
Make sure you're on the latest code and rebuilt: `git pull && … up -d --build backend`.

### T10. PDF viewer: "Failed to fetch dynamically imported module … pdf.worker…mjs"
nginx must serve `.mjs` as JavaScript (with `X-Content-Type-Options: nosniff`, a wrong type is
rejected). **Fixed in `frontend/nginx.conf`** (`.mjs` → `text/javascript`, `.wasm` →
`application/wasm`). `git pull && … up -d --build frontend`. If one browser still fails after the
fix, it cached the broken file — **hard-refresh** (`Ctrl+Shift+R`).

### T11. Works on the LAN but not over Tailscale (a request hangs "pending")
This is almost always a **stale browser cache** for that asset (a file fetched before a fix was
deployed), **not** the tunnel. **Hard-refresh** (`Ctrl+Shift+R`) or open a fresh browser profile.
(It is *not* an MTU problem — a fresh browser working over the same tunnel proves that.)

### T12. Roles look different / Super Admin can't edit / data is "missing"
The server runs its **own** MongoDB, separate from Atlas, seeded with baseline data only — so it
won't have the roles/users/config from your Atlas database. Migrate your data in (Part 8); after
that the roles and permissions match your real environment.

### T13. `mongodump`: `error parsing uri: invalid option`
The connection string's query parameters (`?appName=…`, `retryWrites=…`) trip the tools. Use the
**bare** string ending at `/izlearn` with **no `?...`**. If it instead **times out**, Atlas
Network Access isn't allowing the server's IP.

### T14. Forgot the e-signature (signature) password
There's no in-app reset yet. Clear it in the DB, then set a new one via **Profile → Set Signature
Password** (needs only your login password once the old hash is gone):
```bash
docker exec izlearn-server-mongo-1 mongosh izlearn --quiet \
  --eval 'db.User.updateOne({ windowsUsername: "admin" }, { $unset: { signaturePasswordHash: "" } })'
```
*(Direct DB edits bypass the audit trail — fine for admin recovery, not a routine action.)*

---

## Appendix — hardening for production

- **HTTPS (do this soon).** Over HTTP, passwords and e-signature credentials travel in cleartext
  (fine only for a closed pilot / VPN). For an **internal** domain, Let's Encrypt usually can't
  validate — issue a cert from your **organisation's internal CA** (e.g. AD Certificate Services).
  Use the provided [`nginx-ssl.conf.example`](./nginx-ssl.conf.example) as the frontend nginx
  config, mount the cert, publish `443`, and set `FRONTEND_ORIGIN=https://your-domain`.
- **MongoDB authentication.** The pilot runs Mongo without auth (reachable only on the internal
  Docker network). Before broad rollout, enable Mongo auth with a replica-set keyfile and add the
  credentials to `DATABASE_URL`.
- **Reboot test.** After setup, `sudo reboot` the VM and confirm the whole stack comes back on its
  own (browse to the app) — `restart: unless-stopped` + Docker's boot service should handle it.
- **Compliance.** Confirm data-handling/exposure is permitted per your GxP/IT policies; see
  [`COMPLIANCE.md`](./COMPLIANCE.md).
