// ============================================================================
// DISABLED — reading-gate / xlsx work, commented out on request (2026-08-06).
//
// Nothing imports this file, so it is inert. To re-enable, uncomment the whole
// file and restore the call sites (see the saved patch noted in the handover).
// ============================================================================
// import { XLSX_INLINE_MAX_BYTES, XLSX_INLINE_MAX_CELLS } from '@izlearn/shared';
// import { prisma } from '../config/prisma';
// import { logger } from '../config/logger';
// import * as storage from './storage.service';
// import { ensureConvertedPdfKey, isConvertibleOffice } from './officeConvert.service';
//
// /**
//  * Server-authoritative document page counts for the page-coverage reading control.
//  *
//  * The trainee's client knows how many pages a document has (pdf.js reports it), but the
//  * page count must NOT be taken from the client: a tampered client could claim "1 page"
//  * and skip the coverage requirement entirely. So the count is derived here, on the server,
//  * from the same bytes the trainee is shown, and cached on the material row.
//  *
//  * A material row is immutable (a replacement is a new row), so the count is stable and is
//  * only ever computed once per material.
//  *
//  * FAIL-OPEN: when a count cannot be determined this returns null and coverage is skipped,
//  * leaving the existing minimum-reading-time gate in force. A document we cannot paginate
//  * must never permanently block a trainee from completing assigned training.
//  */
//
// /**
//  * What a material's reading coverage is counted in.
//  *
//  * 'page'  — pdf, and Word/PowerPoint/legacy-xls, which render through the paginated pdf.js
//  *           viewer (Office types via server-side LibreOffice conversion).
//  * 'sheet' — .xlsx, which renders natively as a scrollable sheet-by-sheet grid. A spreadsheet
//  *           is not a paginated document: its "pages" exist only as print layout and split
//  *           wide grids mid-column, so the WORKSHEET is the meaningful unit to require.
//  *           Legacy .xls stays page-based because it cannot be parsed natively.
//  */
// export type CoverageUnit = 'page' | 'sheet';
//
// const SHEET_EXTS = new Set(['xlsx']);
//
// export function coverageUnitFor(ext: string): CoverageUnit | null {
//   const e = ext.toLowerCase();
//   if (SHEET_EXTS.has(e)) return 'sheet';
//   if (e === 'pdf' || isConvertibleOffice(e)) return 'page';
//   return null;
// }
//
// /** True when this file type has countable reading units at all (vs video/audio/image/text). */
// export function hasCoverageUnits(ext: string): boolean {
//   return coverageUnitFor(ext) !== null;
// }
//
// /**
//  * Count worksheets with the SAME parser the browser uses to render them.
//  *
//  * This matters more than it looks: if the server required more units than the viewer actually
//  * renders, the trainee could never satisfy coverage and would be permanently blocked. Using
//  * read-excel-file on both sides makes the two counts identical by construction — rather than
//  * approximating it from workbook.xml, where hidden sheets and chartsheets could disagree.
//  */
// async function countXlsxSheets(bytes: Uint8Array): Promise<number | null> {
//   // A workbook the viewer refuses to render inline must not be counted here either — the
//   // trainee would be asked to cover sheets they were never shown. Checking this BEFORE
//   // parsing also avoids the cost: a 7.3 MB export took ~97 s to parse, which would block
//   // the reading-status request for the same 97 s.
//   if (bytes.byteLength > XLSX_INLINE_MAX_BYTES) {
//     logger.info(`Workbook is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — too large to render inline, so no sheet coverage is required.`);
//     return null;
//   }
//   try {
//     const spec = 'read-excel-file/node';
//     const mod = (await import(spec)) as { default: (input: unknown) => Promise<{ sheet: string; data: unknown[][] }[]> };
//     const sheets = await mod.default(Buffer.from(bytes));
//     if (sheets.length === 0) return null;
//     const cells = sheets.reduce((n, s) => n + s.data.reduce((m, r) => m + (Array.isArray(r) ? r.length : 0), 0), 0);
//     if (cells > XLSX_INLINE_MAX_CELLS) {
//       logger.info(`Workbook has ${cells} cells — too large to render inline, so no sheet coverage is required.`);
//       return null;
//     }
//     return sheets.length;
//   } catch (e) {
//     logger.warn(`Could not determine worksheet count: ${e instanceof Error ? e.message : String(e)}`);
//     return null;
//   }
// }
//
// /**
//  * Count pages in a PDF buffer via pdf.js — the same library that renders the document in
//  * the trainee's locked viewer, so the server's count and the client's page numbering can
//  * never disagree.
//  *
//  * The specifier is held in a variable deliberately: pdf.js ships its Node build as ESM,
//  * and the backend is typechecked as CommonJS. A literal specifier would make `tsc` try to
//  * resolve the .mjs and fail; a variable keeps the import dynamic (tsx resolves it at
//  * runtime, in dev and in production, since both run through tsx).
//  */
// async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
//   try {
//     const spec = 'pdfjs-dist/legacy/build/pdf.mjs';
//     const pdfjs = (await import(spec)) as {
//       getDocument: (src: unknown) => { promise: Promise<{ numPages: number; destroy: () => Promise<void> }> };
//     };
//     // pdf.js rejects a Node Buffer outright ("provide binary data as Uint8Array") even though
//     // Buffer subclasses it, and it may take ownership of the backing memory — so hand it an
//     // independent copy rather than a view over storage's (possibly pooled) buffer.
//     const data = bytes instanceof Buffer ? new Uint8Array(bytes) : bytes;
//     // No worker, no rendering — the document is only parsed far enough to read its page tree.
//     const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
//     const n = doc.numPages;
//     await doc.destroy().catch(() => undefined);
//     return Number.isInteger(n) && n > 0 ? n : null;
//   } catch (e) {
//     logger.warn(`Could not determine PDF page count: ${e instanceof Error ? e.message : String(e)}`);
//     return null;
//   }
// }
//
// /**
//  * Resolve (and cache) a material's reading-unit count — pages, or worksheets for .xlsx.
//  * PDFs are read directly; Word/PowerPoint/.xls are counted from the cached LibreOffice
//  * conversion (the exact artefact the trainee views, so the numbers line up with the screen);
//  * .xlsx is counted from the workbook itself, since it renders natively.
//  *
//  * Resolved lazily on first read rather than at upload time so that every upload path
//  * (single, bulk, replace, attach-from-library, instruction) and every material that
//  * already existed before this control was introduced are covered, with no backfill.
//  */
// export async function resolveMaterialPageCount(material: {
//   id: string;
//   filePath: string;
//   fileType: string;
//   pageCount: number | null;
//   fileSize?: number;
// }): Promise<number | null> {
//   if (material.pageCount != null) return material.pageCount;
//   const unit = coverageUnitFor(material.fileType);
//   if (!unit) return null;
//
//   // Reject an oversized workbook from the row's own fileSize, BEFORE touching storage. A null
//   // result is deliberately not cached, so without this the 7 MB blob would be re-downloaded on
//   // every reading-status call just to be rejected again.
//   if (unit === 'sheet' && material.fileSize != null && material.fileSize > XLSX_INLINE_MAX_BYTES) {
//     return null;
//   }
//
//   let count: number | null = null;
//   try {
//     if (unit === 'sheet') {
//       // Native render — counted straight from the workbook, no LibreOffice involved.
//       count = await countXlsxSheets(await storage.getBuffer(material.filePath));
//     } else {
//       const key = isConvertibleOffice(material.fileType)
//         ? await ensureConvertedPdfKey({ id: material.id, filePath: material.filePath, fileType: material.fileType })
//         : material.filePath;
//       count = await countPdfPages(await storage.getBuffer(key));
//     }
//   } catch (e) {
//     // Conversion unavailable (no LibreOffice) or unreadable bytes — stay fail-open.
//     logger.warn(`Page count unavailable for material ${material.id}: ${e instanceof Error ? e.message : String(e)}`);
//     return null;
//   }
//
//   if (count == null) return null;
//   await prisma.trainingMaterial.update({ where: { id: material.id }, data: { pageCount: count } }).catch(() => undefined);
//   return count;
// }

export {};
