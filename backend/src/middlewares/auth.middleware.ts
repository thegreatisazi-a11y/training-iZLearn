import { Request, Response, NextFunction } from 'express';
import type { PermissionMatrix } from '@izlearn/shared';
import { prisma } from '../config/prisma';
import { isLocked } from '../config/redis';
import { isSessionActive } from '../services/session.service';
import { verifyAccessToken } from '../utils/jwtUtils';
import { AppError, asyncHandler } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { assignedActiveRoles } from '../services/activeRole.service';
import type { AuthUser } from '../types';

/** Load a fully-resolved auth principal (roles + merged permissions). */
export async function buildAuthUser(userId: string, sessionId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false, isActive: true } });
  if (!user) return null;

  const [roles, session] = await Promise.all([
    assignedActiveRoles(userId),
    prisma.userSession.findFirst({ where: { userId, sessionId, isActive: true, expiresAt: { gt: new Date() } } }),
  ]);
  if (!session?.activeRoleId || !session.roleContext) return null;
  const role = roles.find((item) => item.id === session.activeRoleId);
  if (!role) return null;

  return {
    id: user.id,
    windowsUsername: user.windowsUsername,
    fullName: user.fullName,
    employeeId: user.employeeId,
    email: user.email,
    locationId: user.locationId,
    departmentId: user.departmentId,
    sessionId,
    roleIds: [role.id],
    roleNames: [role.roleName],
    activeRoleId: role.id,
    activeRoleName: role.roleName,
    activeRoleIsSystem: role.isSystem,
    roleContext: session.roleContext,
    availableRoles: roles.map((item) => ({ id: item.id, name: item.roleName })),
    permissions: role.permissions as PermissionMatrix,
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
    if (!authUser) throw AppError.unauthorized('Your active role or session is no longer available. Please sign in again.');
    if (!payload.rid || !payload.rc) throw AppError.unauthorized('Please sign in again to select an active role.');
    const requestedContext = req.get('X-Role-Context');
    if (payload.rid !== authUser.activeRoleId || payload.rc !== authUser.roleContext ||
      (requestedContext && requestedContext !== authUser.roleContext)) {
      throw new AppError(409, 'ROLE_CHANGED', 'Your active role changed. Reloading your current role.');
    }

    req.user = authUser;
    auditContext.setActor({ userId: authUser.id, userFullName: authUser.fullName, userUsername: authUser.windowsUsername, sessionId: authUser.sessionId, activeRoleId: authUser.activeRoleId, activeRoleName: authUser.activeRoleName });
    auditContext.setRequestMeta({ sessionId: authUser.sessionId });
    next();
  });
}

/** Standard guard — rejects locked sessions. */
export const authenticate = makeAuthenticate(false);

/** Variant used by the unlock endpoint — permits a locked session to re-auth. */
export const authenticateAllowLocked = makeAuthenticate(true);
