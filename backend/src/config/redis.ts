import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

/**
 * Redis is used as an OPTIONAL accelerator for the session store (single-session
 * enforcement and inactivity-lock state) and as the Bull queue backend. The durable
 * source of truth for sessions is the Mongo `UserSession` collection — see
 * services/session.service.ts and middlewares/auth.middleware.ts. Authentication
 * therefore works fully even when Redis is unavailable (e.g. local dev without a
 * Redis container); the helpers below degrade gracefully instead of blocking.
 *
 * `maxRetriesPerRequest: null` is required by Bull. `enableOfflineQueue: false`
 * makes commands fail fast when Redis is down rather than queueing forever (which
 * would otherwise hang every request that touches Redis).
 */
export const redis = new Redis(env.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  lazyConnect: false,
});

redis.on('connect', () => logger.info('Redis connected.'));

// Throttle the error log so a missing local Redis doesn't flood the console.
let lastRedisErrorLog = 0;
redis.on('error', (err) => {
  const now = Date.now();
  if (now - lastRedisErrorLog > 30_000) {
    lastRedisErrorLog = now;
    logger.warn(`Redis unavailable (${err.message}). Running without the Redis accelerator; sessions use MongoDB.`);
  }
});

/** True only when a command can actually be issued. */
function ready(): boolean {
  return redis.status === 'ready';
}

/**
 * Whether Redis is currently usable. Exported so Redis-backed accelerators that do
 * NOT use the helpers in this file (e.g. Bull queues, which hold their own
 * connections) can skip work that would otherwise block while Redis is down.
 */
export function redisReady(): boolean {
  return ready();
}

// ---- Session helpers --------------------------------------------------------
// All best-effort: Redis is an accelerator, never the source of truth. Writes are
// silently skipped and reads return empty when Redis is down, so callers fall back
// to MongoDB.

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
  if (!ready()) return;
  try {
    await redis.set(`${SESSION_PREFIX}:${userId}:${sessionId}`, JSON.stringify(data), 'EX', ttlSeconds);
  } catch {
    /* best-effort */
  }
}

export async function getUserSessions(userId: string): Promise<RedisSession[]> {
  if (!ready()) return [];
  try {
    const keys = await redis.keys(`${SESSION_PREFIX}:${userId}:*`);
    if (!keys.length) return [];
    const values = await redis.mget(keys);
    return values.filter(Boolean).map((v) => JSON.parse(v as string) as RedisSession);
  } catch {
    return [];
  }
}

export async function deleteSession(userId: string, sessionId: string) {
  if (!ready()) return;
  try {
    await redis.del(`${SESSION_PREFIX}:${userId}:${sessionId}`);
  } catch {
    /* best-effort */
  }
}

export async function deleteAllUserSessions(userId: string) {
  if (!ready()) return;
  try {
    const keys = await redis.keys(`${SESSION_PREFIX}:${userId}:*`);
    if (keys.length) await redis.del(...keys);
  } catch {
    /* best-effort */
  }
}

// ---- Inactivity lock state --------------------------------------------------

export async function setLocked(userId: string, sessionId: string, ttlSeconds: number) {
  if (!ready()) return;
  try {
    await redis.set(`${LOCK_PREFIX}:${userId}:${sessionId}`, '1', 'EX', ttlSeconds);
  } catch {
    /* best-effort */
  }
}

export async function isLocked(userId: string, sessionId: string): Promise<boolean> {
  if (!ready()) return false;
  try {
    return (await redis.exists(`${LOCK_PREFIX}:${userId}:${sessionId}`)) === 1;
  } catch {
    return false;
  }
}

export async function clearLock(userId: string, sessionId: string) {
  if (!ready()) return;
  try {
    await redis.del(`${LOCK_PREFIX}:${userId}:${sessionId}`);
  } catch {
    /* best-effort */
  }
}
