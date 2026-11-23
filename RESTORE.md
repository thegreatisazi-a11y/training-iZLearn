# Complete izLearn backup and restore

The Backup & Restore page (`/backups`) creates one `izlearn-full-*.tar.gz` bundle containing:

- `database.archive.gz`: every collection in the application MongoDB database, including users, roles, settings, audit records, sessions, and Mongo-backed `FileBlob` objects.
- `files.tar.gz`: uploaded files from the selected file-storage driver (`local` or R2). This is empty when files are stored in MongoDB.
- `manifest.json`: creation time, app-version identifier, storage mode, file count, and SHA-256 checksums for both archives.

The archive restores *website data*, not the executable deployment. Keep the Git release/commit, Docker Compose file, TLS/tunnel configuration, and environment secrets in a separate protected recovery record. The manifest's `appVersion` helps identify the matching release. Do not put secrets into downloadable in-app backups.
Redis/Bull queue state (such as in-flight emails) is not included; repeatable schedules are registered again when the backend starts.

## Storage configuration

- `STORAGE_DRIVER=local` makes the server's `STORAGE_ROOT` volume the live file store, even if R2 credentials are configured for backups.
- `BACKUP_STORAGE_DRIVER=local` writes archives to `BACKUP_DESTINATION` (on the server: `/app/backups`). Copy these archives to a separate disk, NAS, or off-site destination. A second volume on the same physical machine is not disaster recovery.
- `BACKUP_STORAGE_DRIVER=r2` writes archives to `backups/` in `BACKUP_R2_BUCKET` (or `R2_BUCKET` if the dedicated bucket is unset). R2 credentials must have access to the backup bucket. A dedicated private bucket is recommended.
- The backend needs temporary free disk space for a full database dump, a copy of uploaded files, and the compressed bundle. R2 single-object upload is currently limited to 5 GB per bundle; implement multipart upload before backups approach that size.
- No automatic pruning is enabled yet. Monitor backup capacity and define a retention policy before accumulating large files or videos.
- The legacy `backup.destination_path` System Configuration value is not used by the new bundle writer. Set `BACKUP_DESTINATION` in deployment configuration instead.

## Routine operation

The existing scheduled backup job uses `backup.auto_enabled` and `backup.cron_expression`. Manual backups are e-signed and queued; the page shows recent job status and can list, verify, download, and upload bundles. Upload and Restore use the existing `backup:approve` permission; grant it only to the authorised recovery administrators in Roles & Access Control. Uploading never starts a restore.

Uploads accept one izLearn `.tar.gz` bundle. System Configuration `upload.max_size_mb` controls the per-file maximum; `0` means no configured limit. There is no fixed upload ceiling or total decompressed-size cap. Uploads and extraction stream to disk; available disk space, filesystem limits and proxy request timeouts still apply. Each import gets a new generated filename, preserving existing snapshots. Validation checks the three expected outer members, manifest fields, SHA-256 checksums, database gzip integrity and MongoDB archive prelude, inner file count and archive paths. The archive must contain exactly the configured application database name; use a separate reviewed database migration when renaming databases. Restore is restricted to that namespace and stops on database errors. Links, devices and duplicate paths are rejected. In-memory metadata limits and the 100,000-entry limit remain to protect the parser. R2's existing 5 GB single-object storage limit applies only when using R2 backup storage. Checksums detect corruption, not a malicious author who can rewrite the manifest: import only trusted company backups. Validation is not a substitute for a test restore.

A sleeping/free Render instance is not a reliable scheduler—use an always-on backend/worker or an external scheduler until the physical server is running.

Schedule backups during a quiet period. The MongoDB dump and file copy are sequential, not an atomic cross-system snapshot. Do not update or delete training materials while a backup is in progress. For a strict recovery point, stop application writes during backup.

## Restore procedure

1. Plan a maintenance window and record the desired archive and matching application release. For a downloaded bundle, use **Upload backup** and wait for validation to finish; otherwise select an existing listed backup.
2. Confirm backup storage is reachable and there is enough temporary disk space. Keep the current environment/secrets and TLS/tunnel settings outside the archive.
3. Select **Restore** to validate and review the snapshot's date, app version, file count and storage mode. Mongo-file backups require Mongo file storage; local/R2-file backups can restore into local or R2 storage. Use a matching application release.
4. Type `RESTORE` and provide an electronic signature. The backend blocks new HTTP requests, drains existing requests, globally pauses all Bull queues and waits for active jobs, then creates a current safety backup. Only then does it drop the dedicated application database, restore the verified namespace, replace uploaded files, disable all restored login sessions, and record the restore event. The database account needs permission to drop and recreate this dedicated database. Do not share the database with another application.
5. On success, configuration caches are cleared. Queued work from the superseded database is discarded, repeatable jobs are scheduled from the restored settings, and queues and website access resume. Sign in again with an account from the restored snapshot and check representative users, roles, materials, certificates and reports.

There is no environment-variable gate for normal restore: `BACKUP_RESTORE_ENABLED` is obsolete and can be removed from existing `.env` files. Backend and frontend images both need rebuilding for this change. No database migration is required.

The guard targets the current **single API process / single backend container** deployment, with a persistent backup volume. Do not use in-app restore with multiple API replicas or other applications writing to the same database/storage; stop all other writers separately. The marker is `/app/backups/.restore-maintenance.json` in the server layout, outside the restored live file tree. Keep this volume mounted across restarts. `/api/maintenance/status` reports only whether maintenance is active. An interrupted restore remains blocked across backend restarts; restarting alone does not clear maintenance. Reverse proxies must allow long backup requests; the supplied HTTP/HTTPS nginx configs allow one hour.

Restore is destructive and is not atomic across MongoDB and the file store. If validation, draining or the safety backup fails before replacement begins, ordinary operation resumes. If failure occurs after replacement begins, the persistent maintenance marker and queue pause remain active. Never expose MongoDB's port to remote users.

## Operator recovery after a failed/interrupted restore

Keep users out. Read the maintenance marker for the `safetyBackup` filename. Stop **all backend instances** before offline recovery. Use the same Compose files and HTTPS override as the deployment; for the base server layout:

```bash
sudo docker compose -f docker-compose.server.yml stop backend
sudo docker compose -f docker-compose.server.yml run --rm --no-deps \
  -e BACKUP_OFFLINE_RECOVERY=true backend \
  npx tsx scripts/recover-backup.ts izlearn-full-YYYYMMDDTHHMMSS-1234abcd.tar.gz RESTORE
```

Replace the example with the safety backup or another trusted listed filename. This is a destructive console operation for an authorised server operator. It is audited as SYSTEM/offline recovery, not as a fabricated user e-signature. The flag is supplied only to the one-off command; never enable it permanently on the API. The command preserves the old marker for diagnosis, validates and stages the archive, creates another safety snapshot, and retains maintenance on failure. After success:

```bash
sudo docker compose -f docker-compose.server.yml up -d backend
```

Check health and sign in again. If recovery still fails or the snapshot needs another application release, leave the API stopped and investigate before clearing any marker manually.

For a completely lost server, first reinstall the matching application release and recreate secrets/deployment settings; then provide the archive in the configured backup destination and follow the restore steps. If the archive is in R2, configure the backup bucket credentials before starting the backend.
