import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError, asyncHandler } from '../utils/response';
import { getUploadLimitBytes, uploadLimitMessage } from '../services/uploadPolicy.service';

export const uploadBackupBundle: RequestHandler = asyncHandler(async (req, res, next) => {
  const maxBytes = await getUploadLimitBytes();
  fs.mkdirSync(env.storage.tmp, { recursive: true });
  let temporaryFile: string | undefined;
  const cleanup = () => {
    if (temporaryFile) {
      try { fs.rmSync(temporaryFile, { force: true }); } catch { /* Multer may still own the file on a disconnected upload. */ }
    }
  };
  res.once('finish', cleanup);
  res.once('close', cleanup);
  const upload = multer({
    storage: multer.diskStorage({
      destination: env.storage.tmp,
      filename: (_request, _file, callback) => {
        const name = `backup-upload-${crypto.randomUUID()}.tar.gz`;
        temporaryFile = path.join(env.storage.tmp, name);
        callback(null, name);
      },
    }),
    limits: { files: 1, fields: 0, ...(maxBytes > 0 ? { fileSize: maxBytes } : {}) },
    fileFilter: (_request, file, callback) => {
      if (!file.originalname.toLowerCase().endsWith('.tar.gz')) return callback(AppError.badRequest('Select an izLearn .tar.gz backup bundle.'));
      callback(null, true);
    },
  }).single('file');
  upload(req, res, (error) => {
    if (error) {
      cleanup();
      return next(error instanceof multer.MulterError
        ? AppError.badRequest(error.code === 'LIMIT_FILE_SIZE' ? uploadLimitMessage(maxBytes) : 'Upload exactly one backup file.') : error);
    }
    next();
  });
});
