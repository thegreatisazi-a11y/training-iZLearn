import { z } from 'zod';
import { optionalString } from './common';

/** CV (Curriculum Vitae) — one live CV per user; history via the audit trail (D-CV1). */

const qualification = z.object({
  year: optionalString,
  degree: optionalString,
  specialization: optionalString,
  institute: optionalString,
});

const experienceItem = z.object({
  organisation: optionalString,
  role: optionalString,
  tenureFrom: optionalString,
  tenureTo: optionalString,
  responsibilities: optionalString,
});

const numberedItem = z.object({
  srNo: z.union([z.string(), z.number()]).optional(),
  detail: optionalString,
});

/** #4: a structured known-language entry. */
const languageItem = z.object({
  language: optionalString,
  read: z.boolean().optional(),
  write: z.boolean().optional(),
  understand: z.boolean().optional(),
});

export const upsertCvSchema = z.object({
  languagesKnown: optionalString,
  languages: z.array(languageItem).optional(),
  qualifications: z.array(qualification).optional(),
  currentRole: optionalString,
  currentTenureFrom: optionalString,
  currentTenureTo: optionalString,
  currentResponsibilities: optionalString,
  experience: z.array(experienceItem).optional(),
  trainings: z.array(numberedItem).optional(),
  publications: z.array(numberedItem).optional(),
  // S3: sections a user can explicitly mark "Not Applicable" instead of filling in.
  experienceNotApplicable: z.coerce.boolean().optional(),
  trainingsNotApplicable: z.coerce.boolean().optional(),
  publicationsNotApplicable: z.coerce.boolean().optional(),
});
export type UpsertCvInput = z.infer<typeof upsertCvSchema>;
