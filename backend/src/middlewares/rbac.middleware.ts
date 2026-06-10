import { Request, Response, NextFunction } from 'express';
import type { PermissionAction } from '@izlearn/shared';
import { AppError, asyncHandler } from '../utils/response';
import { hasPermission } from '../utils/permissions';
import { recordEvent } from '../services/auditTrail.service';

/**
 * 21 CFR Part 11 §11.10(g) — authority checks. Grants access if ANY of the
 * user's active roles allows the required module + action. Denials are audited.
 */
export function requirePermission(module: string, action: PermissionAction) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw AppError.unauthorized();
    if (!hasPermission(req.user.permissions, module, action)) {
      await recordEvent({
        action: 'ACCESS_DENIED',
        entityType: 'Module',
        entityId: module,
        newValue: { requiredAction: action, roles: req.user.roleNames },
      });
      throw AppError.forbidden(`You do not have "${action}" permission on ${module}.`);
    }
    next();
  });
}

/** Require at least one of the named roles (used for SUPER_ADMIN-only operations). */
export function requireRole(...roleNames: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!req.user.roleNames.some((r) => roleNames.includes(r))) {
      return next(AppError.forbidden(`This action requires one of the roles: ${roleNames.join(', ')}.`));
    }
    next();
  };
}
