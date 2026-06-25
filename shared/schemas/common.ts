import { z } from 'zod';

/**
 * Shared primitives & refinements used across every izLearn schema.
 * Kept framework-agnostic so the exact same validation runs on the
 * frontend (form validation) and the backend (request validation).
 */

export const uuid = z.string().uuid({ message: 'Must be a valid UUID' });

export const nonEmptyString = z.string().trim().min(1, { message: 'This field is required' });

export const optionalString = z
  .string()
  .trim()
  .optional()
  .or(z.literal('').transform(() => undefined));

/**
 * Mandatory "reason for change" — required by 21 CFR Part 11 for every
 * UPDATE / DELETE of a GMP-relevant record.
 */
export const reasonForChange = z
  .string()
  .trim()
  .min(5, { message: 'A reason for change of at least 5 characters is required (21 CFR Part 11)' })
  .max(500);

/**
 * No future dates. Any field representing an event that has already happened
 * (attendance date, OJT date, completion date) must not be in the future.
 * Authoritative time is always the server clock.
 */
export const pastOrPresentDate = z.coerce
  .date()
  .max(new Date(), { message: 'Date cannot be in the future' });

export const isoDateString = z
  .string()
  .datetime({ offset: true })
  .or(z.coerce.date().transform((d) => d.toISOString()));

/** Standard pagination query params. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Up to 1000 so "load-all" pickers (supervisor list, name resolution, topic/bundle
  // option lists) that request pageSize 500/1000 aren't rejected as a validation error.
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
  search: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  // NOTE: do NOT use z.coerce.boolean() here — it does Boolean("false") === true, so the
  // string "false" coming off a query string would wrongly enable inactive rows (this broke
  // the "Active only" filters). Parse the string explicitly instead.
  includeInactive: z
    .preprocess((v) => (typeof v === 'string' ? v === 'true' || v === '1' : v ?? false), z.boolean())
    .default(false),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

/** Standard date-range filter shared by every report. */
export const dateRangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type DateRangeQuery = z.infer<typeof dateRangeQuery>;

/** Generic paginated response envelope. */
export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Standard API success / error envelopes. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
