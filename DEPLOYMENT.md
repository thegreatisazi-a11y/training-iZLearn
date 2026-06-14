# izLearn — Deployment (Vercel + Render + MongoDB Atlas + Cloudflare R2)

This guide deploys izLearn as a public HTTPS app using managed services:

| Layer | Service | Notes |
|------|---------|------|
| **Frontend** (React/Vite SPA) | **Vercel** | Static build, served on HTTPS |
| **Backend** (Node/Express + Bull) | **Render** (Docker web service) | Defined by `render.yaml` |
| **Queue/cache** (Bull jobs) | **Render Key Value / Redis** | Auto-provisioned by `render.yaml` |
| **Database** | **MongoDB Atlas** (M0 free tier is a replica set) | Prisma `mongodb` provider |
| **File storage** | **MongoDB (default)** or **Cloudflare R2** (optional) | Demo: files live in Mongo (survive redeploys, no extra account). Production: set `R2_*` to use R2 |

```
Browser ──HTTPS──▶ Vercel (SPA)  ──HTTPS /api──▶ Render (backend) ──▶ MongoDB Atlas
                                                          │            (data + file bytes)
                                                          ├──▶ Render Redis (Bull queues)
                                                          └──▶ Cloudflare R2  ⟵ optional (set R2_* to enable)
```

> **Why this shape:** Render wipes the container filesystem on every deploy/restart, so
> uploads must **not** live on local disk. For a free demo the app stores file bytes in
> **MongoDB** (a `FileBlob` collection) — they survive redeploys and need no extra
> service; certificate PDFs work too. Limits: **≤ 15 MB per file** (Mongo's 16 MB
> document cap) and the cluster's **512 MB** total — fine for SOP PDFs, not for large
> video. Set the `R2_*` env vars anytime to switch to Cloudflare R2 (no code change).
>
> MongoDB transactions (audit middleware) **require a replica set** — Atlas M0 already is
> one. The Postgres DB-level audit-immutability triggers are gone; audit immutability is
> now enforced at the **application layer** (no endpoint ever updates/deletes audit rows).

---

## 0. Prerequisites
- A GitHub repo containing this project (Render + Vercel deploy from Git).
- Accounts: **MongoDB Atlas**, **Cloudflare** (R2), **Render**, **Vercel**.

---

## 1. MongoDB Atlas (database)
1. Create a **free M0 cluster**.
2. **Database Access** → add a user (username + password). Avoid `@ : / ? #` in the
   password, or URL-encode them in the connection string.
3. **Network Access** → add `0.0.0.0/0` (Render egress IPs are dynamic on the free tier).
4. **Connect → Drivers** → copy the connection string and append the DB name:
   ```
   mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/izlearn?retryWrites=true&w=majority
   ```
   Keep this as your **`DATABASE_URL`** (set it in Render — never commit it).

No migrations are needed: the backend runs `prisma db push` on boot to sync collections
and indexes, then seeds the baseline roles + first admin (idempotent).

---

## 2. File storage — Mongo (default) or Cloudflare R2 (optional)
**For the free demo, skip this section** — with no `R2_*` vars set, the backend stores
uploaded materials, certificate PDFs, and documents directly in MongoDB (the `FileBlob`
collection). They survive redeploys; the only limits are **≤ 15 MB per file** and the
cluster's 512 MB. Large video uploads will be rejected with a clear message.

**To use Cloudflare R2 instead** (recommended for real users — durable, off the DB):
1. Cloudflare dashboard → **R2** → **Create bucket** (e.g. `izlearn`).
2. **R2 → Manage R2 API Tokens → Create API token** with **Object Read & Write** on that
   bucket. Copy the **Access Key ID** and **Secret Access Key** (shown once).
3. Note your **Account ID** (R2 overview page). The S3 endpoint is
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (the app derives this automatically).

You'll set these on Render:
```
R2_BUCKET=izlearn
R2_ACCOUNT_ID=<account id>
R2_ACCESS_KEY_ID=<access key id>
R2_SECRET_ACCESS_KEY=<secret access key>
# R2_ENDPOINT=   # optional override; defaults to the account host above
```
> If the R2 vars are absent the backend falls back to local-disk storage (fine for
> local dev, **not** for Render — files would be wiped on each deploy).

---

## 3. Backend on Render
The repo includes **`render.yaml`** (a Render Blueprint) that defines the backend web
service (built from `backend/Dockerfile`) and a Redis instance.

1. Render dashboard → **New → Blueprint** → connect the repo. Render reads `render.yaml`
   and creates **`izlearn-backend`** + **`izlearn-redis`**.
