import { z } from 'zod';
import { nonEmptyString, uuid, reasonForChange } from './common';

export const uploadPersonalDocSchema = z.object({
  userId: uuid,
  documentType: nonEmptyString,
  title: nonEmptyString,
});
export type UploadPersonalDocInput = z.infer<typeof uploadPersonalDocSchema>;

export const deletePersonalDocSchema = z.object({
  reasonForChange,
});
export type DeletePersonalDocInput = z.infer<typeof deletePersonalDocSchema>;
