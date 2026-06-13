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

export const upsertCvSchema = z.object({
  languagesKnown: optionalString,
  qualifications: z.array(qualification).optional(),
  currentRole: optionalString,
  currentTenureFrom: optionalString,
  currentTenureTo: optionalString,
  currentResponsibilities: optionalString,
  experience: z.array(experienceItem).optional(),
  trainings: z.array(numberedItem).optional(),
  publications: z.array(numberedItem).optional(),
});
export type UpsertCvInput = z.infer<typeof upsertCvSchema>;
