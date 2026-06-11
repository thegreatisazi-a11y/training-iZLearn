import ExcelJS from 'exceljs';

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

/** Build an .xlsx Buffer from columns + rows (used by every report export). */
export async function exportToExcel(
  columns: ExcelColumn[],
  rows: Array<Record<string, unknown>>,
  sheetName = 'Report',
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'izLearn';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 22 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  rows.forEach((r) => ws.addRow(r));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Parse the first worksheet into row objects keyed by the header row. Each row
 * includes `__row` (1-based worksheet row number) for error reporting in
 * bulk-upload previews.
 */
export async function parseExcel(buffer: Buffer): Promise<Array<Record<string, unknown>>> {
  const wb = new ExcelJS.Workbook();
  // exceljs resolves `Buffer` from a transitively-bundled older @types/node,
  // which is structurally incompatible with the workspace's @types/node Buffer.
  // The cast bridges the two definitions for this otherwise valid runtime call.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cell.value ?? '').trim();
  });

  const rows: Array<Record<string, unknown>> = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = { __row: rowNumber };
    row.eachCell((cell, col) => {
      const header = headers[col];
      if (header) {
        const v = cell.value as unknown;
        obj[header] =
          v && typeof v === 'object' && 'text' in (v as Record<string, unknown>)
            ? (v as { text: string }).text
            : v;
      }
    });
    rows.push(obj);
  });
  return rows;
}
