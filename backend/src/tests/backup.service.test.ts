import fs from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { serialize } from 'bson';

jest.mock('../config/env', () => ({
  env: {
    storage: { root: '', backups: '', tmp: '' },
    mongo: { dumpBin: 'fake-mongodump', restoreBin: 'fake-mongorestore' },
    databaseUrl: 'mongodb://localhost:27017/izlearn',
    r2: { enabled: false, bucket: '', endpoint: '', accessKeyId: '', secretAccessKey: '' },
  },
}));
jest.mock('../services/storage.service', () => ({ storageDriver: () => 'local' }));
jest.mock('../services/auditTrail.service', () => ({ recordEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../config/prisma', () => ({ prisma: {
  $runCommandRaw: jest.fn().mockResolvedValue({ ok: 1 }),
  userSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  electronicSignature: { create: jest.fn().mockResolvedValue({ id: 'signature-1' }) },
} }));
jest.mock('../config/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../services/restoreJobs.service', () => ({ pauseRestoreJobs: jest.fn().mockResolvedValue(undefined), resumeRestoreJobs: jest.fn().mockResolvedValue(undefined), clearPreRestoreJobs: jest.fn().mockResolvedValue(undefined), restoreJobCommand: (work: Promise<unknown>) => work }));
jest.mock('../services/systemConfig.service', () => ({ invalidateConfigCache: jest.fn() }));
jest.mock('../jobs', () => ({ scheduleRepeatableJobs: jest.fn().mockResolvedValue(undefined) }));
jest.mock('child_process', () => {
  const actual = jest.requireActual<typeof import('child_process')>('child_process');
  return { ...actual, execFile: jest.fn((file: string, args: string[], optionsOrCallback: unknown, maybeCallback?: (error: Error | null, stdout?: string, stderr?: string) => void) => {
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (error: Error | null, stdout?: string, stderr?: string) => void;
    if (file === 'fake-mongodump') {
      if (process.env.MOCK_DUMP_FAIL) { callback(new Error('simulated safety backup failure')); return; }
      const magic = Buffer.alloc(4); magic.writeUInt32LE(0x8199e26d);
      const data = Buffer.concat([magic, serialize({ format_version: '0.1' }), serialize({ db: 'izlearn', collection: 'User' }), Buffer.from([255, 255, 255, 255])]);
      fs.writeFileSync(args.find((a) => a.startsWith('--archive='))!.slice('--archive='.length), gzipSync(data));
      callback(null, '', '');
      return;
    }
    if (file === 'fake-mongorestore') { callback(process.env.MOCK_RESTORE_FAIL ? new Error('simulated restore failure') : null, '', ''); return; }
    return actual.execFile(file, args, callback);
  }) };
});

import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { runBackup, listBackups, verifyBackup, restoreBackup, importBackup } from '../services/backup.service';
import { restoreMaintenanceActive } from '../services/restoreMaintenance.service';
import { pauseRestoreJobs, resumeRestoreJobs } from '../services/restoreJobs.service';

describe('complete local backup', () => {
  let work: string;
  beforeEach(() => {
    jest.clearAllMocks();
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'izlearn-backup-test-'));
    env.storage.root = path.join(work, 'files');
    env.storage.backups = path.join(work, 'backups');
    env.storage.tmp = path.join(work, 'tmp');
    fs.mkdirSync(path.join(env.storage.root, 'materials'), { recursive: true });
    fs.writeFileSync(path.join(env.storage.root, 'materials', 'guide.pdf'), 'PDF A');
    process.env.BACKUP_STORAGE_DRIVER = 'local';
    delete process.env.BACKUP_DESTINATION;
    delete process.env.BACKUP_RESTORE_ENABLED;
    delete process.env.MOCK_RESTORE_FAIL;
    delete process.env.MOCK_DUMP_FAIL;
  });
  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
    delete process.env.BACKUP_STORAGE_DRIVER;
    delete process.env.BACKUP_RESTORE_ENABLED;
  });

  it('bundles and verifies database plus uploaded files, then restores the files', async () => {
    const created = await runBackup('test-user');
    expect(created.manifest.filesCount).toBe(1);
    expect((await listBackups()).map((b) => b.file)).toContain(created.file);
    expect((await verifyBackup(created.file)).valid).toBe(true);

    fs.writeFileSync(path.join(env.storage.root, 'materials', 'guide.pdf'), 'changed');
    fs.writeFileSync(path.join(env.storage.root, 'materials', 'newer.pdf'), 'not in snapshot');
    await restoreBackup(created.file, 'test-user', {
      id: 'signature-1', userId: 'test-user', userFullName: 'Test User', recordType: 'Backup',
      recordId: created.file, meaning: 'Performed', signedAt: new Date(), ipAddress: null,
    });
    expect(fs.readFileSync(path.join(env.storage.root, 'materials', 'guide.pdf'), 'utf8')).toBe('PDF A');
    expect(fs.existsSync(path.join(env.storage.root, 'materials', 'newer.pdf'))).toBe(false);
    expect((await listBackups()).length).toBe(2); // includes pre-restore safety snapshot
    expect(pauseRestoreJobs).toHaveBeenCalled();
    expect(resumeRestoreJobs).toHaveBeenCalled();
    expect(restoreMaintenanceActive()).toBe(false);
  });

  it('imports a downloaded bundle under a new name without changing live files', async () => {
    const created = await runBackup('test-user');
    fs.writeFileSync(path.join(env.storage.root, 'materials', 'guide.pdf'), 'live content');
    const imported = await importBackup(path.join(env.storage.backups, created.file), 'test-user');
    expect(imported.valid).toBe(true);
    expect(imported.file).not.toBe(created.file);
    expect((await listBackups()).length).toBe(2);
    expect(fs.readFileSync(path.join(env.storage.root, 'materials', 'guide.pdf'), 'utf8')).toBe('live content');
    expect(pauseRestoreJobs).not.toHaveBeenCalled();
  });

  it('rejects an invalid upload without adding it to the backup list', async () => {
    const file = path.join(work, 'bad.tar.gz');
    fs.writeFileSync(file, 'invalid');
    await expect(importBackup(file, 'test-user')).rejects.toMatchObject({ statusCode: 400 });
    expect(await listBackups()).toHaveLength(0);
  });

  it('keeps maintenance active and workers paused after a destructive restore failure', async () => {
    const created = await runBackup('test-user');
    process.env.MOCK_RESTORE_FAIL = 'true';
    await expect(restoreBackup(created.file, 'test-user', {} as never)).rejects.toMatchObject({ code: 'RESTORE_RECOVERY_REQUIRED' });
    expect(restoreMaintenanceActive()).toBe(true);
    expect(resumeRestoreJobs).not.toHaveBeenCalled();
  });

  it('aborts before database replacement if the safety snapshot fails', async () => {
    const created = await runBackup('test-user');
    process.env.MOCK_DUMP_FAIL = 'true';
    await expect(restoreBackup(created.file, 'test-user', {} as never)).rejects.toThrow('MongoDB backup/recovery tool failed');
    expect(restoreMaintenanceActive()).toBe(false);
    expect(resumeRestoreJobs).toHaveBeenCalled();
    expect(fs.readFileSync(path.join(env.storage.root, 'materials', 'guide.pdf'), 'utf8')).toBe('PDF A');
    expect(prisma.$runCommandRaw).not.toHaveBeenCalled();
  });
});
