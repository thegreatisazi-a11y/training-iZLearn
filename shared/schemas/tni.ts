import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';

/**
 * J2: a New TNI may name several topics for one user. It is stored as one TNI row
 * per (user, topic). `topicIds` is the multi-select; `topicId` is accepted for
 * backward compatibility (older single-topic callers).
 */
export const createTNISchema = z
  .object({
    userId: uuid,
    topicIds: z.array(uuid).min(1).optional(),
    topicId: uuid.optional(),
    justification: nonEmptyString,
  })
  .refine((v) => (v.topicIds && v.topicIds.length > 0) || !!v.topicId, {
    message: 'Select at least one topic.',
    path: ['topicIds'],
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
  designationId: uuid,
  topicId: uuid,
  isRequired: z.boolean(),
  note: optionalString,
});
export type SetTniRequirementInput = z.infer<typeof setTniRequirementSchema>;

/** CR-49: assign training from the requirement matrix (optionally a single functional role). */
export const applyTniMatrixSchema = z.object({
  designationId: uuid.optional(),
  dueDate: z.coerce.date().optional(),
  // CR-57: assign-later — create the matrix assignments as DEFERRED until activation.
  activateLater: z.boolean().optional(),
  activateOn: z.coerce.date().optional(),
});
export type ApplyTniMatrixInput = z.infer<typeof applyTniMatrixSchema>;
