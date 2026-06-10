import { z } from 'zod';
import { nonEmptyString, optionalString, reasonForChange } from './common';
import { PERMISSION_MODULES } from './enums';

const permissionFlags = z.object({
  // 10 granular GMP verbs (surfaced in the Roles matrix UI)
  view: z.boolean().default(false),
  create: z.boolean().default(false),
  edit: z.boolean().default(false),
  archive: z.boolean().default(false),
  revise: z.boolean().default(false),
  assign: z.boolean().default(false),
  review: z.boolean().default(false),
  approve: z.boolean().default(false),
  print: z.boolean().default(false),
  export: z.boolean().default(false),
  // legacy aliases (derived from the verbs on save) — preserved for existing route guards
  read: z.boolean().default(false),
  write: z.boolean().default(false),
});
export type PermissionFlags = z.infer<typeof permissionFlags>;

/** The permission matrix: { moduleKey: { read, write, approve, print, export } }. */
export const permissionMatrix = z.record(z.enum(PERMISSION_MODULES), permissionFlags);
export type PermissionMatrix = z.infer<typeof permissionMatrix>;

export const createRoleSchema = z.object({
  roleName: nonEmptyString,
  description: optionalString,
  permissions: permissionMatrix,
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  description: optionalString,
  permissions: permissionMatrix.optional(),
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
