import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { AppError } from './response';

export interface PasswordPolicyConfig {
  minLength: number;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.bcryptCost);
}

export async function comparePassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

/** Enforce the configurable complexity policy. Throws AppError(400) on violation. */
export function validatePasswordPolicy(password: string, policy: PasswordPolicyConfig): void {
  const errors: string[] = [];
  if (password.length < policy.minLength) errors.push(`at least ${policy.minLength} characters`);
  if (!/[A-Z]/.test(password)) errors.push('an uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('a lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('a digit');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('a special character');
  if (errors.length) {
    throw AppError.badRequest(`Password must contain ${errors.join(', ')}.`);
  }
}

/** Ensure the new password was not used in the last N historical hashes. */
export async function assertNotReused(plain: string, historyHashes: string[], historyCount: number): Promise<void> {
  const toCheck = historyHashes.slice(0, historyCount);
  for (const h of toCheck) {
    if (await bcrypt.compare(plain, h)) {
      throw AppError.badRequest(`Password may not match any of your last ${historyCount} passwords.`);
    }
  }
}
