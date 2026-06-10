import { prisma } from '../config/prisma';
import { DEFAULT_SYSTEM_CONFIG } from '@izlearn/shared';

/** In-memory cache of config values (invalidated on every write). */
let cache: Map<string, string> | null = null;

async function load(): Promise<Map<string, string>> {
  if (cache) return cache;
  const rows = await prisma.systemConfig.findMany();
  cache = new Map(rows.map((r) => [r.key, r.value]));
  return cache;
}

export function invalidateConfigCache(): void {
  cache = null;
}

export async function getConfig(key: string): Promise<string> {
  const c = await load();
  return c.get(key) ?? DEFAULT_SYSTEM_CONFIG[key]?.value ?? '';
}

export async function getNumber(key: string, fallback = 0): Promise<number> {
  const v = await getConfig(key);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function getBool(key: string, fallback = false): Promise<boolean> {
  const v = (await getConfig(key)).toLowerCase();
  if (v === '') return fallback;
  return v === 'true';
}

export async function getList(key: string): Promise<string[]> {
  const v = await getConfig(key);
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function listConfig() {
  return prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
}

/**
 * Update one or more config keys. Each write goes through the Prisma audit
 * middleware which records it as CONFIG_CHANGE (the controller has already set
 * the reasonForChange in the audit context).
 */
export async function updateConfig(items: Array<{ key: string; value: string }>, updatedBy: string) {
  for (const { key, value } of items) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedBy },
      create: { key, value, updatedBy, description: DEFAULT_SYSTEM_CONFIG[key]?.description },
    });
  }
  invalidateConfigCache();
  return listConfig();
}

/** Convenience bundle of the password policy values. */
export async function getPasswordPolicy() {
  return {
    minLength: await getNumber('password.min_length', 8),
    expiryDays: await getNumber('password.expiry_days', 90),
    historyCount: await getNumber('password.history_count', 5),
  };
}

export async function getAuthPolicy() {
  return {
    maxFailedAttempts: await getNumber('auth.max_failed_attempts', 5),
    lockoutMinutes: await getNumber('auth.lockout_minutes', 30),
    sessionTimeoutMinutes: await getNumber('session.timeout_minutes', 15),
  };
}

export async function getOrgInfo() {
  return {
    name: await getConfig('org.name'),
    logoPath: await getConfig('org.logo_path'),
    signatoryName: await getConfig('org.signatory_name'),
    signatoryTitle: await getConfig('org.signatory_title'),
    timezone: (await getConfig('system.timezone')) || 'UTC',
  };
}
