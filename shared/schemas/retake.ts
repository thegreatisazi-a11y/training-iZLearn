import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';

/**
 * Trainee-initiated request to retake a BLOCKED assessment (max attempts
 * exhausted). Routed to the trainee's direct supervisor for approval.
 */
export const createRetakeRequestSchema = z.object({
  assignmentId: uuid,
  justification: nonEmptyString,
});
export type CreateRetakeRequestInput = z.infer<typeof createRetakeRequestSchema>;

/**
 * Supervisor decision on a retake request. APPROVE unblocks the assignment and
 * grants a fresh set of attempts (e-signed). The `signature` and
 * `reasonForChange` fields are carried on the body and preserved by the
 * validate middleware.
 */
export const retakeDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  decisionRemarks: optionalString,
  reasonForChange: reasonForChange.optional(),
});
export type RetakeDecisionInput = z.infer<typeof retakeDecisionSchema>;
