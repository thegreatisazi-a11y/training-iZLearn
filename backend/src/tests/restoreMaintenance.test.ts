import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { acquireRestoreMaintenance, drainWebsiteRequests, restoreMaintenanceActive, restoreMaintenanceGuard } from '../services/restoreMaintenance.service';

jest.mock('../config/env', () => ({ env: { storage: { backups: '' } } }));

describe('restore maintenance protection', () => {
  let dir: string;
  const previous = process.env.BACKUP_DESTINATION;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izlearn-maintenance-')); process.env.BACKUP_DESTINATION = dir; });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.BACKUP_DESTINATION; else process.env.BACKUP_DESTINATION = previous;
  });

  const request = (url = '/api/users') => ({ path: url, method: 'GET' }) as Request;
  function response() {
    const res = new EventEmitter() as EventEmitter & { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock };
    res.status = jest.fn(() => res);
    res.json = jest.fn();
    res.setHeader = jest.fn();
    return res;
  }

  it('blocks new API requests without touching authentication while maintenance exists', () => {
    const lock = acquireRestoreMaintenance('backup');
    const next = jest.fn();
    const res = response();
    restoreMaintenanceGuard(request(), res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
    expect(restoreMaintenanceActive()).toBe(true);
    expect(() => acquireRestoreMaintenance('other')).toThrow('already active');
    lock.release();
    expect(restoreMaintenanceActive()).toBe(false);
  });

  it('waits for existing requests while excluding the initiating restore request', async () => {
    const ordinary = request();
    const initiating = request('/api/admin/backup/restore');
    const otherResponse = response();
    const initiatingResponse = response();
    restoreMaintenanceGuard(ordinary, otherResponse as unknown as Response, jest.fn());
    restoreMaintenanceGuard(initiating, initiatingResponse as unknown as Response, jest.fn());
    const lock = acquireRestoreMaintenance('backup');
    try {
      await expect(drainWebsiteRequests(initiating, 1)).rejects.toMatchObject({ statusCode: 409 });
      otherResponse.emit('finish');
      await expect(drainWebsiteRequests(initiating, 1)).resolves.toBeUndefined();
    } finally { otherResponse.emit('close'); initiatingResponse.emit('close'); lock.release(); }
  });

  it('offers only a public maintenance boolean while requests are blocked', () => {
    acquireRestoreMaintenance('private-backup-name');
    const res = response();
    restoreMaintenanceGuard(request('/api/maintenance/status'), res as unknown as Response, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ maintenance: true });
  });
});
