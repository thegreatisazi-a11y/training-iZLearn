import rateLimit from 'express-rate-limit';
import { recordEvent } from '../services/auditTrail.service';
import { logger } from '../config/logger';

/**
 * Module 15 §2 — limit /auth/* to 10 requests/minute/IP. Rate-limit hits are
 * recorded in the audit trail.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    recordEvent({
      action: 'RATE_LIMITED',
      entityType: 'Auth',
      newValue: { path: req.path, ip: req.ip },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || undefined,
    }).catch((e) => logger.error('Failed to record RATE_LIMITED event', { e: (e as Error).message }));
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
    });
  },
});

/** A gentler global limiter for the rest of the API. */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
