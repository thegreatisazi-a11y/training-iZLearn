import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { Request, type RequestHandler } from 'express';
import { env } from '../config/env';
import { ensureDir, generateStoredName, getExtension, hasDangerousDoubleExtension } from '../utils/fileUtils';
import { ALLOWED_MATERIAL_EXTENSIONS } from '@izlearn/shared';
import { AppError, asyncHandler } from '../utils/response';
import { getUploadLimitBytes, uploadLimitMessage } from '../services/uploadPolicy.service';

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = getExtension(file.originalname);
  if (!ext || !(ALLOWED_MATERIAL_EXTENSIONS as readonly string[]).includes(ext)) {
    return cb(AppError.badRequest(`File type ".${ext}" is not permitted.`));
  }
  if (hasDangerousDoubleExtension(file.originalname)) {
    return cb(AppError.badRequest('File name contains a disallowed double extension.'));
  }
  cb(null, true);
}

/** Resolve the saved per-file policy on each request, never a startup-time ceiling. */
function configuredUpload(field: string, maxCount: number | undefined, excel: boolean): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const maxBytes = await getUploadLimitBytes();
    ensureDir(env.storage.tmp);
    const temporaryFiles = new Set<string>();
    const cleanup = () => {
      for (const file of temporaryFiles) {
        try { fs.rmSync(file, { force: true }); } catch { /* Retry when Multer finishes a disconnected request. */ }
      }
    };
    res.once('finish', cleanup);
    res.once('close', cleanup);
    const upload = multer({
      storage: multer.diskStorage({
        destination: env.storage.tmp,
        filename: (_request, file, callback) => {
          const name = generateStoredName(file.originalname);
          temporaryFiles.add(path.join(env.storage.tmp, name));
          callback(null, name);
        },
      }),
      fileFilter: excel ? (_request, file, callback) => {
        const ext = getExtension(file.originalname);
        if (ext === 'xls' || ext === 'xlsx') return callback(null, true);
        callback(AppError.badRequest('Only .xls / .xlsx files are accepted.'));
      } : fileFilter,
      limits: maxBytes > 0 ? { fileSize: maxBytes } : {},
    });
    const handler = maxCount === undefined ? upload.single(field) : upload.array(field, maxCount);
    handler(req, res, (error) => {
      if (error) {
        cleanup();
        return next(error instanceof multer.MulterError
          ? AppError.badRequest(error.code === 'LIMIT_FILE_SIZE' ? uploadLimitMessage(maxBytes) : 'Unexpected uploaded file or too many files.')
          : error);
      }
      if (res.destroyed) { cleanup(); return; }
      next();
    });
  });
}

export const uploadFile = {
  single: (field: string) => configuredUpload(field, undefined, false),
  array: (field: string, maxCount: number) => configuredUpload(field, maxCount, false),
};

/** Excel uploads stream to disk; parsing starts only after the size policy passes. */
export const uploadExcel = { single: (field: string) => configuredUpload(field, undefined, true) };

export async function readUploadBuffer(file: Express.Multer.File): Promise<Buffer> {
  return file.buffer ?? fs.promises.readFile(file.path);
}

export const tmpPath = (filename: string) => path.join(env.storage.tmp, filename);
