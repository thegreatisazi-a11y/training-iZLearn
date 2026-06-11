import { Response } from 'express';
import * as storage from '../services/storage.service';

/**
 * Stream a stored object (R2 or local-fs fallback) to the HTTP response. Replaces
 * res.download() / res.sendFile() which only work for local disk files.
 */
export async function streamDownload(
  res: Response,
  key: string,
  filename: string,
  contentType: string,
  opts: { inline?: boolean } = {},
): Promise<void> {
  const stream = await storage.getStream(key);
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `${opts.inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename)}"`,
  );
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found in storage.' } });
    else res.end();
  });
  stream.pipe(res);
}
