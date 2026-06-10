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

/** Master JD template keyed by department + role, used on transfer pre-fill. */
export const jdTemplateSchema = z.object({
  departmentId: uuid,
  roleId: uuid,
  title: nonEmptyString,
  content: nonEmptyString,
});
export type JDTemplateInput = z.infer<typeof jdTemplateSchema>;
