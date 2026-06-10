/**
 * Minimal, dependency-free CSV builder. Values are stringified and escaped per
 * RFC 4180 (quotes doubled, fields wrapped when they contain a comma, quote or
 * newline). A UTF-8 BOM is prepended so Excel opens non-ASCII correctly.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return '﻿' + lines.join('\r\n');
}
