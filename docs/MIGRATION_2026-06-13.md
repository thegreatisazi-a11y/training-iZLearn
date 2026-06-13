# Live Migration & Seed Runbook — 2026-06-13

Run these steps **in order**. Steps 1–2 are the hard safety gate; do not skip.

## 1. Back up MongoDB Atlas FIRST
Take a full export before any seed/migration touches live data.

```bash
# Option A — mongodump (recommended; full restorable BSON dump)
mongodump --uri "<ATLAS_CONNECTION_STRING>" --out ./backup-2026-06-13

# Restore (only if needed):
# mongorestore --uri "<ATLAS_CONNECTION_STRING>" ./backup-2026-06-13
```
Or use **Atlas UI → Cluster → ... → Take Snapshot / Download** (M10+) , or **Export Collection** per collection on M0.

Verify the dump folder is non-empty and contains every collection before proceeding.

## 2. Why this is non-destructive
- The seed (`backend/prisma/seed.ts`) uses `upsert` keyed by unique fields. It **creates** the new `SUPERVISOR` role and **updates** `SUPER_ADMIN/TRAINER/TRAINEE`; it **never deletes** the legacy roles (`QA_ADMIN, DEPARTMENT_HEAD, TRAINING_COORDINATOR, IT_ADMIN, AUDITOR`). So seeding alone cannot break existing logins.
- `prisma db push` against the current schema is **additive** (new optional fields + new collections + new enum values). No existing field is dropped or retyped, so existing documents remain valid.
- The role consolidation (8→4) is performed by a **separate, dry-run-by-default script** that deactivates — never deletes — legacy roles and guarantees every active user keeps at least one active role.

## 3. Apply schema (additive)
```bash
cd backend
npx prisma generate
npx prisma db push --skip-generate
```

## 4. Seed (idempotent)
```bash
cd backend
npm run seed   # upserts 4 roles + 15 functional roles + 12 training types + masters; safe to re-run
```
This does **not** reset or overwrite existing users (the admin user is only created if absent).

## 5. Consolidate roles 8 → 4 (after seed)
```bash
# Dry run — prints the plan, writes nothing:
npx ts-node backend/scripts/migrate-roles-8-to-4.ts

# Review the output, then apply:
npx ts-node backend/scripts/migrate-roles-8-to-4.ts --apply
```
Mapping:

| Legacy role | → Target |
|---|---|
| SUPER_ADMIN | SUPER_ADMIN |
| IT_ADMIN | SUPER_ADMIN |
| QA_ADMIN | SUPERVISOR |
| DEPARTMENT_HEAD | SUPERVISOR |
| TRAINING_COORDINATOR | SUPERVISOR |
| AUDITOR | SUPERVISOR |
| TRAINER | TRAINER |
| TRAINEE | TRAINEE |

The script reassigns each user's membership to the mapped target **before** deactivating the legacy `UserRole`, and finally warns if any active user would be left with zero active roles (none should be).

## 6. Post-migration sanity
- Log in as the seeded `admin` and confirm dashboard loads.
- Confirm a representative QA_ADMIN/AUDITOR user can still log in and now shows the `SUPERVISOR` role.
- Roles list shows only the 4 active roles; legacy roles are hidden (soft-deactivated) but present for audit.
