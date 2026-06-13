import { z } from 'zod';
import { nonEmptyString, optionalString, reasonForChange } from './common';

/**
 * Admin-configurable training type master (UR-102/103). `code` is normalised
 * server-side (upper-snake-case) and is unique; `displayName` is what users see.
 * Mirrors the designation / document-type master validation.
 */
export const createTrainingTypeMasterSchema = z.object({
  code: nonEmptyString,
  displayName: nonEmptyString,
  description: optionalString,
});
export type CreateTrainingTypeMasterInput = z.infer<typeof createTrainingTypeMasterSchema>;

export const updateTrainingTypeMasterSchema = z.object({
  displayName: nonEmptyString.optional(),
  description: optionalString,
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateTrainingTypeMasterInput = z.infer<typeof updateTrainingTypeMasterSchema>;
