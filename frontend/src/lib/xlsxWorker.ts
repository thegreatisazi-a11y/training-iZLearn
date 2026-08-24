// ============================================================================
// DISABLED — reading-gate / xlsx work, commented out on request (2026-08-06).
//
// Nothing imports this file, so it is inert. To re-enable, uncomment the whole
// file and restore the call sites (see the saved patch noted in the handover).
// ============================================================================
// /// <reference lib="webworker" />
// import readXlsxFile from 'read-excel-file/web-worker';
// import { XLSX_INLINE_MAX_BYTES, XLSX_INLINE_MAX_CELLS } from '@izlearn/shared';
// import { getXlsxSheetOrder, sortSheetsByWorkbookOrder } from './xlsxSheetOrder';
//
// /**
//  * Off-main-thread .xlsx → HTML rendering.
//  *
//  * WHY A WORKER: `read-excel-file/browser` only offloads the ZIP decompression (fflate's async
//  * `unzip`). The expensive stage — parsing the sheet XML into cells, via DOMParser — runs on the
//  * calling thread, so a large workbook freezes the UI for as long as it takes. The `/web-worker`
//  * build exists for this: it swaps in a DOM-free XML parser (workers have no DOMParser) and a
//  * synchronous unzip, since it is already off the main thread.
//  *
//  * Everything expensive happens here — parse, workbook ordering, and building the HTML string —
//  * so the main thread receives finished markup. Only DOMPurify sanitising and the DOM insertion
//  * are left to the caller, because both need a real document.
//  */
//
// export interface XlsxRenderResult {
//   html: string;
//   sheetCount: number;
// }
// export type XlsxWorkerResponse =
//   | ({ ok: true } & XlsxRenderResult)
//   | { ok: false; tooLarge: string }
//   | { ok: false; error: string };
//
// const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
//
// /** Convert a sheet's rows to a simple bordered HTML table. */
// function rowsToTableHtml(rows: unknown[][]): string {
//   if (!rows.length) return '';
//   const [head, ...body] = rows;
//   const headHtml = `<tr>${head
//     .map((c) => `<th style="border:1px solid #cbd5e1;padding:6px;background:#f1f5f9;text-align:left">${esc(c)}</th>`)
//     .join('')}</tr>`;
//   const bodyHtml = body
//     .map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #cbd5e1;padding:6px">${esc(c)}</td>`).join('')}</tr>`)
//     .join('');
//   return `<table style="border-collapse:collapse;width:100%;font-size:12px">${headHtml}${bodyHtml}</table>`;
// }
//
// async function render(blob: Blob): Promise<XlsxWorkerResponse> {
//   // Cheap pre-check first: never pay for the parse on a workbook we won't render.
//   if (blob.size > XLSX_INLINE_MAX_BYTES) {
//     return { ok: false, tooLarge: `This workbook is ${(blob.size / 1024 / 1024).toFixed(1)} MB — too large to preview inline.` };
//   }
//
//   const [parsed, order] = await Promise.all([readXlsxFile(blob), getXlsxSheetOrder(blob)]);
//   // read-excel-file walks relationship order, which puts the last tab first on real
//   // Excel-authored files; workbook.xml's <sheet> order is the actual tab order.
//   const sheets = sortSheetsByWorkbookOrder(parsed, order);
//
//   // Safety net: a modest file can still expand into a grid too big for the DOM.
//   const cells = sheets.reduce((n, s) => n + s.data.reduce((m, r) => m + (Array.isArray(r) ? r.length : 0), 0), 0);
//   if (cells > XLSX_INLINE_MAX_CELLS) {
//     return { ok: false, tooLarge: `This workbook contains ${cells.toLocaleString()} cells — too large to preview inline.` };
//   }
//
//   const total = sheets.length;
//   // Multi-sheet workbooks announce themselves up front and number each section, so a trainee
//   // scrolling a continuous document can tell how many sheets there are and where they are.
//   const summary =
//     total > 1
//       ? `<div style="margin:0 0 14px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;font-size:12px;color:#475569">` +
//         `This workbook contains <strong>${total} sheets</strong> — scroll to read all of them.` +
//         `<div style="margin-top:4px;color:#64748b">${sheets.map((s, i) => `${i + 1}. ${esc(s.sheet)}`).join(' &nbsp;·&nbsp; ')}</div>` +
//         `</div>`
//       : '';
//
//   const html =
//     summary +
//     sheets
//       .map((s, i) => {
//         const table = rowsToTableHtml(s.data as unknown[][]);
//         const label = total > 1 ? `Sheet ${i + 1} of ${total} · ${esc(s.sheet)}` : esc(s.sheet);
//         const heading = `<h3 style="margin:0 0 6px;padding-top:${i === 0 ? 0 : 14}px;font-size:13px;font-weight:600;color:#334155">${label}</h3>`;
//         const divider = i === 0 ? '' : '<hr style="border:0;border-top:1px solid #e2e8f0;margin:16px 0 0" />';
//         // data-sheet-index drives sheet-coverage tracking — the viewer reports which sheet is
//         // on screen so the server can credit it (DOMPurify keeps data-* attributes).
//         return `${divider}<section data-sheet-index="${i + 1}" style="margin-bottom:16px">${heading}${
//           table || '<p style="font-size:12px;color:#94a3b8">(Empty sheet)</p>'
//         }</section>`;
//       })
//       .join('');
//
//   return { ok: true, html, sheetCount: total };
// }
//
// self.onmessage = (e: MessageEvent<Blob>) => {
//   render(e.data)
//     .then((res) => self.postMessage(res))
//     .catch((err: unknown) =>
//       self.postMessage({ ok: false, error: err instanceof Error ? err.message : 'Failed to read workbook.' } satisfies XlsxWorkerResponse),
//     );
// };

export {};
