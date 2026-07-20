import { randomUUID } from 'crypto';
import { prisma } from '../config/prisma';
import { signRefreshToken } from '../utils/jwtUtils';
import {
  setSession,
  deleteSession,
  deleteAllUserSessions,
  type RedisSession,
} from '../config/redis';
import { recordEvent } from './auditTrail.service';

/**
 * Session lifecycle (Module 1). A session lives in two places that are kept in
 * sync: the durable UserSession row (audit/forensics) and a Redis entry with an
 * 8-hour TTL that the auth middleware consults on every request to enforce
 * single-session login and inactivity locking.
 */

/** Sessions last 8 hours. */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export async function createSession(
  userId: string,
  deviceInfo: string | undefined,
  ipAddress: string | undefined,
): Promise<{ sessionId: string; refreshToken: string }> {
  const sessionId = randomUUID();
  const refreshToken = signRefreshToken(userId, sessionId);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await prisma.userSession.create({
    data: {
      userId,
      sessionId,
      refreshToken,
      deviceInfo: deviceInfo ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt,
      isActive: true,
    },
  });

  // L-A2: single-session integrity under a check-then-act race. Two concurrent logins
  // could both pass the "no existing session" check; deactivating every OTHER active
  // session right after creating ours makes the newest login deterministically win, so
  // at most one session is ever active for a user (the durable Mongo flag is the source
  // of truth consulted on every request).
  await prisma.userSession.updateMany({
    where: { userId, sessionId: { not: sessionId }, isActive: true },
    data: { isActive: false },
  });

  await setSession(
    userId,
    sessionId,
    {
      sessionId,
      userId,
      deviceInfo,
      ipAddress,
      createdAt: new Date().toISOString(),
    },
    SESSION_TTL_SECONDS,
  );

  return { sessionId, refreshToken };
}

/**
 * Active sessions for a user, read from the durable Mongo `UserSession` collection
 * (the source of truth) so single-session enforcement works regardless of Redis
 * availability. Mapped to the RedisSession shape callers already expect.
 */
export async function getActiveSessions(userId: string): Promise<RedisSession[]> {
  const rows = await prisma.userSession.findMany({
    where: { userId, isActive: true, expiresAt: { gt: new Date() } },
  });
  return rows.map((s) => ({
    sessionId: s.sessionId,
    userId: s.userId,
    deviceInfo: s.deviceInfo ?? undefined,
    ipAddress: s.ipAddress ?? undefined,
    createdAt: s.createdAt.toISOString(),
  }));
}

/** Is a specific session still active? Durable Mongo check (Redis-independent). */
export async function isSessionActive(userId: string, sessionId: string): Promise<boolean> {
  const row = await prisma.userSession.findFirst({
    where: { userId, sessionId, isActive: true, expiresAt: { gt: new Date() } },
  });
  return Boolean(row);
}

/** Terminate every existing session for a user (single-session enforcement). */
export async function terminatePreviousSessions(userId: string, reason: string): Promise<void> {
  await prisma.userSession.updateMany({ where: { userId, isActive: true }, data: { isActive: false } });
  await deleteAllUserSessions(userId);
  await recordEvent({
    action: 'SESSION_TERMINATED',
    entityType: 'UserSession',
    entityId: userId,
    newValue: { reason },
  });
}

export async function invalidateSession(userId: string, sessionId: string): Promise<void> {
  await prisma.userSession.updateMany({ where: { sessionId }, data: { isActive: false } });
  await deleteSession(userId, sessionId);
}
