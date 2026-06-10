# izLearn — Backup Restore & Disaster Recovery

**Recovery objectives:** RPO = 24 hours (daily automated backup) · RTO = 4 hours.

Backups are PostgreSQL `pg_dump` plain-SQL files named `izlearn-YYYYMMDD-HHmmss.sql`, each accompanied
by a `*.sha256` checksum, written to `backup.destination_path` (default `/app/backups` in Docker, or
`./storage/backups` locally).

---

## 1. Locate and verify the backup

```bash
ls -lt /path/to/backups            # newest dumps first
./scripts/verify-backup.sh /path/to/backups/izlearn-YYYYMMDD-HHmmss.sql
```
Proceed only if the script prints `OK: checksum matches`.

## 2. Stop the application (keep the database running)

```bash
docker compose stop backend frontend
```

## 3. Restore into a clean database

> Restoring overwrites data. Take a fresh `pg_dump` of the current state first if it may be needed.

```bash
# Drop & recreate the database (adjust user/db names to your .env)
docker compose exec postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";" \
  -c "CREATE DATABASE \"$POSTGRES_DB\";"

# Load the dump
cat /path/to/backups/izlearn-YYYYMMDD-HHmmss.sql | \
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

For a non-Docker setup:
```bash
dropdb izlearn && createdb izlearn
psql "$DATABASE_URL" -f izlearn-YYYYMMDD-HHmmss.sql
```

## 4. Confirm migrations & immutability triggers are intact

The dump includes the schema and the `pgcrypto` extension. Verify the triggers are present:

```bash
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT tgname FROM pg_trigger WHERE tgname IN ('audit_trail_immutable','electronic_signature_immutable');"
```
You must see **both** triggers. If missing (e.g. an older dump), re-apply them:
```bash
docker compose run --rm backend npx prisma migrate deploy
```

## 5. Restart and validate

```bash
docker compose start backend frontend
curl -s http://localhost:4000/api/health   # expect "status":"ok" with all checks true
```
Then log in and spot-check that recent records and the audit trail are present and that
`auditImmutabilityTrigger` is `true` in the health response.

## 6. Record the recovery

Log the restore event (date, operator, backup file, checksum, reason) per your SOP. The post-restore
system continues to capture all subsequent actions in the immutable audit trail.

---

## Notes

- Uploaded files (training materials, personal documents, generated certificates) live on the
  `storage` volume, **not** in the database dump. Back up and restore that volume alongside the DB for a
  complete recovery (e.g. `docker run --rm -v izlearn_storage:/data -v $PWD:/backup alpine tar czf /backup/storage.tgz /data`).
- Never edit a dump by hand — it would invalidate the checksum and break traceability.
