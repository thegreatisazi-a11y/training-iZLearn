import { Request, Response, NextFunction } from 'express';
import { getList } from '../services/systemConfig.service';
import { recordEvent } from '../services/auditTrail.service';
import { logger } from '../config/logger';

/**
 * Network / domain access restriction (UR-80): restrict access to the application
 * to clients on the organisation's network. Allowed source IPs are configured in
 * SystemConfig under `security.allowed_ip_ranges` as a comma-separated list of
 * IP prefixes or exact addresses (e.g. "10.0.,192.168.1.,203.0.113.7").
 *
 * Behaviour:
 *  - When the list is EMPTY the check is disabled (default — never blocks).
 *  - Loopback addresses are always permitted so local/admin access is never lost.
 *  - A blocked request is recorded in the audit trail as ACCESS_DENIED and gets 403.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function normalize(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export async function networkRestriction(req: Request, res: Response, next: NextFunction): Promise<void> {
  let ranges: string[] = [];
  try {
    ranges = (await getList('security.allowed_ip_ranges')).map((r) => r.trim()).filter(Boolean);
  } catch {
    return next(); // config unavailable — fail open so the system stays accessible
  }
  if (ranges.length === 0) return next();

  const ip = normalize(req.ip);
  if (LOOPBACK.has(req.ip ?? '') || LOOPBACK.has(ip)) return next();

  const allowed = ranges.some((r) => ip === r || ip.startsWith(r));
  if (allowed) return next();

  logger.warn(`Network restriction blocked request from ${ip} (${req.method} ${req.originalUrl})`);
  await recordEvent({
    action: 'ACCESS_DENIED',
    entityType: 'Network',
    entityId: ip,
    newValue: { reason: 'outside_allowed_network', path: req.originalUrl, method: req.method },
  }).catch(() => undefined);

  res.status(403).json({
    success: false,
    error: { code: 'NETWORK_NOT_ALLOWED', message: 'Access is restricted to the organisation network.' },
  });
}
