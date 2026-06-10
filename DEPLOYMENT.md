# izLearn — Going Live for Free (MongoDB Atlas + Vercel + Oracle VM)

This guide deploys izLearn as a **public HTTPS website** using **free services**:

| Layer | Service | Cost |
|------|---------|------|
| **Frontend** (React/Vite) | **Vercel** | Free |
| **Backend** (Node/Express + Redis, Docker) | **Oracle Cloud — Always Free** VM (Ampere ARM) | Free |
| **Database** | **MongoDB Atlas** (M0, 512 MB, replica set) | Free |
| **HTTPS for the API** | **Caddy** (auto Let's Encrypt) | Free |
| **API domain** | **DuckDNS** | Free |
| Outgoing email (optional) | **Brevo** SMTP (300/day) | Free |

> izLearn now runs on **MongoDB** (Prisma `mongodb` provider). MongoDB **transactions
> require a replica set** — Atlas M0 already is one, so it works out of the box. A future
> self‑hosted Mongo must also run as a replica set.

> **Architecture**
> ```
> Browser ─HTTPS─▶ Vercel (frontend SPA)
>    │  app calls VITE_API_URL ↓ (HTTPS, CORS)
>    └────────────▶ Caddy (:443) ─▶ backend container (:4000) ─▶ Redis
>                                        │
>                                        ▼  DATABASE_URL (mongodb+srv://)
>                                   MongoDB Atlas
> (uploaded files live on the VM's Docker volume; their metadata lives in Atlas)
> ```

> Oracle asks for a card **for verification only** at sign‑up; Always‑Free resources are
> never charged. Time: ~45–60 min.

---

## Part 1 — MongoDB Atlas (free database)

1. Sign up at **https://www.mongodb.com/cloud/atlas/register**.
2. **Create a cluster → M0 (Free)**. Pick a cloud/region near your VM. Name it e.g. `izlearn`.
3. **Database Access → Add New Database User**: username + a strong password (Atlas can
   autogenerate). Role: **Read and write to any database** (or scope to the `izlearn` db).
4. **Network Access → Add IP Address**: add your **Oracle VM's public IP** (best), or
   `0.0.0.0/0` (simplest, less strict) so the backend can connect.
5. **Database → Connect → Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://<user>:<pass>@izlearn.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Insert the password and add the **db name** `izlearn` before the `?`:
   ```
   mongodb+srv://<user>:<pass>@izlearn.xxxxx.mongodb.net/izlearn?retryWrites=true&w=majority
   ```
   Keep this — it's your `DATABASE_URL`.

---

## Part 2 — Create the free server (Oracle Cloud Always Free)

1. Sign up at **https://www.oracle.com/cloud/free/** → verify email + card. Pick a **Home
   Region** near your users.
2. **☰ → Compute → Instances → Create instance**:
   - **Name:** `izlearn`  ·  **Image:** *Canonical Ubuntu 22.04*
   - **Shape → Ampere (ARM)** `VM.Standard.A1.Flex`, **2 OCPU / 12 GB RAM** (Always‑Free).
   - **SSH keys:** *Generate a key pair* and **download the private key** (`izlearn.key`).
3. **Create**, wait for **Running**, copy the **Public IP**.
4. Connect:
   ```bash
   chmod 400 izlearn.key            # macOS/Linux
   ssh -i izlearn.key ubuntu@<PUBLIC_IP>
   ```

---

## Part 3 — Install Docker (on the server)

```bash
sudo apt-get update && sudo apt-get upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker --version && docker compose version
```

---

## Part 4 — Get the code + configure secrets

```bash
sudo apt-get install -y git
git clone https://github.com/<you>/izlearn.git && cd izlearn   # or scp the folder up
cp .env.example .env

# Generate strong secrets:
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
```

Edit `.env` (`nano .env`) — note `.env` is gitignored, so secrets aren't committed:

```ini
# Atlas connection string from Part 1
DATABASE_URL=mongodb+srv://<user>:<pass>@izlearn.xxxxx.mongodb.net/izlearn?retryWrites=true&w=majority

JWT_ACCESS_SECRET=<paste>
JWT_REFRESH_SECRET=<paste a different one>

# Your Vercel URL (fill in after Part 7; used for CORS)
FRONTEND_ORIGIN=https://your-app.vercel.app

SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=<a strong password>
SEED_ADMIN_EMAIL=you@example.com
```

---

## Part 5 — Open the firewall (the #1 Oracle gotcha)

Open **80** and **443** in **both** places.

**5a. OCI console:** ☰ → Networking → Virtual Cloud Networks → your VCN → Security Lists →
Default → **Add Ingress Rules**: Source `0.0.0.0/0`, TCP, port **80**; repeat for **443**.

**5b. On the server:**
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## Part 6 — Launch the backend

```bash
docker compose up -d --build
```
On start the backend runs **`prisma db push`** (creates collections + indexes in Atlas) and
**seeds** the admin account. Verify:
```bash
docker compose ps
docker compose logs -f backend     # look for "listening on 4000"; no replica-set errors
curl -s http://127.0.0.1:4000/api/health   # expect status ok/degraded JSON
```
> If you see *"Transaction numbers are only allowed on a replica set"* — your `DATABASE_URL`
> isn't pointing at Atlas (or a replica set). Fix the string and `docker compose up -d`.

---

## Part 7 — API domain + free HTTPS (DuckDNS + Caddy)

The backend needs a public HTTPS URL for the Vercel frontend to call.

1. **DuckDNS:** at https://www.duckdns.org create a subdomain, e.g. `izlearn-api`, and set its
   IP to the VM's **Public IP** → gives `izlearn-api.duckdns.org`.
2. **Install Caddy:**
   ```bash
   sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt-get update && sudo apt-get install -y caddy
   ```
3. **Configure** (`sudo nano /etc/caddy/Caddyfile`):
   ```caddy
   izlearn-api.duckdns.org {
       encode gzip
       reverse_proxy 127.0.0.1:4000
   }
   ```
   ```bash
   sudo systemctl reload caddy
   curl -I https://izlearn-api.duckdns.org/api/health   # HTTPS now works
   ```

---

## Part 8 — Deploy the frontend to Vercel

1. Push the repo to **GitHub** (if not already).
2. At **https://vercel.com** → **Add New → Project** → import the repo.
3. **Configure project:**
   - **Root Directory:** `frontend`
   - Framework preset: **Vite** (build `npm run build`, output `dist` — already in
     `frontend/vercel.json`, which also adds SPA routing).
   - **Environment Variable:**
     `VITE_API_URL = https://izlearn-api.duckdns.org/api`
4. **Deploy.** Vercel gives you a URL like `https://your-app.vercel.app`.
5. **Back on the server:** set `FRONTEND_ORIGIN` in `.env` to that exact Vercel URL, then:
   ```bash
   docker compose up -d        # picks up the new CORS origin
   ```

🎉 Open your Vercel URL — the SPA loads and all `/api` calls go to the VM backend over HTTPS.

---

## Part 9 — First login & setup

1. Log in with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.
2. **Change the admin password** immediately.
3. **Set your e‑signature password** (Profile) — required for Publish / Archive / Revise /
   Change passing score / Assign bundle.
4. **(Optional) email** — free Brevo: System Config → set `smtp.host=smtp-relay.brevo.com`,
   `smtp.port=587`, `smtp.user`, `smtp.password` (Brevo SMTP key), `smtp.from`.
5. Create your real departments, designations, users, topics, bundles.

---

## Maintenance

- **Update:** `cd ~/izlearn && git pull && docker compose up -d --build` (re‑runs `db push`).
  Frontend redeploys automatically on each GitHub push (Vercel).
- **Backups (Admin → Backup):** uses `mongodump` to a gzip archive in the `backups` volume,
  with a SHA‑256 checksum + verify/restore. Copy archives off‑box periodically:
  `scp -i izlearn.key ubuntu@<IP>:~/izlearn/<backups-volume-path>/*.gz .` (or use Atlas's own
  cloud backups).
- **Logs:** `docker compose logs -f backend`  ·  **Restart:** `docker compose restart`.

---

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| Frontend loads but every API call fails (CORS / network) | `VITE_API_URL` must be the full `https://…/api`; `FRONTEND_ORIGIN` on the server must equal the Vercel URL; then `docker compose up -d`. |
| Backend log: *"Transaction numbers are only allowed on a replica set"* | `DATABASE_URL` must point at Atlas (or a replica set). |
| Atlas connection refused / timeout | Add the VM's public IP under Atlas **Network Access**. |
| HTTPS cert won't issue | Port **80** open (Part 5, both places); DNS resolves: `dig izlearn-api.duckdns.org`; `sudo journalctl -u caddy -n 50`. |
| Backend restarts on boot | `docker compose logs backend` — usually a missing `.env` value (DATABASE_URL / JWT secrets hard‑fail in production). |
| Out of disk over time | `docker system prune -af` (won't touch the `storage`/`backups` volumes). |

---

## Notes & trade‑offs (MongoDB)

- **Transactions need a replica set** — Atlas provides it; a future self‑hosted Mongo must run
  in replica‑set mode (`--replSet`).
- **Schema sync is `prisma db push`** (MongoDB has no SQL migration history) — lighter change
  control than the previous Postgres migrations; worth noting for GMP audits.
- **DB‑level audit immutability triggers** (a Postgres feature) have no MongoDB equivalent.
  Audit‑trail and e‑signature records are still never updated/deleted by the app (immutability
  is enforced at the application layer), but the previous DB‑level defence‑in‑depth is gone.
- **Atlas free M0 = 512 MB** — fine for launch; only *metadata* is stored in Mongo (uploaded
  files stay on the VM disk). Watch usage as the catalogue grows.

---

### Quick reference — full first deploy

```bash
# Atlas: create M0, DB user, allow VM IP, copy mongodb+srv string  (Part 1)
# Server (after Docker + firewall):
git clone https://github.com/<you>/izlearn.git && cd izlearn
cp .env.example .env && nano .env        # DATABASE_URL=Atlas, secrets, FRONTEND_ORIGIN
docker compose up -d --build             # db push + seed against Atlas
# DuckDNS → VM IP; install Caddy → reverse_proxy 127.0.0.1:4000   (Part 7)
# Vercel: import repo, Root=frontend, VITE_API_URL=https://<api-domain>/api  (Part 8)
```
