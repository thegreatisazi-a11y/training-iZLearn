import multer from 'multer';
import path from 'path';
import { Request } from 'express';
import { env } from '../config/env';
import { ensureDir, generateStoredName, getExtension, hasDangerousDoubleExtension } from '../utils/fileUtils';
import { ALLOWED_MATERIAL_EXTENSIONS } from '@izlearn/shared';

ensureDir(env.storage.tmp);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.storage.tmp),
  filename: (_req, file, cb) => cb(null, generateStoredName(file.originalname)),
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = getExtension(file.originalname);
  if (!ext || !(ALLOWED_MATERIAL_EXTENSIONS as readonly string[]).includes(ext)) {
    return cb(new Error(`File type ".${ext}" is not permitted.`));
  }
  if (hasDangerousDoubleExtension(file.originalname)) {
    return cb(new Error('File name contains a disallowed double extension.'));
  }
  cb(null, true);
}

/**
 * Multer for training materials & documents. A generous hard cap is enforced
 * here; the per-request limit from SystemConfig (`upload.max_size_mb`) is
 * re-checked in the service via validateUpload().
 */
export const uploadFile = multer({
  storage,
  fileFilter,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB hard ceiling
});

/** Excel-only uploads (bulk user creation, attendance) — kept in memory. */
export const uploadExcel = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = getExtension(file.originalname);
    if (ext === 'xls' || ext === 'xlsx') return cb(null, true);
    cb(new Error('Only .xls / .xlsx files are accepted.'));
  },
  limits: { fileSize: 25 * 1024 * 1024 },
});

export const tmpPath = (filename: string) => path.join(env.storage.tmp, filename);
