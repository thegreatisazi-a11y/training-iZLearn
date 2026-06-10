import { prisma } from '../config/prisma';
import { isLocked, clearLock, setLocked } from '../config/redis';
import { signAccessToken, verifyRefreshToken } from '../utils/jwtUtils';
import { hashPassword, comparePassword, validatePasswordPolicy, assertNotReused } from '../utils/passwordUtils';
import { AppError } from '../utils/response';
import { buildAuthUser } from '../middlewares/auth.middleware';
import type { AuthUser } from '../types';
import { recordEvent } from './auditTrail.service';
import { getPasswordPolicy, getAuthPolicy } from './systemConfig.service';
import { notifySessionTerminated } from './notification.service';
import * as ldap from './ldap.service';
import * as session from './session.service';

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
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  mustChangePassword: boolean;
}

export async function login(
  input: LoginInput,
  ip: string | undefined,
  userAgent: string | undefined,
  terminateExisting = false,
): Promise<LoginResult> {
  const user = await prisma.user.findFirst({ where: { windowsUsername: input.windowsUsername, isDeleted: false } });

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
    await prisma.user.update({
      where: { id: user.id },
      data: reachedLimit
        ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + authPolicy.lockoutMinutes * 60 * 1000) }
        : { failedLoginAttempts: attempts },
    });
    await recordEvent({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      actor: { userId: user.id, userFullName: user.fullName },
      newValue: { attempts, locked: reachedLimit },
      ipAddress: ip,
      userAgent,
    });
    throw AppError.unauthorized('Invalid credentials');
  }

  // Successful credential check — clear failure state.
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

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

  const { sessionId, refreshToken } = await session.createSession(user.id, input.deviceInfo, ip);
  const accessToken = signAccessToken(user.id, sessionId);

  const authUser = await buildAuthUser(user.id, sessionId);
  if (!authUser) throw AppError.unauthorized('Account is inactive or no longer exists.');

  await recordEvent({
    action: 'LOGIN',
    entityType: 'User',
    entityId: user.id,
    actor: { userId: user.id, userFullName: user.fullName, sessionId },
    ipAddress: ip,
    userAgent,
  });

  return { accessToken, refreshToken, user: authUser, mustChangePassword: user.mustChangePassword };
}

/** Issue a fresh access token from a valid refresh token (session must still be live and unlocked). */
export async function refresh(refreshToken: string): Promise<{ accessToken: string }> {
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

  return { accessToken: signAccessToken(payload.sub, payload.sid) };
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

export async function unlock(userId: string, sessionId: string, password: string): Promise<{ ok: true }> {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  if (!user || !(await comparePassword(password, user.passwordHash))) {
    throw AppError.unauthorized('Invalid credentials');
  }
  await clearLock(userId, sessionId);
  return { ok: true };
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
): Promise<{ ok: true }> {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  if (!user || !(await comparePassword(loginPassword, user.passwordHash))) {
    throw AppError.unauthorized('Login password is incorrect');
  }

  const policy = await getPasswordPolicy();
  validatePasswordPolicy(signaturePassword, { minLength: policy.minLength });

  const signaturePasswordHash = await hashPassword(signaturePassword);
  await prisma.user.update({ where: { id: userId }, data: { signaturePasswordHash } });

  return { ok: true };
}
