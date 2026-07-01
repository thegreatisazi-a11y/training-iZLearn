import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';
import { trainingType, topicStatus } from './enums';

/** CR-T9: a structured topic signatory (User · Prepared/Reviewed/Approved · Date). */
export const topicSignatory = z.object({
  userId: uuid,
  role: z.enum(['PREPARED', 'REVIEWED', 'APPROVED']),
  date: optionalString,
});
export type TopicSignatory = z.infer<typeof topicSignatory>;

export const createTopicSchema = z.object({
  title: nonEmptyString,
  topicNumber: optionalString, // user-entered display number (topicCode stays system-owned)
  sopNumber: optionalString, // controlled SOP / document number
  description: optionalString,
  trainingType,
  trainingTypes: z.array(trainingType).optional(), // D6: multiple training types
  departmentId: uuid.optional(),
  designationId: uuid.optional(),
  designationIds: z.array(uuid).optional(), // #2: functional roles this topic targets
  roleId: uuid.optional(),
  roleIds: z.array(uuid).optional(), // CR-30: multiple roles a topic is mapped to
  durationMinutes: z.coerce.number().int().min(0).optional(), // Page 8/G1: optional, demoted (0 = unspecified)
  requiresAssessment: z.coerce.boolean().optional(), // CR-41: false = SOP, completes via T&C
  assessmentTimeMinutes: z.coerce.number().int().positive().optional(), // CR-38: countdown limit
  passingScorePercent: z.coerce.number().int().min(0).max(100),
  maxAttempts: z.coerce.number().int().min(1),
  questionLimit: z.coerce.number().int().min(1).optional(), // per-topic # of questions per assessment
  randomizeQuestions: z.coerce.boolean().optional(),
  showExplanations: z.coerce.boolean().optional(),
  blockAfterMaxAttempts: z.coerce.boolean().optional(),
  refresherIntervalMonths: z.coerce.number().int().positive().optional(),
  signatoryUserIds: z.array(uuid).optional(), // CR-51: prepared/reviewed/approved-by signatories
  signatories: z.array(topicSignatory).optional(), // CR-T9: structured signatories
  sequenceIndex: z.coerce.number().int().min(0).optional(), // CR-29: course ordering
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
  trainingTypes: z.array(trainingType).optional(), // D6: multiple training types
  departmentId: uuid.optional(),
  designationId: uuid.optional(),
  designationIds: z.array(uuid).optional(), // #2: functional roles this topic targets
  roleId: uuid.optional(),
  roleIds: z.array(uuid).optional(), // CR-30
  requiresAssessment: z.coerce.boolean().optional(), // CR-41
  passingScorePercent: z.coerce.number().int().min(0).max(100).optional(), // edited inline; staged like other details on a published course
  assessmentTimeMinutes: z.coerce.number().int().positive().nullable().optional(), // CR-38 (null clears)
  // G1: duration is optional/demoted — 0 means "unspecified" and must be accepted on edit.
  durationMinutes: z.coerce.number().int().min(0).optional(),
  refresherIntervalMonths: z.coerce.number().int().min(0).optional(),
  maxAttempts: z.coerce.number().int().min(1).optional(),
  questionLimit: z.coerce.number().int().min(1).optional(),
  randomizeQuestions: z.coerce.boolean().optional(),
  showExplanations: z.coerce.boolean().optional(),
  blockAfterMaxAttempts: z.coerce.boolean().optional(),
  signatoryUserIds: z.array(uuid).optional(), // CR-51
  signatories: z.array(topicSignatory).optional(), // CR-T9: structured signatories
  sequenceIndex: z.coerce.number().int().min(0).optional(), // CR-29
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
