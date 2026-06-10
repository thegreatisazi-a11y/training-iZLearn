import { z } from 'zod';
import { nonEmptyString, optionalString, reasonForChange } from './common';

/**
 * Designation (job title) master data. Mirrors the training-type / document-type
 * master validation. `code` is normalised server-side (upper-snake-case) and is
 * unique; `displayName` is what users see.
 */
export const createDesignationSchema = z.object({
  code: nonEmptyString,
  displayName: nonEmptyString,
  description: optionalString,
});
export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;

export const updateDesignationSchema = z.object({
  displayName: nonEmptyString.optional(),
  description: optionalString,
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;
