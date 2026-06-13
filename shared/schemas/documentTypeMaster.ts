import { z } from 'zod';
import { nonEmptyString, optionalString, reasonForChange } from './common';

/**
 * Admin-configurable document type master (UR-102/103). `code` is normalised
 * server-side (upper-snake-case) and is unique; `displayName` is what users see.
 * Mirrors the designation / training-type master validation.
 */
export const createDocumentTypeMasterSchema = z.object({
  code: nonEmptyString,
  displayName: nonEmptyString,
  description: optionalString,
});
export type CreateDocumentTypeMasterInput = z.infer<typeof createDocumentTypeMasterSchema>;

export const updateDocumentTypeMasterSchema = z.object({
  displayName: nonEmptyString.optional(),
  description: optionalString,
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateDocumentTypeMasterInput = z.infer<typeof updateDocumentTypeMasterSchema>;
