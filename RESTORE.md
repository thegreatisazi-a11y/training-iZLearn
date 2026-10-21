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

The existing scheduled backup job uses `backup.auto_enabled` and `backup.cron_expression`. Manual backups are e-signed and queued; the page shows recent job status and can list, verify, and download bundles. Verify and test-restore a backup periodically; a successful upload alone does not prove recovery. A sleeping/free Render instance is not a reliable scheduler—use an always-on backend/worker or an external scheduler until the physical server is running.

Schedule backups during a quiet period. The MongoDB dump and file copy are sequential, not an atomic cross-system snapshot. Do not update or delete training materials while a backup is in progress. For a strict recovery point, stop application writes during backup.

## Restore procedure

1. Prepare a maintenance window and prevent users from writing to the application. Record the desired archive and the matching application release.
2. Confirm backup storage is reachable and there is enough temporary disk space. Keep the current environment/secrets and TLS/tunnel settings outside the archive.
3. Verify the archive from the Backup & Restore page. Temporarily set `BACKUP_RESTORE_ENABLED=true` and restart the backend. This setting is **false by default**.
4. Select **Restore**, type `RESTORE`, and provide an electronic signature. The backend verifies both archive checksums, creates a new safety backup of the current state, restores MongoDB with `--drop`, replaces the uploaded files, disables restored login sessions, and records a restore event.
5. Set `BACKUP_RESTORE_ENABLED=false` again, restart the backend, log in afresh, and check representative users, roles, course materials, certificates, and reports.

Restore is destructive and is not atomic across MongoDB and the file store. If either stage fails, keep the site in maintenance mode and use the automatically created `PRE_RESTORE` safety backup or another verified archive to recover. Never expose MongoDB's port to remote users.

For a completely lost server, first reinstall the matching application release and recreate secrets/deployment settings; then provide the archive in the configured backup destination and follow the restore steps. If the archive is in R2, configure the backup bucket credentials before starting the backend.
