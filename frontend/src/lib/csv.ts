/** Client-side CSV builder + download (RFC 4180 escaping, UTF-8 BOM for Excel). */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // CSV formula-injection defence, matching backend/src/utils/csvExporter.ts. A cell whose
  // first character is = + - @ (or a leading tab/CR) is evaluated as a formula by Excel and
  // LibreOffice, so user-entered text (a course title, a role description, a TNI
  // justification) could execute on the machine of whoever opens the export. Prefixing with
  // an apostrophe renders it as literal text instead.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return '﻿' + lines.join('\r\n');
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
