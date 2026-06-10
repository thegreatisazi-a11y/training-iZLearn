export interface CsvColumn {
  header: string;
  key: string;
}

function escapeCsv(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render columns + rows to a CSV string (RFC-4180 quoting). */
export function exportToCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>): string {
  const head = columns.map((c) => escapeCsv(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCsv(r[c.key])).join(',')).join('\r\n');
  return `${head}\r\n${body}`;
}
