import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, AppError } from '../utils/response';
import { runBackup, listBackups, verifyBackup, restoreBackup } from '../services/backup.service';
import { signFromRequest } from '../services/eSignature.service';

/** Manual backup — SUPER_ADMIN only, e-signed (Module 16). */
export const triggerBackup = asyncHandler(async (req: Request, res: Response) => {
  await signFromRequest(req, 'Backup', 'manual', 'Performed');
  const result = await runBackup(req.user!.id);
  sendSuccess(res, result, 'Backup completed successfully');
});

export const backups = asyncHandler(async (_req, res) => sendSuccess(res, await listBackups()));

/** Verify a backup's SHA-256 against its checksum sidecar (UR-56). */
export const verify = asyncHandler(async (req: Request, res: Response) => {
  const file = (req.body?.file ?? req.params.file ?? '').toString();
  if (!file) throw AppError.badRequest('A backup file name is required.');
  sendSuccess(res, await verifyBackup(file), 'Backup verification complete');
});

/** Restore the database from a backup — SUPER_ADMIN only, e-signed, destructive (UR-56). */
export const restore = asyncHandler(async (req: Request, res: Response) => {
  const file = (req.body?.file ?? '').toString();
  if (!file) throw AppError.badRequest('A backup file name is required.');
  await signFromRequest(req, 'Backup', file, 'Performed');
  const result = await restoreBackup(file, req.user!.id);
  sendSuccess(res, result, 'Database restored from backup');
});
