import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';
import { trainingType, topicStatus } from './enums';

export const createTopicSchema = z.object({
  title: nonEmptyString,
  topicNumber: optionalString, // user-entered display number (topicCode stays system-owned)
  sopNumber: optionalString, // controlled SOP / document number
  description: optionalString,
  trainingType,
  departmentId: uuid.optional(),
  designationId: uuid.optional(),
  roleId: uuid.optional(),
  durationMinutes: z.coerce.number().int().positive(),
  passingScorePercent: z.coerce.number().int().min(0).max(100),
  maxAttempts: z.coerce.number().int().min(1),
  questionLimit: z.coerce.number().int().min(1).optional(), // per-topic # of questions per assessment
  randomizeQuestions: z.coerce.boolean().optional(),
  showExplanations: z.coerce.boolean().optional(),
  blockAfterMaxAttempts: z.coerce.boolean().optional(),
  refresherIntervalMonths: z.coerce.number().int().positive().optional(),
  materialViewSeconds: z.coerce.number().int().min(0).optional(),
  effectiveDate: z.coerce.date().optional(),
  reviewDate: z.coerce.date().optional(),
  status: topicStatus.optional(), // DRAFT (default) when omitted; "Create & Publish" sets PUBLISHED
});
export type CreateTopicInput = z.infer<typeof createTopicSchema>;

/**
 * topicCode is permanently locked after creation and is intentionally NOT
 * accepted here — the API rejects any attempt to modify it. topicNumber (the
 * user-facing label) IS editable.
 */
export const updateTopicSchema = z.object({
  title: nonEmptyString.optional(),
  topicNumber: optionalString,
  sopNumber: optionalString,
  description: optionalString,
  trainingType: trainingType.optional(),
  departmentId: uuid.optional(),
  designationId: uuid.optional(),
  roleId: uuid.optional(),
  durationMinutes: z.coerce.number().int().positive().optional(),
  refresherIntervalMonths: z.coerce.number().int().positive().optional(),
  maxAttempts: z.coerce.number().int().min(1).optional(),
  questionLimit: z.coerce.number().int().min(1).optional(),
  randomizeQuestions: z.coerce.boolean().optional(),
  showExplanations: z.coerce.boolean().optional(),
  blockAfterMaxAttempts: z.coerce.boolean().optional(),
  materialViewSeconds: z.coerce.number().int().min(0).optional(),
  effectiveDate: z.coerce.date().optional(),
  reviewDate: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;

/** Publish / unpublish (archive) a topic. Controlled change → reason required. */
export const updateTopicStatusSchema = z.object({
  status: topicStatus,
  reasonForChange,
});
export type UpdateTopicStatusInput = z.infer<typeof updateTopicStatusSchema>;

/** Changing the passing score is a controlled change → requires e-signature. */
export const updatePassingScoreSchema = z.object({
  passingScorePercent: z.coerce.number().int().min(0).max(100),
  reasonForChange,
});
export type UpdatePassingScoreInput = z.infer<typeof updatePassingScoreSchema>;

/** Create a new content version of an existing topic. */
export const reviseTopicSchema = z.object({
  reasonForChange,
});
export type ReviseTopicInput = z.infer<typeof reviseTopicSchema>;
