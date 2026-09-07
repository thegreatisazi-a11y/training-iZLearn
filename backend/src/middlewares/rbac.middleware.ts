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

/**
 * Like requirePermission, but checks the EXACT granular flag with NO legacy fallback.
 * Use for actions that must be independently toggleable in Roles & Access Control — e.g.
 * "Create / New User Request" (userManagement:create) must not be implicitly granted by
 * the derived `write` flag (which any of edit/assign/etc. would set), otherwise turning
 * the toggle off would have no effect.
 */
export function requireExactPermission(module: string, action: string) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw AppError.unauthorized();
    const perms = req.user.permissions as unknown as Record<string, Record<string, boolean>> | undefined;
    if (perms?.[module]?.[action] !== true) {
      await recordEvent({
        action: 'ACCESS_DENIED',
        entityType: 'Module',
        entityId: module,
        newValue: { requiredAction: action, exact: true, roles: req.user.roleNames },
      });
      throw AppError.forbidden(`You do not have "${action}" permission on ${module}.`);
    }
    next();
  });
}

/**
 * DELIBERATELY REMOVED — `requireRole(...names)`.
 *
 * It matched role NAMES with an exact string compare, so every guard using it broke
 * silently the moment a role was renamed in Roles & Access Control ('SUPER_ADMIN' ->
 * 'Super Admin'), and it could never work for a role an organisation created from
 * scratch under its own name. Manual backup/restore was unreachable for exactly this
 * reason.
 *
 * Authorization is permission-driven: gate routes on `requirePermission` /
 * `requireExactPermission` against a module in PERMISSION_CATALOG. Where a guard must
 * identify the built-in administrator (privilege escalation), key on the `Role.isSystem`
 * flag via `holdsSystemRole()` — never on a name.
 */
