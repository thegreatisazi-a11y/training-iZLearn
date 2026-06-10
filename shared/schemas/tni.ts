import { z } from 'zod';
import { nonEmptyString, uuid, reasonForChange } from './common';

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
