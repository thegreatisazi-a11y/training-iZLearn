# izLearn — GxP-Compliant Learning Management System

izLearn is a production-grade Learning Management System for pharmaceutical / GMP-regulated
organisations. It manages personnel training records, competency evaluations, job descriptions,
training schedules, assessments, certificates, feedback and a tamper-evident audit trail, and is
designed to meet **USFDA 21 CFR Part 11**, **EU Annex 11** and **GxP ALCOA++** requirements.

See [`COMPLIANCE.md`](./COMPLIANCE.md) for the clause-by-clause compliance mapping and
[`RESTORE.md`](./RESTORE.md) for disaster-recovery procedures.

---

## Architecture

Monorepo (npm workspaces):

```
training/
├── backend/     Node 20 + Express + TypeScript + Prisma (PostgreSQL) + Bull (Redis)
├── frontend/    React 18 + TypeScript + Vite + Tailwind + Zustand + React Query
├── shared/      Zod schemas shared by FE & BE (single source of validation truth)
├── docker-compose.yml
├── COMPLIANCE.md / RESTORE.md / README.md
```

- **Database**: PostgreSQL 15 (pgcrypto enabled by the initial migration). **Redis 7** for the
  session store and job queues.
- **ORM**: Prisma with explicit migrations (`backend/prisma/migrations`). The initial migration also
  installs the **AuditTrail / ElectronicSignature immutability triggers**.
- **Auth**: JWT (15-min access + 8-hr refresh), bcrypt (cost 12), optional LDAP/AD, single-session
  enforcement, inactivity lock, failed-login lockout.
- **Compliance core**: a Prisma `$use` middleware writes an `AuditTrail` row inside the same
  transaction as every GMP data change; two-component electronic signatures; mandatory
  reason-for-change on update/delete; soft-delete only (nothing is ever hard-deleted).

---

## Prerequisites

- **Docker + Docker Compose** (recommended), or
- **Node.js 20+**, **PostgreSQL 15+**, **Redis 7+** for local development.

---

## Quick start (Docker)

```bash
cp .env.example .env          # then edit secrets (JWT_*, POSTGRES_PASSWORD, SEED_ADMIN_*)
docker compose up --build
```

This starts PostgreSQL, Redis, the backend (which runs `prisma migrate deploy` + seed on boot) and
the nginx-served frontend.

- Frontend: <http://localhost:8080>
- API: <http://localhost:4000/api>
- Swagger UI: <http://localhost:4000/api-docs>
- Health: <http://localhost:4000/api/health>

Log in with the seeded SUPER_ADMIN (`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`, default
`admin` / `ChangeMe@123`). You will be forced to change the password on first login.

---

## Local development (without Docker)

```bash
# 0. Install all workspaces from the repo root
npm install

# 1. Start PostgreSQL 15 and Redis 7 locally (or: docker compose up -d postgres redis)

# 2. Backend
cd backend
cp .env.example .env          # point DATABASE_URL / REDIS_URL at your local services
npx prisma generate
npx prisma migrate deploy     # applies schema + pgcrypto + immutability triggers
npm run seed                  # seeds roles, system config, first SUPER_ADMIN
npm run dev                   # http://localhost:4000

# 3. Frontend (new terminal)
cd frontend
npm run dev                   # http://localhost:5173 (proxies /api to :4000)
```

Run the backend test suite (audit immutability, RBAC union, assessment scoring, file security,
password policy, shared validation, error mapping):

```bash
cd backend && npm test
```

> izLearn is desktop/tablet only — viewports under **768px** are blocked with a full-screen notice
> (Section 7). Use a screen ≥ 768px wide.

---

## First-run guide

1. Apply migrations: `npm run migrate -w backend` (or `npx prisma migrate deploy`). This creates all
   tables, enables `pgcrypto`, and installs the immutability triggers.
2. Seed: `npm run seed -w backend`. Creates the 8 default roles (`SUPER_ADMIN`, `QA_ADMIN`,
   `DEPARTMENT_HEAD`, `TRAINING_COORDINATOR`, `TRAINER`, `TRAINEE`, `IT_ADMIN`, `AUDITOR`), all
   `SystemConfig` defaults, a default Location/Department, and the first SUPER_ADMIN.
3. Log in, change the password, then set a **signature password** (Profile → Set Signature Password)
   before performing any e-signed action.
4. Configure LDAP, SMTP, password policy, reminder thresholds and org branding under
   **Master Setup → System Config**.

---

## Environment variables

Root `.env` (docker-compose) and `backend/.env` (local) are documented inline in
[`.env.example`](./.env.example) and [`backend/.env.example`](./backend/.env.example).
Operational settings (LDAP, SMTP, password policy, backup cron, reminder days, org name/logo,
allowed CORS origins) live in the **`SystemConfig`** table and are edited in the UI — every change is
e-signed and audited.

---

## Development vs. production

| | Development | Production |
|---|---|---|
| Backend | `npm run dev -w backend` (tsx watch) | `docker compose` (migrate + seed + start) |
| Frontend | `npm run dev -w frontend` (Vite) | nginx-served static build |
| Logs | pretty console | structured JSON (Winston) |
| Secrets | `.env` defaults | **must** set strong `JWT_*` and DB secrets |

In production the backend refuses to start if the audit immutability triggers are missing.

---

## Backup & restore

- **Automatic**: a Bull cron job (`db-backup`) runs `pg_dump` on the schedule in
  `backup.cron_expression` (default daily 01:00), writing a `.sql` dump plus a `.sha256` checksum to
  `backup.destination_path`.
- **Manual**: `POST /api/admin/backup/trigger` (SUPER_ADMIN + e-signature), or the Admin UI.
- **Verify**: `./scripts/verify-backup.sh <file.sql>`, or `POST /api/admin/backup/verify` `{ "file": "izlearn-YYYYMMDD-HHmmss.sql" }`
  (recomputes the SHA-256 and compares it to the `.sha256` sidecar).
- **Restore**: `POST /api/admin/backup/restore` `{ "file": "...", "signature": { ... } }`
  (SUPER_ADMIN + e-signature; verifies the checksum, then replays the dump via `psql`). Also see [`RESTORE.md`](./RESTORE.md).

## Antivirus

`backend/src/utils/fileUtils.ts → scanFileForVirus()` is a documented stub that logs a warning and
returns "clean". To enable real scanning, wire in **ClamAV** (e.g. the `clamscan` npm package against
a `clamd` socket) or a cloud AV API inside that function and return `false` for infected files; all
uploads already pass through it before being persisted.

## Integration points (Section 8)

Documented stubs returning **501 Not Implemented** until wired to external systems
(`backend/src/controllers/integration.controller.ts`):

| Endpoint | Purpose |
|---|---|
| `POST /api/integrations/dms/sync` | Document Management System sync (controlled docs/JDs) |
| `POST /api/integrations/hr/user-sync` | HR system user data sync (joiners/leavers/transfers) |
| `POST /api/integrations/instrument/training-trigger` | Instrument qualification → operator training |

## Security

Helmet + strict CSP & HSTS, CORS whitelist (`security.allowed_origins`), rate limiting on
`/api/auth/*` (10/min/IP, audited), Prisma-parameterised queries (no string interpolation), DOMPurify
on rendered HTML, upload extension+MIME+double-extension+size validation, and `npm run security:audit`
(`npm audit --audit-level=high`). Full attack surface is documented in `COMPLIANCE.md`.
