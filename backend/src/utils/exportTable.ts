/**
 * One definition of a tabular export, rendered to whichever format was asked for.
 *
 * Each list export used to be CSV-only, built by its own service with its own header array
 * and its own escaping — three copies that could drift, and which used a CSV builder with no
 * formula-injection defence while the reports/audit path had one. A service now returns the
 * columns and rows once (`ExportTable`) and this module renders them, so adding Excel to a
 * screen is a route change rather than a second copy of the data mapping.
 */
import type { Response } from 'express';
import { exportFilename } from '@izlearn/shared';
import { exportToCsv, type CsvColumn } from './csvExporter';
import { exportToExcel } from './excelExporter';

export interface ExportTable {
  /** Sheet name and title row for Excel; ignored by CSV, which carries no furniture. */
  title: string;
  columns: CsvColumn[];
  rows: Array<Record<string, unknown>>;
}

/** Formats a tabular export can be rendered as. PDF is served by the print-document registry. */
export type TableFormat = 'csv' | 'xlsx';

/** Parse `?format=` into a supported format. Anything unrecognised falls back to CSV. */
export function parseTableFormat(value: unknown): TableFormat {
  return String(value ?? '').toLowerCase() === 'xlsx' || String(value ?? '').toLowerCase() === 'excel'
    ? 'xlsx'
    : 'csv';
}

export interface ExportActor {
  fullName: string;
  employeeId: string;
}

/**
 * Write a tabular export to the response with the standard filename and content type.
 *
 * `subject` is the filename stem (`courses` -> izlearn_courses_20260910-1830.xlsx). The
 * Excel path carries the same document furniture as the report PDFs; CSV deliberately
 * carries none — see csvExporter.ts.
 */
export async function sendTableExport(
  res: Response,
  table: ExportTable,
  subject: string,
  format: TableFormat,
  actor: ExportActor,
  org: { name: string; timezone?: string },
): Promise<void> {
  if (format === 'xlsx') {
    const buf = await exportToExcel(table.columns, table.rows, table.title, table.title, {
      generatedBy: actor.fullName,
      generatedByEmployeeId: actor.employeeId,
      timezone: org.timezone,
      orgName: org.name,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(subject, 'xlsx')}"`);
    res.send(buf);
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(subject, 'csv')}"`);
  res.send(exportToCsv(table.columns, table.rows));
}
