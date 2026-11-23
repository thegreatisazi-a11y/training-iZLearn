import express from 'express';
import request from 'supertest';
import router from '../routes/admin.routes';
import { errorHandler } from '../middlewares/errorHandler.middleware';
import { importBackup, restoreBackup } from '../services/backup.service';
import { signFromRequest } from '../services/eSignature.service';

jest.mock('../middlewares/auth.middleware', () => ({ authenticate: (req: any, _res: any, next: any) => {
  req.user = { id: 'test-user', roleNames: [], permissions: { backup: { view: true, approve: req.headers['x-recovery'] === 'yes' } } };
  next();
} }));
jest.mock('../middlewares/backupUpload.middleware', () => ({ uploadBackupBundle: (req: any, _res: any, next: any) => {
  req.file = { path: 'test-upload' }; next();
} }));
jest.mock('../services/backup.service', () => ({ importBackup: jest.fn().mockResolvedValue({ valid: true }), restoreBackup: jest.fn().mockResolvedValue({}), listBackups: jest.fn() }));
jest.mock('../services/auditTrail.service', () => ({ recordEvent: jest.fn() }));
jest.mock('../services/storage.service', () => ({ storageDriver: () => 'local' }));
jest.mock('../jobs/queue', () => ({ backupQueue: {} }));
jest.mock('../services/eSignature.service', () => ({ signFromRequest: jest.fn().mockResolvedValue('signature') }));
jest.mock('../config/prisma', () => ({ prisma: { electronicSignature: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'signature' }) } } }));

const app = express(); app.use(express.json()); app.use('/admin', router); app.use(errorHandler);

describe('backup restore permission and confirmation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects upload and restore without recovery permission', async () => {
    expect((await request(app).post('/admin/backup/upload')).status).toBe(403);
    expect((await request(app).post('/admin/backup/restore').send({ file: 'test', confirmation: 'RESTORE' })).status).toBe(403);
    expect(importBackup).not.toHaveBeenCalled(); expect(restoreBackup).not.toHaveBeenCalled();
  });

  it('imports an authorised upload without triggering a restore', async () => {
    expect((await request(app).post('/admin/backup/upload').set('x-recovery', 'yes')).status).toBe(200);
    expect(importBackup).toHaveBeenCalledWith('test-upload', 'test-user');
    expect(restoreBackup).not.toHaveBeenCalled();
  });

  it('requires typed confirmation before requesting an electronic signature', async () => {
    expect((await request(app).post('/admin/backup/restore').set('x-recovery', 'yes').send({ file: 'test' })).status).toBe(400);
    expect(signFromRequest).not.toHaveBeenCalled();
  });

  it('restores with confirmation and signature even with the obsolete flag set to false', async () => {
    process.env.BACKUP_RESTORE_ENABLED = 'false';
    try {
      expect((await request(app).post('/admin/backup/restore').set('x-recovery', 'yes').send({ file: 'test', confirmation: 'RESTORE' })).status).toBe(200);
      expect(signFromRequest).toHaveBeenCalled(); expect(restoreBackup).toHaveBeenCalled();
    } finally { delete process.env.BACKUP_RESTORE_ENABLED; }
  });
});
