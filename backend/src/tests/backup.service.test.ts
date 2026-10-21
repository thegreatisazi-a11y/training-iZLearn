import fs from 'fs';
import os from 'os';
import path from 'path';

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
  userSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  electronicSignature: { create: jest.fn().mockResolvedValue({ id: 'signature-1' }) },
} }));
jest.mock('../config/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('child_process', () => {
  const actual = jest.requireActual<typeof import('child_process')>('child_process');
  return { ...actual, execFile: jest.fn((file: string, args: string[], optionsOrCallback: unknown, maybeCallback?: (error: Error | null, stdout?: string, stderr?: string) => void) => {
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (error: Error | null, stdout?: string, stderr?: string) => void;
    if (file === 'fake-mongodump') {
      fs.writeFileSync(args.find((a) => a.startsWith('--archive='))!.slice('--archive='.length), 'example dump');
      callback(null, '', '');
      return;
    }
    if (file === 'fake-mongorestore') { callback(null, '', ''); return; }
    return actual.execFile(file, args, callback);
  }) };
});

import { env } from '../config/env';
import { runBackup, listBackups, verifyBackup, restoreBackup } from '../services/backup.service';

describe('complete local backup', () => {
  let work: string;
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'izlearn-backup-test-'));
    env.storage.root = path.join(work, 'files');
    env.storage.backups = path.join(work, 'backups');
    env.storage.tmp = path.join(work, 'tmp');
    fs.mkdirSync(path.join(env.storage.root, 'materials'), { recursive: true });
    fs.writeFileSync(path.join(env.storage.root, 'materials', 'guide.pdf'), 'PDF A');
    process.env.BACKUP_STORAGE_DRIVER = 'local';
    delete process.env.BACKUP_DESTINATION;
    delete process.env.BACKUP_RESTORE_ENABLED;
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
    process.env.BACKUP_RESTORE_ENABLED = 'true';
    await restoreBackup(created.file, 'test-user', {
      id: 'signature-1', userId: 'test-user', userFullName: 'Test User', recordType: 'Backup',
      recordId: created.file, meaning: 'Performed', signedAt: new Date(), ipAddress: null,
    });
    expect(fs.readFileSync(path.join(env.storage.root, 'materials', 'guide.pdf'), 'utf8')).toBe('PDF A');
    expect(fs.existsSync(path.join(env.storage.root, 'materials', 'newer.pdf'))).toBe(false);
    expect((await listBackups()).length).toBe(2); // includes pre-restore safety snapshot
  });
});
