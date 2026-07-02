import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { logger } from '../config/logger';
import { AppError } from '../utils/response';
import * as storage from './storage.service';

const execFileAsync = promisify(execFile);

/**
 * Office → PDF conversion for the locked in-app viewer.
 *
 * Browsers cannot render Office documents natively, and the controlled viewer must not
 * expose the file to an external service (that would break the no-download control). So
 * doc/docx/ppt/pptx/xls/xlsx are rendered server-side to PDF via headless LibreOffice and
 * then shown in the SAME locked pdf.js surface as native PDFs. The converted PDF is cached
 * in object storage (derived/<materialId>.pdf) so each file is converted only once; a
 * material row is immutable (a replacement is a new row), so the id is a stable cache key.
 *
 * Requires LibreOffice on the host (added to the backend Docker image). Override the binary
 * with LIBREOFFICE_BIN if it is not `soffice` on the PATH.
 */

/** Office extensions that must be converted to PDF before they can be viewed. */
export const CONVERTIBLE_OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);

export function isConvertibleOffice(ext: string): boolean {
  return CONVERTIBLE_OFFICE_EXTENSIONS.has(ext.toLowerCase());
}

const CONVERT_TIMEOUT_MS = parseInt(process.env.LIBREOFFICE_TIMEOUT_MS || '120000', 10);

/**
 * Resolve the LibreOffice binary once. Order: explicit LIBREOFFICE_BIN env → known
 * per-OS install paths (verified on disk) → a bare command on the PATH (Linux/mac
 * images that expose `soffice`). Returns null when nothing is found, so the caller can
 * surface a clear "preview unavailable" message instead of a raw spawn error.
 */
let _resolvedBin: string | null | undefined;
function resolveSofficeBin(): string | null {
  if (_resolvedBin !== undefined) return _resolvedBin;
  const envBin = process.env.LIBREOFFICE_BIN;
  const candidates: string[] = envBin
    ? [envBin]
    : process.platform === 'win32'
      ? ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
      : process.platform === 'darwin'
        ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/opt/homebrew/bin/soffice', '/usr/local/bin/soffice']
        : ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/lib/libreoffice/program/soffice'];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        _resolvedBin = c;
        return c;
      }
    } catch {
      /* ignore and keep looking */
    }
  }
  // No verifiable path found. On Linux/mac fall back to a PATH lookup ('soffice'); on
  // Windows there is no reliable PATH entry, so report "not found".
  _resolvedBin = envBin ?? (process.platform === 'win32' ? null : 'soffice');
  return _resolvedBin;
}

/** In-flight conversions keyed by derived key, so concurrent viewers share one job. */
const inFlight = new Map<string, Promise<void>>();

/** Cached-PDF storage key for a converted material (stable per immutable material row). */
function derivedPdfKey(materialId: string): string {
  return `derived/${materialId}.pdf`;
}

/**
 * Convert one on-disk Office file to PDF with headless LibreOffice and return the path to
 * the produced PDF. A per-invocation UserInstallation profile sidesteps LibreOffice's
 * single-instance lock, so concurrent conversions don't collide.
 */
async function sofficeConvert(inputPath: string, outDir: string): Promise<string> {
  const bin = resolveSofficeBin();
  if (!bin) {
    logger.error('LibreOffice not found. Install it (or set LIBREOFFICE_BIN) on the server that runs the API.');
    throw new AppError(503, 'PREVIEW_UNAVAILABLE', 'Document preview is unavailable: LibreOffice is not installed on the server.');
  }
  const profile = path.join(os.tmpdir(), `lo-profile-${randomUUID()}`);
  const args = [
    '--headless',
    '--nologo',
    '--nofirststartwizard',
    '--norestore',
    `-env:UserInstallation=file://${profile.replace(/\\/g, '/')}`,
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    inputPath,
  ];
  try {
    await execFileAsync(bin, args, { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      logger.error(`LibreOffice binary "${bin}" not found (spawn ENOENT). Install LibreOffice or set LIBREOFFICE_BIN.`);
      throw new AppError(503, 'PREVIEW_UNAVAILABLE', 'Document preview is unavailable: the conversion service (LibreOffice) is not available on this server.');
    }
    logger.error(`LibreOffice conversion failed: ${err.message}`);
    throw new AppError(422, 'CONVERSION_FAILED', 'This document could not be converted for viewing.');
  } finally {
    fs.rm(profile, { recursive: true, force: true }, () => undefined);
  }
  // LibreOffice names the output <inputBaseName>.pdf in outDir.
  const produced = path.join(outDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
  if (!fs.existsSync(produced)) throw new AppError(422, 'CONVERSION_FAILED', 'This document could not be converted for viewing.');
  return produced;
}

/**
 * Ensure a PDF rendering of an Office material exists in storage and return its key.
 * The conversion runs once and is cached; subsequent views stream the cached PDF, and
 * concurrent requests for the same file await the single in-flight job.
 */
export async function ensureConvertedPdfKey(material: {
  id: string;
  filePath: string;
  fileType: string;
}): Promise<string> {
  const key = derivedPdfKey(material.id);
  if (await storage.objectExists(key)) return key;

  const existing = inFlight.get(key);
  if (existing) {
    await existing;
    return key;
  }

  const job = (async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-convert-'));
    const inputPath = path.join(workDir, `input.${material.fileType.toLowerCase()}`);
    try {
      const bytes = await storage.getBuffer(material.filePath);
      fs.writeFileSync(inputPath, bytes);
      const pdfPath = await sofficeConvert(inputPath, workDir);
      const pdfBytes = fs.readFileSync(pdfPath);
      await storage.putBuffer(key, pdfBytes, 'application/pdf');
      logger.info(`Converted material ${material.id} (${material.fileType}) to PDF for viewing (${(pdfBytes.length / 1024).toFixed(0)} KB).`);
    } finally {
      fs.rm(workDir, { recursive: true, force: true }, () => undefined);
    }
  })();
  inFlight.set(key, job);
  try {
    await job;
  } finally {
    inFlight.delete(key);
  }
  return key;
}
