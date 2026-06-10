import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';

/**
 * 21 CFR Part 11 — a mandatory reason for change is required for UPDATE/DELETE
 * of GMP records. Validates BEFORE the DB operation and pushes the reason into
 * the audit context so the audit middleware records it.
 */
export function requireReasonForChange(req: Request, _res: Response, next: NextFunction) {
  const reason = (req.body?.reasonForChange ?? '').toString().trim();
  if (reason.length < 5) {
    return next(AppError.badRequest('A reason for change of at least 5 characters is required (21 CFR Part 11).'));
  }
  req.auditReason = reason;
  auditContext.setReason(reason);
  next();
}

/** Capture a reason if the client supplied one (for optional-reason endpoints). */
export function captureReasonIfPresent(req: Request, _res: Response, next: NextFunction) {
  const reason = (req.body?.reasonForChange ?? '').toString().trim();
  if (reason) {
    req.auditReason = reason;
    auditContext.setReason(reason);
  }
  next();
}
