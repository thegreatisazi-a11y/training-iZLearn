import { prisma } from '../config/prisma';
import { isLocked, clearLock, setLocked } from '../config/redis';
import { signAccessToken, verifyRefreshToken } from '../utils/jwtUtils';
import { hashPassword, comparePassword, validatePasswordPolicy, assertNotReused } from '../utils/passwordUtils';
import { AppError } from '../utils/response';
import { buildAuthUser } from '../middlewares/auth.middleware';
import { auditContext } from '../utils/auditContext';
import type { AuthUser } from '../types';
import { recordEvent } from './auditTrail.service';
import { getPasswordPolicy, getAuthPolicy } from './systemConfig.service';
import { notifySessionTerminated } from './notification.service';
import * as ldap from './ldap.service';
import * as session from './session.service';
import { randomUUID } from 'crypto';
import { assignedActiveRoles } from './activeRole.service';

/**
 * Module 1 — authentication, session and credential management.
 *
 * Password verification is delegated to Active Directory when LDAP is enabled,
 * otherwise to the locally-stored bcrypt hash. Lockout, single-session
 * enforcement, password history and the inactivity lock are all handled here;
 * every security-relevant outcome is recorded in the audit trail.
 */

export interface LoginInput {
  windowsUsername: string;
  password: string;
  deviceInfo?: string;
  activeRoleId?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  mustChangePassword: boolean;
}

export interface RoleSelectionResult {
  requiresRoleSelection: true;
  roles: Array<{ id: string; name: string }>;
}

export async function login(
  input: LoginInput,
  ip: string | undefined,
  userAgent: string | undefined,
  terminateExisting = false,
): Promise<LoginResult | RoleSelectionResult> {
  // Username is matched case-insensitively so a user can sign in as "JDoe", "jdoe", etc.
  const user = await prisma.user.findFirst({
    where: { windowsUsername: { equals: input.windowsUsername, mode: 'insensitive' }, isDeleted: false },
  });

  if (!user) {
    await recordEvent({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      newValue: { windowsUsername: input.windowsUsername, reason: 'User not found' },
      ipAddress: ip,
      userAgent,
    });
    throw AppError.unauthorized('Invalid credentials');
  }

  // The account is now identified. Attribute every audited write that follows in
  // this (still-unauthenticated) request — failed-attempt counter, lastLoginAt,
  // session termination — to this user instead of the default ANONYMOUS actor.
  auditContext.setActor({ userId: user.id, userFullName: user.fullName, userUsername: user.windowsUsername });

  if (!user.isActive) throw AppError.forbidden('Account is inactive');

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'LOCKED', 'Account locked. Try again later.');
  }

  const authPolicy = await getAuthPolicy();
  const passwordValid = (await ldap.isEnabled())
    ? await ldap.authenticate(input.windowsUsername, input.password)
    : await comparePassword(input.password, user.passwordHash);

  if (!passwordValid) {
    const attempts = user.failedLoginAttempts + 1;
    const reachedLimit = attempts >= authPolicy.maxFailedAttempts;
    // Housekeeping counter — the LOGIN_FAILED event below is the audit record; don't
    // emit a redundant "UPDATE User" row for it (item 1).
    await auditContext.runWithoutAudit(() =>
      prisma.user.update({
        where: { id: user.id },
        data: reachedLimit
          ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + authPolicy.lockoutMinutes * 60 * 1000) }
          : { failedLoginAttempts: attempts },
      }),
    );
    await recordEvent({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      actor: { userId: user.id, userFullName: user.fullName, userUsername: user.windowsUsername },
      newValue: { attempts, locked: reachedLimit },
      ipAddress: ip,
      userAgent,
    });
    throw AppError.unauthorized('Invalid credentials');
  }

  // Reveal role choices only after credentials pass; create no session until selected.
  const roles = await assignedActiveRoles(user.id);
  if (!roles.length) throw AppError.forbidden('Your account has no active role assigned. Contact your administrator.');
  if (!input.activeRoleId && roles.length > 1) {
    return { requiresRoleSelection: true, roles: roles.map((role) => ({ id: role.id, name: role.roleName })) };
  }
  const selectedRole = input.activeRoleId ? roles.find((role) => role.id === input.activeRoleId) : roles[0];
  if (!selectedRole) throw AppError.forbidden('The selected role is not currently assigned to your account.');

  // Successful credential check — clear failure state and stamp lastLoginAt. This is
  // operational housekeeping already captured by the LOGIN event below, so suppress
  // the redundant "UPDATE User" audit row (item 1: avoids duplicate/confusing entries).
  await auditContext.runWithoutAudit(() =>
    prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    }),
  );

  // Single-session enforcement.
  const existing = await session.getActiveSessions(user.id);
  if (existing.length && !terminateExisting) {
    throw new AppError(
      409,
      'SESSION_EXISTS',
      `An active session exists on device "${existing[0].deviceInfo || 'unknown'}". Terminate it and continue?`,
      { deviceInfo: existing[0].deviceInfo },
    );
  }
  if (terminateExisting && existing.length) {
    await session.terminatePreviousSessions(user.id, 'New login');
    await notifySessionTerminated(user.id, existing[0].deviceInfo || 'unknown');
  }

  const { sessionId, refreshToken } = await session.createSession(user.id, input.deviceInfo, ip, selectedRole.id);

  const authUser = await buildAuthUser(user.id, sessionId);
  if (!authUser) {
    await session.invalidateSession(user.id, sessionId);
    throw AppError.unauthorized('Account or selected role is no longer available.');
  }

  // CR-1: a user whose roles have all been made inactive (or who has no role
  // assigned) cannot use the system. buildAuthUser only returns active, non-deleted
  // roles, so an empty roleIds set means there is no usable role — deny login and
  // tear down the session we just created.
  if (!authUser.roleIds.length) {
    await session.invalidateSession(user.id, sessionId);
    await recordEvent({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      actor: { userId: user.id, userFullName: user.fullName, userUsername: user.windowsUsername },
      newValue: { reason: 'No active role assigned' },
      ipAddress: ip,
      userAgent,
    });
    throw AppError.forbidden('Your account has no active role assigned. Contact your administrator.');
  }

  const accessToken = signAccessToken(user.id, sessionId, authUser);
  auditContext.setActor({ userId: user.id, userFullName: user.fullName, userUsername: user.windowsUsername, sessionId, activeRoleId: authUser.activeRoleId, activeRoleName: authUser.activeRoleName });
  await recordEvent({
    action: 'LOGIN',
    entityType: 'User',
    entityId: user.id,
    actor: { userId: user.id, userFullName: user.fullName, userUsername: user.windowsUsername, sessionId, activeRoleId: authUser.activeRoleId, activeRoleName: authUser.activeRoleName },
    ipAddress: ip,
    userAgent,
  });

  return { accessToken, refreshToken, user: authUser, mustChangePassword: user.mustChangePassword };
}

