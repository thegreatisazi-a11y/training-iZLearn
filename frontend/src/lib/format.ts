/**
 * Display helpers. All dates render as DD/MM/YY (Section 6), in **IST**.
 *
 * IST is fixed, not the viewer's local timezone: a training record must read the same
 * for everyone, and it must match the server-rendered exports and PDFs (which use
 * SystemConfig `system.timezone`, also IST). Using the browser's zone meant a user
 * abroad — or a laptop with the wrong clock — saw different timestamps from the
 * exported record of the same event.
 */
export const APP_TIMEZONE = 'Asia/Kolkata';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The calendar parts of an instant AS SEEN IN IST, regardless of the browser's zone. */
function istParts(value: string | Date): { y: number; m: number; d: number; hh: number; mm: number } | null {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  // 'en-GB' + explicit timeZone gives the IST wall-clock fields in a stable order.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dt);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  const out = { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
  return Object.values(out).some(Number.isNaN) ? null : out;
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const p = istParts(value);
  if (!p) return '—';
  return `${pad(p.d)}/${pad(p.m)}/${pad(p.y % 100)}`;
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const p = istParts(value);
  if (!p) return '—';
  return `${pad(p.d)}/${pad(p.m)}/${pad(p.y % 100)} ${pad(p.hh)}:${pad(p.mm)}`;
}

/** For <input type="date"> values (yyyy-mm-dd) — the IST calendar day. */
export function toDateInput(value?: string | Date | null): string {
  if (!value) return '';
  const p = istParts(value);
  if (!p) return '';
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Today as yyyy-mm-dd in local time — for <input type="date"> min/max bounds. */
export function todayInput(): string {
  return toDateInput(new Date());
}
