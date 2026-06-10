import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { logger } from '../config/logger';
import { AppError } from './response';
import { ALLOWED_MATERIAL_EXTENSIONS } from '@izlearn/shared';

/** Accepted MIME types per extension — BOTH must match (Module 15 §6). */
const MIME_BY_EXT: Record<string, string[]> = {
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  mp4: ['video/mp4'],
  avi: ['video/x-msvideo', 'video/avi'],
  mov: ['video/quicktime'],
  png: ['image/png'],
  jpg: ['image/jpeg', 'image/jpg'],
  jpeg: ['image/jpeg', 'image/jpg'],
};

const DANGEROUS_EXT = new Set([
  'exe', 'bat', 'cmd', 'sh', 'js', 'mjs', 'jar', 'msi', 'com', 'scr', 'ps1', 'vbs', 'dll', 'php', 'py', 'rb',
]);

export function getExtension(filename: string): string {
  return path.extname(filename).replace('.', '').toLowerCase();
}

/** Strip directory separators and null bytes; keep a safe base name. */
export function sanitizeFilename(filename: string): string {
  return path
    .basename(filename)
    .replace(/\0/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 200);
}

/** Detect a disguised double extension such as `report.pdf.exe`, `x.exe.pdf` or `a.docx.js`. */
export function hasDangerousDoubleExtension(filename: string): boolean {
  const parts = sanitizeFilename(filename).toLowerCase().split('.');
  if (parts.length <= 2) return false;
  // In a multi-dot filename, ANY extension segment after the base name (including
  // the final one) that is a dangerous executable type makes the file unsafe —
  // catches both `report.pdf.exe` (dangerous last) and `invoice.exe.pdf` (dangerous middle).
  return parts.slice(1).some((p) => DANGEROUS_EXT.has(p));
}

export interface UploadCandidate {
  originalname: string;
  mimetype: string;
  size: number;
}

/** Validate an upload by extension + MIME + double-extension + size. */
export function validateUpload(file: UploadCandidate, maxSizeBytes: number): { ext: string } {
  const ext = getExtension(file.originalname);
  if (!ext || !(ALLOWED_MATERIAL_EXTENSIONS as readonly string[]).includes(ext)) {
    throw AppError.badRequest(`File type ".${ext}" is not permitted.`);
  }
  if (hasDangerousDoubleExtension(file.originalname)) {
    throw AppError.badRequest('File name contains a disallowed double extension.');
  }
  const allowedMimes = MIME_BY_EXT[ext] || [];
  if (!allowedMimes.includes(file.mimetype)) {
    throw AppError.badRequest(`File MIME type "${file.mimetype}" does not match its ".${ext}" extension.`);
  }
  if (file.size > maxSizeBytes) {
    throw AppError.badRequest(`File exceeds the maximum size of ${Math.round(maxSizeBytes / (1024 * 1024))} MB.`);
  }
  return { ext };
}

/** UUID-based on-disk filename (the original name is preserved in the DB). */
export function generateStoredName(originalname: string): string {
  const ext = getExtension(originalname);
  return `${randomUUID()}${ext ? '.' + ext : ''}`;
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Antivirus integration point (Module 15 §10).
 *
 * STUB: logs a warning and returns true (clean) by default. To enable real
 * scanning, wire in ClamAV (e.g. the `clamscan` npm package against a clamd
 * socket) or a cloud AV API here and return false for infected files. See the
 * "Antivirus" section of README.md.
 */
export async function scanFileForVirus(filePath: string): Promise<boolean> {
  logger.warn(`scanFileForVirus is a STUB — file "${filePath}" was NOT scanned. Wire in ClamAV for production.`);
  return true;
}
