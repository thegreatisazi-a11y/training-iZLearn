import { z } from 'zod';
import { nonEmptyString, uuid, reasonForChange } from './common';

export const createDepartmentSchema = z.object({
  name: nonEmptyString,
  locationId: uuid,
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: nonEmptyString.optional(),
  locationId: uuid.optional(),
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
