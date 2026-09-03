import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * The application's display timezone. Every user-visible date/time renders in IST.
 *
 * This is the FALLBACK for `system.timezone` (SystemConfig) and the default for the
 * formatters below. It must not be 'UTC': the deployment host runs on UTC, so a UTC
 * default silently produced UTC timestamps in exports on the server while looking
 * correct on an IST developer machine.
 */
export const APP_TIMEZONE = 'Asia/Kolkata';

/** Authoritative "now" — always the server clock (never client-supplied). */
export function now(): Date {
  return new Date();
}

/** Display a date as DD/MM/YY in the configured timezone (IST unless overridden). */
export function formatDate(date: Date | string | null | undefined, tz = APP_TIMEZONE): string {
  if (!date) return '';
  return dayjs(date).tz(tz).format('DD/MM/YY');
}

/** Display a timestamp as DD/MM/YY HH:mm in the configured timezone (IST unless overridden). */
export function formatDateTime(date: Date | string | null | undefined, tz = APP_TIMEZONE): string {
  if (!date) return '';
  return dayjs(date).tz(tz).format('DD/MM/YY HH:mm');
}

/**
 * YYYY-MM-DD **in the display timezone**, for the CSV exports that use the ISO shape.
 * `Date#toISOString().slice(0, 10)` is UTC, so for IST (UTC+5:30) anything stored after
 * 18:30 UTC rendered as the PREVIOUS day — a wrong date, not just a wrong clock.
 */
export function formatDateIso(date: Date | string | null | undefined, tz = APP_TIMEZONE): string {
  if (!date) return '';
  return dayjs(date).tz(tz).format('YYYY-MM-DD');
}

/** "Generated on …" stamp for export footers, always in the display timezone. */
export function formatStamp(date: Date | string = new Date(), tz = APP_TIMEZONE): string {
  return dayjs(date).tz(tz).format('DD/MM/YY HH:mm');
}

export function addMonths(date: Date, months: number): Date {
  return dayjs(date).add(months, 'month').toDate();
}

export function addDays(date: Date, days: number): Date {
  return dayjs(date).add(days, 'day').toDate();
}

export function isFuture(date: Date): boolean {
  return dayjs(date).isAfter(dayjs());
}

export function startOfDay(date: Date): Date {
  return dayjs(date).startOf('day').toDate();
}

export function endOfDay(date: Date): Date {
  return dayjs(date).endOf('day').toDate();
}

/**
 * Parse a "to" filter bound. A date-only value (YYYY-MM-DD) is pushed to the END of that
 * day so an inclusive `lte` query returns records from the whole day, not just 00:00:00
 * (DATE-1). A full datetime is used as-is.
 */
export function toEndBound(value: string): Date {
  const d = new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? endOfDay(d) : d;
}
