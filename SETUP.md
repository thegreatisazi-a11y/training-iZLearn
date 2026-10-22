# Explicit database setup and release updates

The backend image starts only the API. It no longer runs `prisma db push` or seed on
every restart. A missing release marker or active system administrator stops startup
with a clear error rather than serving a partially configured application.

For a fresh database, in a maintenance window:

1. Set `DATABASE_URL` and a unique `SEED_ADMIN_PASSWORD` (12+ characters; not
   `ChangeMe@123`) in protected deployment secrets. Keep the password out of logs.
2. Run `npx prisma db push --skip-generate` from the backend image/workspace.
3. Run `npm run setup:bootstrap -w backend` (or `npm run setup:bootstrap` inside
   the backend container). This creates baseline roles/config/masters and atomically
   creates the first user, system-role link, and password history.
   It refuses to create a new administrator if any user already exists, even if
   `SEED_ADMIN_USERNAME` was changed accidentally.
4. Run `npm run setup:release -w backend` (or inside the backend container).
5. Start the API, sign in, change the initial password, and verify the admin role.

For an existing database, **take and verify a backup first**. Run schema sync,
then `npm run setup:audit -w backend`. Review any duplicate role identities or
roleless bootstrap administrator before proceeding. Run `setup:release` once for
this release and only then deploy/start the new API. The release command records
an idempotent `migration.release_2026_10_bootstrap_split_v1` marker; later runs
do not reset deliberately edited permissions. It never creates an admin.
If Render auto-deploys on commit, run these steps from the updated local checkout
against the backed-up Atlas database **before** committing/deploying the new image,
or pause auto-deploy for a maintenance window. Otherwise the new API correctly
refuses to start until release setup is complete.

If the audit finds the specific SYSTEM-created bootstrap account without any
active role, confirm its ID manually and run `setup:repair-admin` with
`REPAIR_BOOTSTRAP_ADMIN_ID=<exact-id>`. In the server Compose stack, pass it
only to the one-off command with `docker compose -f docker-compose.server.yml
run --rm -e REPAIR_BOOTSTRAP_ADMIN_ID=<exact-id> backend npm run setup:repair-admin`.
This command refuses another user,
an existing active role, or an ambiguous system role. It never changes a
password. Do not use it to grant access to an arbitrary account.

Role names are display labels. `isSystem` is the protected role identity;
spaces, underscores and case are equivalent only when checking for name
collisions and matching legacy records. The legacy `Super Admin`/`SUPER_ADMIN`
name remains reserved for the system role after a rename. Duplicate legacy roles require explicit
operator reconciliation; setup does not merge them automatically.

The database backup contains application data and uploads, not code or deployment
secrets. Keep the release image, environment secrets, and backup together in
your recovery procedure. Test a restore against a disposable environment.
