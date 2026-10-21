import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, AppError } from '../utils/response';
import { listBackups, verifyBackup, restoreBackup, openBackupArchive } from '../services/backup.service';
import { signFromRequest } from '../services/eSignature.service';
import { recordEvent } from '../services/auditTrail.service';
import { storageDriver } from '../services/storage.service';
import { env } from '../config/env';
import { backupQueue } from '../jobs/queue';
import { prisma } from '../config/prisma';

/** Manual backup — backup:create permission, e-signed and queued (Module 16). */
export const triggerBackup = asyncHandler(async (req: Request, res: Response) => {
  await signFromRequest(req, 'Backup', 'manual', 'Performed');
  const job = await backupQueue.add({ triggeredBy: req.user!.id }, { removeOnComplete: 50, removeOnFail: 50 });
  sendSuccess(res, { jobId: job.id }, 'Backup queued');
});

export const backups = asyncHandler(async (_req, res) => {
  const [items, jobs] = await Promise.all([
    listBackups(),
    backupQueue.getJobs(['active', 'waiting', 'failed', 'completed'], 0, 9).catch(() => []),
  ]);
  sendSuccess(res, {
    items,
    jobs: await Promise.all(jobs.map(async (job) => ({
      id: job.id, status: await job.getState().catch(() => 'unknown'), failedReason: job.failedReason || null,
      timestamp: job.timestamp, finishedOn: job.finishedOn || null,
    }))),
    fileStorage: storageDriver(),
    backupStorage: process.env.BACKUP_STORAGE_DRIVER || (env.r2.enabled ? 'r2' : 'local'),
    restoreEnabled: process.env.BACKUP_RESTORE_ENABLED === 'true',
  });
});

/** Verify a backup's SHA-256 against its checksum sidecar (UR-56). */
export const verify = asyncHandler(async (req: Request, res: Response) => {
  const file = (req.body?.file ?? req.params.file ?? '').toString();
  if (!file) throw AppError.badRequest('A backup file name is required.');
  sendSuccess(res, await verifyBackup(file), 'Backup verification complete');
});

export const download = asyncHandler(async (req: Request, res: Response) => {
  const file = (req.params.file ?? '').toString();
  const archive = await openBackupArchive(file);
  await recordEvent({ action: 'BACKUP_DOWNLOADED', entityType: 'Backup', entityId: file });
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
  if (archive.size) res.setHeader('Content-Length', archive.size);
  archive.stream.on('error', () => res.destroy());
  archive.stream.pipe(res);
});

/** Restore all website data — backup:approve permission, e-signed, maintenance-only. */
export const restore = asyncHandler(async (req: Request, res: Response) => {
  const file = (req.body?.file ?? '').toString();
  if (!file) throw AppError.badRequest('A backup file name is required.');
  if (process.env.BACKUP_RESTORE_ENABLED !== 'true') throw AppError.forbidden('Restore is disabled outside a maintenance window.');
  const signatureId = await signFromRequest(req, 'Backup', file, 'Performed');
  const signature = await prisma.electronicSignature.findUniqueOrThrow({ where: { id: signatureId } });
  const result = await restoreBackup(file, req.user!.id, signature);
  sendSuccess(res, result, 'Database restored from backup');
});
