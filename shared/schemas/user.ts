import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';
import { userType, releaseStage } from './enums';

/** CR-16: move a user along the onboarding/release lifecycle (e-signed). */
export const setReleaseStageSchema = z.object({
  stage: releaseStage,
  reasonForChange,
});
export type SetReleaseStageInput = z.infer<typeof setReleaseStageSchema>;

export const createUserSchema = z.object({
  userType,
  fullName: nonEmptyString,
  employeeId: nonEmptyString,
  windowsUsername: nonEmptyString,
  email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  departmentId: uuid,
  locationId: uuid,
  supervisorId: uuid.optional(), // UR-42: direct line manager for training notifications
  designationId: uuid.optional(), // job designation (master data)
  roleIds: z.array(uuid).min(1, { message: 'At least one role is required' }),
  remarks: optionalString,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: nonEmptyString.optional(),
  email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  departmentId: uuid.optional(),
  locationId: uuid.optional(),
  supervisorId: uuid.optional(), // UR-42
  designationId: uuid.optional(), // job designation (master data)
  userType: userType.optional(),
  reasonForChange,
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const changeUserRolesSchema = z.object({
  roleIds: z.array(uuid).min(1),
  reasonForChange,
});
export type ChangeUserRolesInput = z.infer<typeof changeUserRolesSchema>;

/** Approve / reject a pending user-creation request — always e-signed. */
export const userRequestDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  remarks: optionalString,
  reasonForChange: reasonForChange.optional(),
});
export type UserRequestDecisionInput = z.infer<typeof userRequestDecisionSchema>;

export const resetPasswordSchema = z.object({
  reasonForChange,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** One row in a bulk-upload preview. */
export const bulkUserRowSchema = z.object({
  rowNumber: z.number().int(),
  userType: z.string(),
  fullName: z.string(),
  employeeId: z.string(),
  windowsUsername: z.string(),
  email: z.string().optional(),
  department: z.string(),
  roles: z.string(),
  location: z.string(),
  remarks: z.string().optional(),
});
export type BulkUserRow = z.infer<typeof bulkUserRowSchema>;
