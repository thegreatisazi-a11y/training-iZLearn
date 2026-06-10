import { z } from 'zod';
import { nonEmptyString, uuid, reasonForChange } from './common';

export const createAnnouncementSchema = z.object({
  title: nonEmptyString,
  /** Rich-text HTML; sanitised with DOMPurify before render. */
  content: nonEmptyString,
  /** Empty array = visible to all roles. */
  targetRoles: z.array(uuid).default([]),
  expiresAt: z.coerce.date().optional(),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export const updateAnnouncementSchema = z.object({
  title: nonEmptyString.optional(),
  content: nonEmptyString.optional(),
  targetRoles: z.array(uuid).optional(),
  expiresAt: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
