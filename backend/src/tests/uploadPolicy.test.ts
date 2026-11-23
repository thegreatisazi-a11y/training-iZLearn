import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { parseUploadLimitBytes, bulkUpdateConfigSchema } from '@izlearn/shared';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { invalidateConfigCache, updateConfig } from '../services/systemConfig.service';
import { uploadFile, uploadExcel, readUploadBuffer } from '../middlewares/upload.middleware';
import { uploadBackupBundle } from '../middlewares/backupUpload.middleware';
import { errorHandler } from '../middlewares/errorHandler.middleware';
import { asyncHandler } from '../utils/response';

jest.mock('../config/prisma', () => ({ prisma: { systemConfig: { findMany: jest.fn(), upsert: jest.fn() } } }));
jest.mock('../config/env', () => ({ env: { storage: { tmp: '' } } }));
jest.mock('../config/logger', () => ({ logger: { error: jest.fn() } }));

const MB = 1024 * 1024;
const app = express();
app.post('/single', uploadFile.single('file'), (req, res) => res.json({ size: req.file?.size }));
app.post('/bulk', uploadFile.array('files', 50), (req, res) => res.json({ count: (req.files as Express.Multer.File[]).length }));
app.post('/excel', uploadExcel.single('file'), asyncHandler(async (req, res) => {
  res.json({ size: (await readUploadBuffer(req.file!)).length });
}));
app.post('/backup', uploadBackupBundle, (req, res) => res.json({ size: req.file?.size }));
app.use(errorHandler);

describe('saved upload size policy', () => {
  let dir: string;
  let saved: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izlearn-upload-policy-'));
    env.storage.tmp = dir;
    saved = '0';
    invalidateConfigCache();
    (prisma.systemConfig.findMany as jest.Mock).mockImplementation(async () => [{ key: 'upload.max_size_mb', value: saved }]);
    (prisma.systemConfig.upsert as jest.Mock).mockImplementation(async (args) => { saved = args.update.value; return {}; });
  });
  afterEach(() => { invalidateConfigCache(); fs.rmSync(dir, { recursive: true, force: true }); });
  const save = (value: string) => updateConfig([{ key: 'upload.max_size_mb', value }], 'test-user');

  it.each(['/single', '/excel', '/backup'])('enforces the configured limit on %s and cleans rejected files', async (url) => {
    await save('0.5');
    const file = url === '/backup' ? 'backup.tar.gz' : url === '/excel' ? 'users.xlsx' : 'course.pdf';
    const response = await request(app).post(url).attach('file', Buffer.alloc(MB), file);
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('0.5 MB');
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('takes saved changes into effect on subsequent requests without restarting', async () => {
    const bytes = Buffer.alloc(MB);
    expect((await request(app).post('/single').attach('file', bytes, 'course.pdf')).status).toBe(200);
    await save('0.5');
    expect((await request(app).post('/single').attach('file', bytes, 'course.pdf')).status).toBe(400);
    await save('2');
    expect((await request(app).post('/single').attach('file', bytes, 'course.pdf')).status).toBe(200);
    await save('0');
    expect((await request(app).post('/single').attach('file', bytes, 'course.pdf')).status).toBe(200);
  });

  it('applies the maximum per file rather than to the bulk request total', async () => {
    await save('1');
    const file = Buffer.alloc(600 * 1024);
    const response = await request(app).post('/bulk').attach('files', file, 'a.pdf').attach('files', file, 'b.pdf');
    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
  });

  it('accepts Excel uploads above the former 25 MB ceiling when configured as unlimited', async () => {
    const response = await request(app).post('/excel').attach('file', Buffer.alloc(26 * MB), 'users.xlsx');
    expect(response.status).toBe(200);
    expect(response.body.size).toBe(26 * MB);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('preserves decimal values and accepts configured sizes above the former 1 GB ceiling', () => {
    expect(parseUploadLimitBytes('0.5')).toBe(MB / 2);
    expect(parseUploadLimitBytes('4096')).toBe(4096 * MB);
    expect(parseUploadLimitBytes('0')).toBe(0);
  });

  it.each(['-1', 'not-a-number', '', 'Infinity'])('rejects invalid size setting %j before any write', async (value) => {
    expect(bulkUpdateConfigSchema.safeParse({ items: [{ key: 'upload.max_size_mb', value }], reasonForChange: 'Test invalid setting' }).success).toBe(false);
    await expect(save(value)).rejects.toMatchObject({ statusCode: 400 });
    expect(saved).toBe('0');
  });
});
