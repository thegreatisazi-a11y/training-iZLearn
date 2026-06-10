import { z } from 'zod';
import { uuid, reasonForChange } from './common';

/** Allowed upload types — validated by BOTH extension and MIME on the server. */
export const ALLOWED_MATERIAL_EXTENSIONS = [
  'pdf',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'mp4',
  'avi',
  'mov',
  'xls',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
] as const;

export const uploadMaterialSchema = z.object({
  topicId: uuid,
});
export type UploadMaterialInput = z.infer<typeof uploadMaterialSchema>;

export const deleteMaterialSchema = z.object({
  reasonForChange,
});
export type DeleteMaterialInput = z.infer<typeof deleteMaterialSchema>;

/** Set a material's required reading/viewing time (minutes in the UI → seconds here). */
export const updateMaterialSchema = z.object({
  requiredViewSeconds: z.coerce.number().int().min(0),
});
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
