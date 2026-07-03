import { Request, Response, NextFunction } from 'express';
import type { PermissionMatrix } from '@izlearn/shared';
import { prisma } from '../config/prisma';
import { isLocked } from '../config/redis';
import { isSessionActive } from '../services/session.service';
import { verifyAccessToken } from '../utils/jwtUtils';
import { AppError, asyncHandler } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { mergePermissions } from '../utils/permissions';
import type { AuthUser } from '../types';

/** Load a fully-resolved auth principal (roles + merged permissions). */
export async function buildAuthUser(userId: string, sessionId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false, isActive: true } });
  if (!user) return null;

  const userRoles = await prisma.userRole.findMany({ where: { userId, isActive: true } });
  const roleIds = userRoles.map((r) => r.roleId);
  const roles = roleIds.length
    ? await prisma.role.findMany({ where: { id: { in: roleIds }, isActive: true, isDeleted: false } })
    : [];

  const permissions = mergePermissions(roles.map((r) => r.permissions as PermissionMatrix));

  return {
    id: user.id,
    windowsUsername: user.windowsUsername,
    fullName: user.fullName,
    employeeId: user.employeeId,
    email: user.email,
    locationId: user.locationId,
    departmentId: user.departmentId,
    sessionId,
    roleIds,
    roleNames: roles.map((r) => r.roleName),
    permissions,
  };
}

function makeAuthenticate(allowLocked: boolean) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw AppError.unauthorized();
    const token = header.slice(7);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw AppError.unauthorized('Invalid or expired access token');
    }

    // Session must still be active (single-session enforcement / termination).
    // Validated against the durable Mongo UserSession (Redis-independent).
    if (!(await isSessionActive(payload.sub, payload.sid))) {
      throw AppError.unauthorized('Your session has ended. Please log in again.');
    }

    if (!allowLocked && (await isLocked(payload.sub, payload.sid))) {
      throw new AppError(423, 'LOCKED', 'Session is locked due to inactivity. Re-enter your password to continue.');
    }

    const authUser = await buildAuthUser(payload.sub, payload.sid);
    if (!authUser) throw AppError.unauthorized('Account is inactive or no longer exists.');

    req.user = authUser;
    auditContext.setActor({ userId: authUser.id, userFullName: authUser.fullName, sessionId: authUser.sessionId });
    auditContext.setRequestMeta({ sessionId: authUser.sessionId });
    next();
  });
}

/** Standard guard — rejects locked sessions. */
export const authenticate = makeAuthenticate(false);

/** Variant used by the unlock endpoint — permits a locked session to re-auth. */
export const authenticateAllowLocked = makeAuthenticate(true);
