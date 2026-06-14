# izLearn — GxP-Compliant Learning Management System

izLearn is a production-grade Learning Management System for pharmaceutical / GMP-regulated
organisations. It manages personnel training records, competency evaluations, job descriptions,
training schedules, assessments, certificates, feedback and a tamper-evident audit trail, and is
designed to meet **USFDA 21 CFR Part 11**, **EU Annex 11** and **GxP ALCOA++** requirements.

- **Local setup** (this file) — run the app on your machine for development/demo.
- **[`DEPLOYMENT.md`](./DEPLOYMENT.md)** — deploy the live app (Vercel + Render + MongoDB Atlas + R2).
- **[`COMPLIANCE.md`](./COMPLIANCE.md)** — clause-by-clause compliance mapping.
- **[`RESTORE.md`](./RESTORE.md)** — disaster-recovery procedures.

---

## Architecture

Monorepo (npm workspaces):

```
training-iZLearn/
├── backend/     Node 20 + Express + TypeScript + Prisma (MongoDB) + Bull (Redis, optional locally)
├── frontend/    React 18 + TypeScript + Vite + Tailwind + Zustand + React Query
├── shared/      Zod schemas shared by FE & BE (single source of validation truth)
├── docker-compose.yml
└── README.md / DEPLOYMENT.md / COMPLIANCE.md / RESTORE.md
```

- **Database**: **MongoDB** via the Prisma `mongodb` provider. Use **MongoDB Atlas** (the free M0
  tier is already a replica set) or a local single-node replica set. A replica set is **required** —
  the audit middleware writes each change in a transaction, and Mongo transactions need one.
- **File storage**: uploaded materials, certificates and documents are stored **in MongoDB**
  (a `FileBlob` collection, **≤ 15 MB** per file) by default, or in **Cloudflare R2** when the
  `R2_*` env vars are set. Either way downloads stream through the auth-checked API.
- **Redis** is used by the Bull job queues (email, reminders, backups) and as a session/lock
  accelerator. It is **optional for local development** — sessions are stored durably in MongoDB,
  so auth works without Redis; only the background jobs are skipped when it is absent.
- **Auth**: JWT (15-min access + 8-hr refresh), bcrypt (cost 12), optional LDAP/AD, single-session
  enforcement, inactivity lock, failed-login lockout.
- **Compliance core**: a Prisma middleware writes an `AuditTrail` record inside the same transaction
  as every GMP data change; two-component electronic signatures; mandatory reason-for-change on
  update/delete; soft-delete only (nothing is ever hard-deleted). Audit immutability is enforced at
  the **application layer** (no endpoint ever updates or deletes audit rows).

---

## Prerequisites

- **Node.js 20+** (works on 22) and **npm**.
- A **MongoDB** connection string — either a MongoDB Atlas cluster or a local replica set.
- *(Optional)* **Docker**, only if you want Redis for the background jobs.

---

## Local development

### 1. Install dependencies (from the repo root)

```bash
npm install
```

### 2. Configure environment

The backend reads a `.env` from the **repo root** (it also picks up `backend/.env` if present).
A root `.env` already exists in this project; make sure it has at least:

```ini
# MongoDB — Atlas, or a local single-node replica set
DATABASE_URL=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/izlearn?retryWrites=true&w=majority

# Auth secrets (any long random strings for local dev)
JWT_ACCESS_SECRET=dev-access-secret-change-me
JWT_REFRESH_SECRET=dev-refresh-secret-change-me

# First SUPER_ADMIN created by the seed
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=ChangeMe@123
SEED_ADMIN_EMAIL=admin@example.com

# CORS origin for the local frontend is allowed automatically; this is for the deployed UI
FRONTEND_ORIGIN=http://localhost:5173
```

See [`.env.example`](./.env.example) for the full annotated list (including the optional `R2_*`,
`REDIS_URL`, and `STORAGE_DRIVER`). Leaving `R2_*` unset stores files in MongoDB.

> **Need a local MongoDB instead of Atlas?** Run a single-node replica set:
> ```bash
> docker run -d -p 27017:27017 mongo:7 --replSet rs0
> docker exec <container-id> mongosh --eval "rs.initiate()"
> ```
> then set `DATABASE_URL=mongodb://localhost:27017/izlearn?replicaSet=rs0`.

### 3. Generate the Prisma client

```bash
npm run -w backend prisma:generate
```

If you are using a brand-new/empty database, also sync the schema once:
`npm run migrate -w backend` (this runs `prisma db push`). Skip this when pointing at a database
that is already set up.

### 4. Seed the baseline data (first run only)

```bash
npm run seed -w backend
```

This creates the default RBAC roles, the functional-role and training-type masters, all
`SystemConfig` defaults, a default Location/Department, and the first SUPER_ADMIN. It is idempotent
and **skips the admin if it already exists**, so it never overwrites an existing password.

### 5. Run the app

```bash
# Backend + frontend together (from the repo root)
npm run dev
```

or run each workspace in its own terminal:

```bash
npm run dev -w backend     # http://localhost:4000
npm run dev -w frontend    # http://localhost:5173  (Vite proxies /api to :4000)
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:4000/api>
- Swagger UI: <http://localhost:4000/api-docs>
- Health: <http://localhost:4000/api/health>

### 6. Log in

Sign in with the seeded SUPER_ADMIN — default `admin` / `ChangeMe@123` (or whatever you set in
`SEED_ADMIN_*`). After logging in, set a **signature password** (Profile → Set Signature Password)
before performing any e-signed action.

### 7. (Optional) Redis for background jobs

Auth and the UI work without Redis. To exercise the email/reminder/backup queues, start Redis:

```bash
docker compose up -d redis      # exposes redis://localhost:6379
```

The backend connects automatically (`REDIS_URL` defaults to `redis://localhost:6379`). Without it,
you'll see a single "Redis unavailable" warning and the queues simply don't run.

> izLearn is desktop/tablet only — viewports under **768px** are blocked with a full-screen notice.
> Use a screen ≥ 768px wide.

---

## Tests

```bash
npm test                  # backend (jest) + frontend (vitest)
npm run test -w backend   # audit immutability, RBAC union, assessment scoring, file security, …
npm run test -w frontend
```

---

## Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Backend + frontend together (concurrently) |
| `npm run build` | Build shared → backend → frontend |
| `npm run seed -w backend` | Seed baseline roles/config/admin (idempotent) |
| `npm run migrate -w backend` | `prisma db push` — sync the schema to the database |
| `npm run -w backend prisma:generate` | Regenerate the Prisma client after a schema change |
| `npm run security:audit` | `npm audit --audit-level=high` |

---

## Notes & integration points

- **Antivirus**: `backend/src/utils/fileUtils.ts → scanFileForVirus()` is a documented stub
  (logs a warning, returns "clean"). Wire in ClamAV or a cloud AV API to enable real scanning.
- **External integrations** (return **501 Not Implemented** until wired up) live in
  `backend/src/controllers/integration.controller.ts`: DMS sync, HR user-sync, and instrument
  qualification → training trigger.
- **Security**: Helmet + strict CSP/HSTS, CORS whitelist, rate limiting on `/api/auth/*`,
  Prisma-parameterised queries, DOMPurify on rendered HTML, and upload extension/MIME/size
  validation. Operational settings (LDAP, SMTP, password policy, reminder days, branding, allowed
  origins) live in the **`SystemConfig`** collection and are edited in the UI — every change is
  e-signed and audited.

For deploying the live app, see **[`DEPLOYMENT.md`](./DEPLOYMENT.md)**.