/** Issue a fresh access token from a valid refresh token (session must still be live and unlocked). */
export async function refresh(refreshToken: string): Promise<{ accessToken: string; roleContext: string }> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }

  const sessions = await session.getActiveSessions(payload.sub);
  if (!sessions.some((s) => s.sessionId === payload.sid)) {
    throw AppError.unauthorized('Your session has ended. Please log in again.');
  }
  if (await isLocked(payload.sub, payload.sid)) {
    throw new AppError(423, 'LOCKED', 'Session is locked due to inactivity. Re-enter your password to continue.');
  }

  const user = await buildAuthUser(payload.sub, payload.sid);
  if (!user) throw AppError.unauthorized('Your active role is no longer available. Please sign in again.');
  return { accessToken: signAccessToken(payload.sub, payload.sid, user), roleContext: user.roleContext };
}

/** Switch within the same unlocked session; permissions never come from the client. */
export async function switchRole(current: AuthUser, activeRoleId: string) {
  const roles = await assignedActiveRoles(current.id);
  const next = roles.find((role) => role.id === activeRoleId);
  if (!next) throw AppError.forbidden('The selected role is not currently assigned to your account.');
  if (await isLocked(current.id, current.sessionId)) throw new AppError(423, 'LOCKED', 'Unlock your session before switching roles.');
  let expectedContext = current.roleContext;
  if (current.activeRoleId !== next.id) {
    const roleContext = randomUUID();
    expectedContext = roleContext;
    await auditContext.runWithoutAudit(() => prisma.$transaction(async (tx) => {
      const updated = await tx.userSession.updateMany({
        where: { userId: current.id, sessionId: current.sessionId, isActive: true, expiresAt: { gt: new Date() }, roleContext: current.roleContext },
        data: { activeRoleId: next.id, roleContext },
      });
      if (updated.count !== 1) throw new AppError(409, 'ROLE_CHANGED', 'The session changed. Reload your current role.');
      await tx.auditTrail.create({ data: {
        userId: current.id, userFullName: current.fullName, userUsername: current.windowsUsername,
        activeRoleId: current.activeRoleId, activeRoleName: current.activeRoleName,
        action: 'ROLE_SWITCH', entityType: 'UserSession', entityId: current.sessionId, sessionId: current.sessionId,
        oldValue: { activeRoleName: current.activeRoleName }, newValue: { activeRoleName: next.roleName },
        reasonForChange: 'User switched active role',
        ipAddress: auditContext.getStore()?.ipAddress ?? null, userAgent: auditContext.getStore()?.userAgent ?? null,
      } });
    }));
  }
  const user = await buildAuthUser(current.id, current.sessionId);
  if (!user) throw AppError.unauthorized('Your active role is no longer available. Please sign in again.');
  if (user.roleContext !== expectedContext) throw new AppError(409, 'ROLE_CHANGED', 'The session changed. Reload your current role.');
  return { user, accessToken: signAccessToken(user.id, user.sessionId, user) };
}

