import { randomUUID } from 'crypto';
import { prisma } from '../config/prisma';
import { signRefreshToken } from '../utils/jwtUtils';
import {
  setSession,
  getUserSessions,
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

export async function getActiveSessions(userId: string): Promise<RedisSession[]> {
  return getUserSessions(userId);
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
