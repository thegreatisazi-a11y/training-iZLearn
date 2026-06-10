import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dayjs from 'dayjs';
import { env } from '../config/env';
import { ensureDir } from '../utils/fileUtils';
import { getConfig } from './systemConfig.service';
import { recordEvent } from './auditTrail.service';
import { logger } from '../config/logger';

const execAsync = promisify(exec);

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Run mongodump (gzip archive) and write a SHA-256 checksum sidecar (Module 16).
 * Used by both the scheduled backup job and the manual SUPER_ADMIN trigger.
 */
export async function runBackup(triggeredBy: string): Promise<{ file: string; checksum: string; sizeBytes: number }> {
  const dest = (await getConfig('backup.destination_path')) || env.storage.backups;
  ensureDir(dest);
  const stamp = dayjs().format('YYYYMMDD-HHmmss');
  const file = path.join(dest, `izlearn-${stamp}.archive.gz`);

  await execAsync(`${env.mongo.dumpBin} --uri="${env.databaseUrl}" --archive="${file}" --gzip`, { maxBuffer: 1024 * 1024 * 128 });

  const checksum = await sha256File(file);
  fs.writeFileSync(`${file}.sha256`, `${checksum}  ${path.basename(file)}\n`, 'utf8');
  const sizeBytes = fs.statSync(file).size;

  await recordEvent({
    action: 'BACKUP_TRIGGERED',
    entityType: 'Backup',
    entityId: path.basename(file),
    newValue: { file, checksum, sizeBytes, triggeredBy },
  });
  logger.info(`Backup written: ${file} (${sizeBytes} bytes, sha256 ${checksum.slice(0, 12)}…)`);
  return { file, checksum, sizeBytes };
}

export async function listBackups() {
  const dest = (await getConfig('backup.destination_path')) || env.storage.backups;
  ensureDir(dest);
  return fs
    .readdirSync(dest)
    .filter((f) => f.endsWith('.gz') || f.endsWith('.archive'))
    .map((f) => {
      const full = path.join(dest, f);
      const st = fs.statSync(full);
      const checksumFile = `${full}.sha256`;
      return {
        file: f,
        sizeBytes: st.size,
        createdAt: st.mtime.toISOString(),
        hasChecksum: fs.existsSync(checksumFile),
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Resolve a backup file name to its absolute path inside the backup directory (path-traversal safe). */
async function resolveBackupPath(fileName: string): Promise<string> {
  const dest = (await getConfig('backup.destination_path')) || env.storage.backups;
  const safeName = path.basename(fileName); // strip any directory components
  const full = path.join(dest, safeName);
  if (!fs.existsSync(full)) throw new Error(`Backup file not found: ${safeName}`);
  return full;
}

/**
 * Verify a backup's integrity by recomputing its SHA-256 and comparing it to the
 * sidecar checksum file written at backup time (Module 16 / UR-56).
 */
export async function verifyBackup(fileName: string): Promise<{ file: string; valid: boolean; expected?: string; actual: string }> {
  const full = await resolveBackupPath(fileName);
  const actual = await sha256File(full);
  const sidecar = `${full}.sha256`;
  let expected: string | undefined;
  if (fs.existsSync(sidecar)) {
    expected = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0];
  }
  const valid = expected !== undefined && expected === actual;
  await recordEvent({
    action: 'BACKUP_VERIFIED',
    entityType: 'Backup',
    entityId: path.basename(full),
    newValue: { valid, expected, actual },
  });
  return { file: path.basename(full), valid, expected, actual };
}

/**
 * Restore the database from a previously generated mongodump archive (UR-56).
 * The checksum is verified first; a corrupt/mismatched backup is refused. This is
 * a destructive operation (--drop) — gated behind SUPER_ADMIN + e-signature at the route.
 */
export async function restoreBackup(fileName: string, triggeredBy: string): Promise<{ file: string; restoredAt: string }> {
  const full = await resolveBackupPath(fileName);

  const integrity = await verifyBackup(fileName);
  if (integrity.expected !== undefined && !integrity.valid) {
    throw new Error('Backup checksum mismatch — restore aborted to protect data integrity.');
  }

  await execAsync(`${env.mongo.restoreBin} --uri="${env.databaseUrl}" --archive="${full}" --gzip --drop`, { maxBuffer: 1024 * 1024 * 128 });

  await recordEvent({
    action: 'BACKUP_RESTORED',
    entityType: 'Backup',
    entityId: path.basename(full),
    newValue: { file: path.basename(full), triggeredBy, checksumVerified: integrity.valid },
  });
  logger.warn(`Database restored from backup: ${full} (by ${triggeredBy})`);
  return { file: path.basename(full), restoredAt: new Date().toISOString() };
}
