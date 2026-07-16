import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Authoritative "now" — always the server clock (never client-supplied). */
export function now(): Date {
  return new Date();
}

/** Display a date as DD/MM/YY in the configured timezone. */
export function formatDate(date: Date | string | null | undefined, tz = 'UTC'): string {
  if (!date) return '';
  return dayjs(date).tz(tz).format('DD/MM/YY');
}

/** Display a timestamp as DD/MM/YY HH:mm in the configured timezone. */
export function formatDateTime(date: Date | string | null | undefined, tz = 'UTC'): string {
  if (!date) return '';
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