export async function logout(userId: string, sessionId: string): Promise<void> {
  await session.invalidateSession(userId, sessionId);
  await recordEvent({ action: 'LOGOUT', entityType: 'UserSession', entityId: sessionId });
}

/** Lock the current session due to inactivity (released by re-authenticating). */
export async function lockSession(userId: string, sessionId: string): Promise<void> {
  await setLocked(userId, sessionId, 3600);
  await recordEvent({ action: 'SESSION_LOCKED', entityType: 'UserSession', entityId: sessionId });
}

export async function unlock(
  refreshToken: string,
  windowsUsername: string,
  password: string,
  ip?: string,
  userAgent?: string,
): Promise<{ accessToken: string }> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }

  if (!(await session.isSessionActive(payload.sub, payload.sid))) {
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }

  const user = await prisma.user.findFirst({ where: { id: payload.sub, isDeleted: false, isActive: true } });
  if (!user) {
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }

  auditContext.setActor({ userId: user.id, userFullName: user.fullName, userUsername: user.windowsUsername, sessionId: payload.sid });
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'LOCKED', 'Account locked. Try again later.');
  }

  const passwordValid = user.windowsUsername.toLowerCase() === windowsUsername.trim().toLowerCase()
    && ((await ldap.isEnabled())
      ? await ldap.authenticate(user.windowsUsername, password)
      : await comparePassword(password, user.passwordHash));

  if (!passwordValid) {
    const authPolicy = await getAuthPolicy();
    const attempts = user.failedLoginAttempts + 1;
    const reachedLimit = attempts >= authPolicy.maxFailedAttempts;
    await auditContext.runWithoutAudit(() =>
      prisma.user.update({
        where: { id: user.id },
        data: reachedLimit
          ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + authPolicy.lockoutMinutes * 60 * 1000) }
          : { failedLoginAttempts: attempts },
      }),
    );
    await recordEvent({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      newValue: { attempts, locked: reachedLimit, reason: 'Session unlock' },
      ipAddress: ip,
      userAgent,
    });
    throw AppError.unauthorized('Invalid credentials');
  }

  await auditContext.runWithoutAudit(() =>
    prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } }),
  );
  const principal = await buildAuthUser(user.id, payload.sid);
  if (!principal) throw new AppError(401, 'SESSION_EXPIRED', 'Your active role is no longer available. Please sign in again.');
  auditContext.setActor({ userId: user.id, userFullName: user.fullName, userUsername: user.windowsUsername, sessionId: payload.sid, activeRoleId: principal.activeRoleId, activeRoleName: principal.activeRoleName });
  await clearLock(user.id, payload.sid);
  await recordEvent({ action: 'SESSION_UNLOCKED', entityType: 'UserSession', entityId: payload.sid, ipAddress: ip, userAgent });
  return { accessToken: signAccessToken(user.id, payload.sid, principal) };
}

export async function changePassword(userId: string, current: string, next: string): Promise<{ ok: true }> {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  if (!user || !(await comparePassword(current, user.passwordHash))) {
    throw AppError.unauthorized('Current password is incorrect');
  }

  const policy = await getPasswordPolicy();
  validatePasswordPolicy(next, { minLength: policy.minLength });

  const history = await prisma.passwordHistory.findMany({ where: { userId }, orderBy: { changedAt: 'desc' } });
  await assertNotReused(next, history.map((h) => h.passwordHash), policy.historyCount);

  const passwordHash = await hashPassword(next);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
  });
  await prisma.passwordHistory.create({ data: { userId, passwordHash } });

  return { ok: true };
}

export async function setSignaturePassword(
  userId: string,
  loginPassword: string,
  signaturePassword: string,
  oldSignaturePassword?: string,
): Promise<{ ok: true }> {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  if (!user || !(await comparePassword(loginPassword, user.passwordHash))) {
    throw AppError.unauthorized('Login password is incorrect');
  }

  // When a signature password already exists, the user must prove knowledge of it
  // before it can be replaced (prevents an unattended-session takeover of the
  // second e-signature component).
  if (user.signaturePasswordHash) {
    if (!oldSignaturePassword) {
      throw AppError.badRequest('Your current signature password is required to change it.');
    }
    if (!(await comparePassword(oldSignaturePassword, user.signaturePasswordHash))) {
      throw AppError.badRequest('Your current signature password is incorrect.');
    }
  }

  // 21 CFR Part 11 §11.200 — the two components of the electronic signature must be
  // distinct. The signature password may not equal the login password.
  if (await comparePassword(signaturePassword, user.passwordHash)) {
    throw AppError.badRequest('Your signature password must be different from your login password.');
  }

  const policy = await getPasswordPolicy();
  validatePasswordPolicy(signaturePassword, { minLength: policy.minLength });

  const signaturePasswordHash = await hashPassword(signaturePassword);
  await prisma.user.update({ where: { id: userId }, data: { signaturePasswordHash } });

  return { ok: true };
}
