import { z } from 'zod';
import { nonEmptyString, optionalString, reasonForChange } from './common';

export const createLocationSchema = z.object({
  name: nonEmptyString,
  description: optionalString,
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z.object({
  name: nonEmptyString.optional(),
  description: optionalString,
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
