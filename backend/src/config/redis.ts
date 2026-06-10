import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

/**
 * Redis is used both as the session store (single-session enforcement and
 * inactivity-lock state) and as the Bull queue backend. Bull requires
 * `maxRetriesPerRequest: null`.
 */
export const redis = new Redis(env.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('connect', () => logger.info('Redis connected.'));
redis.on('error', (err) => logger.error('Redis error', { err: err.message }));

// ---- Session helpers --------------------------------------------------------

const SESSION_PREFIX = 'session';
const LOCK_PREFIX = 'lock';

export interface RedisSession {
  sessionId: string;
  userId: string;
  deviceInfo?: string;
  ipAddress?: string;
  createdAt: string;
}

export async function setSession(userId: string, sessionId: string, data: RedisSession, ttlSeconds: number) {
  const key = `${SESSION_PREFIX}:${userId}:${sessionId}`;
  await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
}

export async function getUserSessions(userId: string): Promise<RedisSession[]> {
  const keys = await redis.keys(`${SESSION_PREFIX}:${userId}:*`);
  if (!keys.length) return [];
  const values = await redis.mget(keys);
  return values.filter(Boolean).map((v) => JSON.parse(v as string) as RedisSession);
}

export async function deleteSession(userId: string, sessionId: string) {
  await redis.del(`${SESSION_PREFIX}:${userId}:${sessionId}`);
}

export async function deleteAllUserSessions(userId: string) {
  const keys = await redis.keys(`${SESSION_PREFIX}:${userId}:*`);
  if (keys.length) await redis.del(...keys);
}

// ---- Inactivity lock state --------------------------------------------------

export async function setLocked(userId: string, sessionId: string, ttlSeconds: number) {
  await redis.set(`${LOCK_PREFIX}:${userId}:${sessionId}`, '1', 'EX', ttlSeconds);
}

export async function isLocked(userId: string, sessionId: string): Promise<boolean> {
  return (await redis.exists(`${LOCK_PREFIX}:${userId}:${sessionId}`)) === 1;
}

export async function clearLock(userId: string, sessionId: string) {
  await redis.del(`${LOCK_PREFIX}:${userId}:${sessionId}`);
}
