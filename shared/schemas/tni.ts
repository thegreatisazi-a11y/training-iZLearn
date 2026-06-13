import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';

export const createTNISchema = z.object({
  userId: uuid,
  topicId: uuid,
  justification: nonEmptyString,
});
export type CreateTNIInput = z.infer<typeof createTNISchema>;

/** Approve / reject a TNI — APPROVE activates the training assignment (e-signed). */
export const tniDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  dueDate: z.coerce.date().optional(),
  reasonForChange: reasonForChange.optional(),
});
export type TNIDecisionInput = z.infer<typeof tniDecisionSchema>;

/** CR-46/47: set one cell of the TNI requirement matrix (role × topic). */
export const setTniRequirementSchema = z.object({
  roleId: uuid,
  topicId: uuid,
  isRequired: z.boolean(),
  note: optionalString,
});
export type SetTniRequirementInput = z.infer<typeof setTniRequirementSchema>;

/** CR-49: assign training from the requirement matrix (optionally a single role). */
export const applyTniMatrixSchema = z.object({
  roleId: uuid.optional(),
  dueDate: z.coerce.date().optional(),
  // CR-57: assign-later — create the matrix assignments as DEFERRED until activation.
  activateLater: z.boolean().optional(),
  activateOn: z.coerce.date().optional(),
});
export type ApplyTniMatrixInput = z.infer<typeof applyTniMatrixSchema>;