2. On the `izlearn-backend` service, set the secret env vars (Blueprint marks them
   `sync:false`) under **Environment**:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the Atlas connection string from step 1 |
   | `JWT_ACCESS_SECRET` | a long random string |
   | `JWT_REFRESH_SECRET` | a different long random string |
   | `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **optional** — only if using R2 (step 2). Leave unset to store files in MongoDB |
   | `FRONTEND_ORIGIN` | your Vercel URL, e.g. `https://izlearn.vercel.app` (comma-separate to allow several) |
   | `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_EMAIL` | first admin (optional; defaults exist) |

   `REDIS_URL` is wired automatically from the Redis service. `PORT` is injected by
   Render. `NODE_ENV=production` and the JWT TTLs are preset in the Blueprint.
3. Deploy. On boot the container runs: `prisma db push` → `seed` → `start`. Health check:
   `GET /api/health`. Note the service URL, e.g. `https://izlearn-backend.onrender.com`.

> Free Render web services sleep when idle and cold-start on the next request (a few
> seconds). Fine for testing; use a paid plan for always-on.

---

## 4. Frontend on Vercel
The frontend is a workspace that depends on `@izlearn/shared`, so build from the **repo
root** (a root `vercel.json` is included with the correct monorepo build).

1. Vercel → **New Project** → import the repo.
2. **Settings:**
   - **Root Directory:** repo root (leave blank / `.`).
   - Framework Preset: **Other** (the root `vercel.json` sets the commands):
     - Install: `npm install`
     - Build: `npm run build -w shared && npm run build -w frontend`
     - Output: `frontend/dist`
3. **Environment Variables** → add:
   ```
   VITE_API_URL = https://izlearn-backend.onrender.com/api
   ```
   (your Render backend URL + `/api`). This is read at build time by the SPA.
4. Deploy. Note the Vercel URL, then make sure it is in the backend's `FRONTEND_ORIGIN`
   (step 3) for CORS, and redeploy the backend if you changed it.

---

## 5. First login
Open the Vercel URL and sign in with the seeded admin
(`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`, default `admin` / `ChangeMe@123`).
1. Change the password on first login.
2. In **My Profile**, set a **signature password** — required for the e-signed actions
   (publish/revise/archive a course, change roles, assign a bundle, etc.).

---

## 6. Environment variable reference

**Backend (Render):**
```
NODE_ENV=production
DATABASE_URL=mongodb+srv://…            # Atlas (replica set)
REDIS_URL=…                             # auto from render.yaml
JWT_ACCESS_SECRET=…  JWT_REFRESH_SECRET=…
JWT_ACCESS_TTL=15m   JWT_REFRESH_TTL=8h
BCRYPT_COST=12
FRONTEND_ORIGIN=https://your-app.vercel.app
R2_BUCKET=…  R2_ACCOUNT_ID=…  R2_ACCESS_KEY_ID=…  R2_SECRET_ACCESS_KEY=…
SEED_ADMIN_USERNAME=…  SEED_ADMIN_PASSWORD=…  SEED_ADMIN_EMAIL=…
```
**Frontend (Vercel):** `VITE_API_URL=https://<render-backend>/api`

See `.env.example` for the full annotated list.

---

## 7. Local development
Running izLearn on your own machine is covered in **[`README.md`](./README.md)**. In short:
point `DATABASE_URL` at your Atlas cluster (or a local single-node replica set),
`npm install`, `npm run -w backend prisma:generate`, `npm run seed -w backend`, then
`npm run dev`. Redis is **optional locally** — auth and the UI run without it (sessions are
stored in MongoDB); only the background queues are skipped when Redis is absent.

---

## 8. Operational notes
- **Database backups:** use **Atlas's built-in backups**. The app's `mongodump` backup
  feature writes to local disk, which does **not** persist on Render's ephemeral
  filesystem — treat it as a self-hosted-only convenience.
- **Schema changes:** there are no SQL migrations on Mongo. Editing `schema.prisma` and
  redeploying re-runs `prisma db push` on boot to apply the changes (additive/sync).
- **Audit trail:** immutable by application design (no update/delete endpoints). With
  MongoDB there is no DB-level trigger enforcing this, unlike the prior Postgres build.
- **Redis resilience:** Redis is an accelerator, not the source of truth. Sessions live in the
  Mongo `UserSession` collection, so authentication keeps working if Redis is briefly
  unavailable (e.g. a sleeping Render Key Value instance); only the Bull queues (email,
  reminders, backups) pause until it returns.
- **Files:** by default stored in MongoDB (`FileBlob`, keyed `materials/…`,
  `certificates/…`, `personal-documents/…`, `attendance/…`); set `R2_*` to move them to
  Cloudflare R2 with no code change. Either way downloads are streamed through the API
  (auth-checked), not public URLs. Mongo backend rejects single files larger than 15 MB.
