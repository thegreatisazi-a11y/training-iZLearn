import type { PermissionMatrix, PermissionAction, PermissionVerb } from '@izlearn/shared';
import { LEGACY_FALLBACK } from '@izlearn/shared';

/**
 * Union of multiple role permission matrices — access is granted if ANY role
 * allows it. Every key present in any matrix (the 10 granular verbs plus the
 * legacy read/write/approve/print/export) is OR-merged generically.
 */
export function mergePermissions(matrices: Array<PermissionMatrix | null | undefined>): PermissionMatrix {
  const merged: Record<string, Record<string, boolean>> = {};
  for (const m of matrices) {
    if (!m) continue;
    for (const [mod, flags] of Object.entries(m)) {
      if (!merged[mod]) merged[mod] = {};
      for (const [key, val] of Object.entries((flags ?? {}) as Record<string, boolean>)) {
        merged[mod][key] = merged[mod][key] || Boolean(val);
      }
    }
  }
  return merged as unknown as PermissionMatrix;
}

/**
 * Check a permission. The granular verb is checked directly; if absent (e.g. an
 * older custom role saved under the 5-flag model), it falls back to its legacy
 * equivalent so access is preserved.
 */
export function hasPermission(perms: PermissionMatrix | undefined, module: string, action: PermissionAction): boolean {
  if (!perms) return false;
  const m = (perms as Record<string, Record<string, boolean>>)[module];
  if (!m) return false;
  if (m[action] === true) return true;
  // S6: an EXPLICIT false must restrict. Every role saved via Roles & Access Control (and
  // every seeded role) stores each granular verb as true/false, so an explicit false means
  // the admin turned it off — never silently fall back to the derived read/write flag (that
  // was the "toggled off but still allowed" bug). Fall back ONLY when the verb is entirely
  // ABSENT (a legacy role saved under the old 5-flag model that never had granular verbs).
  if (m[action] === false) return false;
  const fallback = LEGACY_FALLBACK[action as PermissionVerb];
  return fallback ? m[fallback] === true : false;
}
