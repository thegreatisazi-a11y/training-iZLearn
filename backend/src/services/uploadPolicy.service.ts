import { parseUploadLimitBytes } from '@izlearn/shared';
import { getConfig } from './systemConfig.service';
import { AppError } from '../utils/response';

export async function getUploadLimitBytes(): Promise<number> {
  try { return parseUploadLimitBytes(await getConfig('upload.max_size_mb')); }
  catch { throw AppError.badRequest('The upload size setting is invalid. Set a non-negative MB value in System Configuration; 0 means no limit.'); }
}

export function uploadLimitMessage(bytes: number) {
  return `File exceeds the maximum size of ${bytes / (1024 * 1024)} MB configured in System Configuration.`;
}
