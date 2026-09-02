import { z } from 'zod';
import { uuid, reasonForChange } from './common';

/** Allowed upload types — validated by BOTH extension and MIME on the server. */
export const ALLOWED_MATERIAL_EXTENSIONS = [
  'pdf',
  'docx',
  // .doc and .xls (the pre-2007 binary formats) are deliberately NOT accepted: they cannot be
  // rendered in the locked in-app viewer (mammoth reads .docx only, exceljs .xlsx only) and the
  // server-side LibreOffice conversion is not available on the deployed API, so a trainee would be
  // credited with the reading time for a document that was never displayed. Save as .docx/.xlsx.
  'pptx',
  'ppt',
  // .avi and .mov are deliberately NOT accepted: no browser can play .avi at all, and neither
  // container could be shown in the locked in-app viewer, so a trainee was credited with the
  // reading time for a video they were never actually shown. Training video must be .mp4.
  // (Both remain in MATERIAL_VIDEO_EXTENSIONS below — see the note there — so any file uploaded
  // before this restriction still behaves correctly.)
  'mp4',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
] as const;

/**
 * How each material type is presented, and therefore whether the end-of-document reading gate
 * applies to it. Defined ONCE here because both halves need it and they must agree: the backend
 * decides whether a material is gated, the frontend decides which viewer renders it, and a type
 * that is gated by one but rendered natively by the other can never satisfy the gate — the course
 * then cannot be completed at all. That mismatch has already caused two defects (docx/xlsx
 * deadlocking the acknowledgement, and .avi/.mov having no viewer while still being credited).
 */
// .mov/.avi/.mkv are no longer accepted for upload but MUST stay here: this list decides whether
// the end-of-document gate applies, and a material stored before the restriction would otherwise
// become "paginated" — no viewer can report a last page for it, so its course could never be
// completed by anyone still assigned it.
export const MATERIAL_VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'] as const;

/**
 * The subset of video types a browser can actually play in a <video> element. Containers outside
 * this list (.avi, .mkv) are still VIDEO for gating purposes — there is no last page to reach —
 * but they must not be handed to a player that would fail silently; they get the
 * "preview unavailable, use Download" panel instead.
 */
export const BROWSER_PLAYABLE_VIDEO_EXTENSIONS: readonly string[] = ['mp4', 'webm', 'ogg', 'mov'];
export const MATERIAL_AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'oga', 'opus'] as const;
export const MATERIAL_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] as const;
export const MATERIAL_TEXT_EXTENSIONS = ['txt', 'csv', 'log', 'md', 'json'] as const;

/**
 * Types with no "last page" to reach, so the end-of-document gate does not apply: media is shown
 * whole in a native player, and plain text renders as a single short block. Everything else
 * (pdf, doc/docx, ppt/pptx, xls/xlsx) is scrollable and IS gated.
 */
export const NON_PAGINATED_MATERIAL_EXTENSIONS: readonly string[] = [
  ...MATERIAL_VIDEO_EXTENSIONS,
  ...MATERIAL_AUDIO_EXTENSIONS,
  ...MATERIAL_IMAGE_EXTENSIONS,
  ...MATERIAL_TEXT_EXTENSIONS,
];

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
