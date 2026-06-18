import { z } from 'zod';
import { nonEmptyString, uuid, reasonForChange } from './common';

export const createJDSchema = z.object({
  userId: uuid,
  departmentId: uuid,
  roleId: uuid,
  title: nonEmptyString,
  /** Rich-text HTML; sanitised with DOMPurify before render. */
  content: nonEmptyString,
});
export type CreateJDInput = z.infer<typeof createJDSchema>;

export const updateJDSchema = z.object({
  title: nonEmptyString.optional(),
  content: nonEmptyString.optional(),
  reasonForChange,
});
export type UpdateJDInput = z.infer<typeof updateJDSchema>;

/** Move a JD through its lifecycle. APPROVED requires an e-signature. */
export const jdTransitionSchema = z.object({
  action: z.enum(['SUBMIT_FOR_REVIEW', 'APPROVE', 'REJECT', 'OBSOLETE']),
  remarks: z.string().optional(),
  reasonForChange: reasonForChange.optional(),
});
export type JDTransitionInput = z.infer<typeof jdTransitionSchema>;

/** Master JD template keyed by Functional Role (+ optional department) — D-JD1. */
export const jdTemplateSchema = z.object({
  functionalRoleId: uuid,
  departmentId: uuid.optional(),
  title: nonEmptyString,
  content: nonEmptyString,
});
export type JDTemplateInput = z.infer<typeof jdTemplateSchema>;

/** CR-50 / D-JD1: assign a Functional Role to a user → auto-assigns the JD template. */
export const assignFunctionalRoleSchema = z.object({
  userId: uuid,
  functionalRoleId: uuid,
});
export type AssignFunctionalRoleInput = z.infer<typeof assignFunctionalRoleSchema>;

/**
 * I4/I5: assign a JD to a user by picking a template (by title). The title/content/
 * department are pre-filled from the template but editable — the edited copy applies
 * only to this assignment and never mutates the template. Assigned directly as APPROVED.
 */
export const assignJDFromTemplateSchema = z.object({
  userId: uuid,
  templateId: uuid,
  title: nonEmptyString,
  content: nonEmptyString,
  departmentId: uuid.optional(),
});
export type AssignJDFromTemplateInput = z.infer<typeof assignJDFromTemplateSchema>;

/** The exact sentence a user must type to acknowledge their JD (D-JD3). */
export const JD_ACK_SENTENCE = 'I acknowledge/accept the assigned responsibilities.';

/** CR-50 / D-JD3: acknowledge own JD — typed sentence + secondary-password e-signature. */
export const acknowledgeJDSchema = z.object({
  acknowledgementText: nonEmptyString,
});
export type AcknowledgeJDInput = z.infer<typeof acknowledgeJDSchema>;
