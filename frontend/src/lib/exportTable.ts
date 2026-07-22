import { downloadCsv } from './csv';
import { printHtml } from './print';
import type { ExportFormat } from '@/components/common/ExportMenu';

/** A column for a client-side table export: a header plus how to read the cell from a row. */
export interface ExportColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Excel-openable file without a spreadsheet library: an HTML table served as .xls. */
function downloadXls(filename: string, headers: string[], rows: unknown[][]): void {
  const table =
    `<table border="1"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" /></head><body>${table}</body></html>`;
  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Uniform client-side export of a table (the rows currently loaded) in the chosen format.
 * Backs the standard ExportMenu on screens whose data lives on the client:
 *   - csv   → downloadable .csv
 *   - excel → downloadable .xls (opens in Excel/LibreOffice)
 *   - pdf   → the formatted document via the browser print dialog → "Save as PDF"
 *   - print → the same formatted document sent to the printer
 * (pdf and print share the browser dialog, so screens with only client data expose one or
 * the other — never both — to avoid the redundant "Download PDF"+"Print" pair.)
 */
export function exportTable<T>(
  format: ExportFormat,
  opts: { filename: string; title: string; columns: ExportColumn<T>[]; rows: T[] },
): void {
  const headers = opts.columns.map((c) => c.header);
  const data = opts.rows.map((r) => opts.columns.map((c) => c.value(r)));
  if (format === 'csv') return downloadCsv(`${opts.filename}.csv`, headers, data);
  if (format === 'excel') return downloadXls(`${opts.filename}.xls`, headers, data);
  // pdf + print → the browser print dialog (which can Save as PDF).
  const table =
    `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${data.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  printHtml(opts.title, `<h1>${esc(opts.title)}</h1>${table}`);
}
