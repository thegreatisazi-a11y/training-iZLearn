import { runBackup } from '../../services/backup.service';

/** Scheduled / manual database backup (Module 16). Delegates to backup.service. */
export async function runBackupJob(data: { triggeredBy?: string }) {
  return runBackup(data?.triggeredBy ?? 'SYSTEM');
}
