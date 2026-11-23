import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Request, RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError } from '../utils/response';

const requests = new Set<Request>();
export const maintenanceFile = () => path.join(process.env.BACKUP_DESTINATION || env.storage.backups, '.restore-maintenance.json');
export const restoreMaintenanceActive = () => fs.existsSync(maintenanceFile());

/** Installed before API authentication: no DB reads/writes while it is being replaced. */
export const restoreMaintenanceGuard: RequestHandler = (req, res, next) => {
  if (req.path === '/api/maintenance/status' && req.method === 'GET') {
    res.json({ maintenance: restoreMaintenanceActive() });
    return;
  }
  if (restoreMaintenanceActive()) {
    res.setHeader('Retry-After', '30');
    res.status(503).json({ success: false, error: { code: 'RESTORE_MAINTENANCE', message: 'The website is undergoing backup recovery. Please try again later.' } });
    return;
  }
  requests.add(req);
  const finish = () => requests.delete(req);
  res.once('finish', finish);
  res.once('close', finish);
  next();
};

export function acquireRestoreMaintenance(file: string) {
  const location = maintenanceFile();
  fs.mkdirSync(path.dirname(location), { recursive: true });
  const id = crypto.randomUUID();
  try { fs.writeFileSync(location, JSON.stringify({ id, file, phase: 'preparing', startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw AppError.conflict('Recovery maintenance is already active.');
    throw error;
  }
  return {
    update(phase: string, safetyBackup?: string) {
      fs.writeFileSync(location, JSON.stringify({ id, file, phase, safetyBackup, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    },
    release() {
      if (JSON.parse(fs.readFileSync(location, 'utf8')).id !== id) throw new Error('Maintenance lock ownership changed.');
      fs.unlinkSync(location);
    },
  };
}

export async function drainWebsiteRequests(exclude?: Request, timeoutMs = 60000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while ([...requests].some((request) => request !== exclude)) {
    if (Date.now() >= until) throw AppError.conflict('Active website requests did not finish. Try restoring again after they finish.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
