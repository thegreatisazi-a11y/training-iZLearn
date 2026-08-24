// ============================================================================
// DISABLED — reading-gate / xlsx work, commented out on request (2026-08-06).
//
// Nothing imports this file, so it is inert. To re-enable, uncomment the whole
// file and restore the call sites (see the saved patch noted in the handover).
// ============================================================================
// /**
//  * Authoritative worksheet order for an .xlsx workbook.
//  *
//  * WHY THIS EXISTS: `read-excel-file` walks `xl/_rels/workbook.xml.rels` (relationship order)
//  * rather than the `<sheet>` elements in `xl/workbook.xml`. Excel does not rewrite the rels
//  * file when tabs are reordered, so the two disagree on real-world workbooks — a two-sheet
//  * file whose rels list rId2 before rId1 comes back as [Sheet2, Sheet1] and renders with the
//  * last tab first. `workbook.xml`'s `<sheet>` order IS the display order, so we read it
//  * ourselves and reorder the library's output to match.
//  *
//  * An .xlsx is a ZIP, so this pulls the one entry it needs out of the archive directly.
//  * Everything is best-effort: any failure returns null and the caller keeps the library's
//  * order, so a malformed archive degrades to today's behaviour instead of breaking preview.
//  */
//
// /** Locate a zip entry via the central directory and return its decompressed bytes. */
// // Uint8Array is generic over its backing buffer since TS 5.7; pinning it to ArrayBuffer here
// // (which is what blob.arrayBuffer() yields) keeps subarray() assignable to BufferSource.
// async function readZipEntry(zip: Uint8Array<ArrayBuffer>, wanted: string): Promise<Uint8Array | null> {
//   const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
//   const u32 = (o: number) => dv.getUint32(o, true);
//   const u16 = (o: number) => dv.getUint16(o, true);
//
//   // End-of-central-directory record: scan back from the tail (max 64 KB of trailing comment).
//   let eocd = -1;
//   for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
//     if (u32(i) === 0x0605_4b50) {
//       eocd = i;
//       break;
//     }
//   }
//   if (eocd < 0) return null;
//
//   const count = u16(eocd + 10);
//   let p = u32(eocd + 16); // start of central directory
//
//   for (let n = 0; n < count && p + 46 <= zip.length; n++) {
//     if (u32(p) !== 0x0201_4b50) return null; // not a central-directory header
//     const method = u16(p + 10);
//     const compSize = u32(p + 20);
//     const nameLen = u16(p + 28);
//     const extraLen = u16(p + 30);
//     const commentLen = u16(p + 32);
//     const localOff = u32(p + 42);
//     const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
//
//     if (name === wanted) {
//       // Jump to the local header to find where the payload actually starts.
//       if (u32(localOff) !== 0x0403_4b50) return null;
//       const lNameLen = u16(localOff + 26);
//       const lExtraLen = u16(localOff + 28);
//       const start = localOff + 30 + lNameLen + lExtraLen;
//       const body = zip.subarray(start, start + compSize);
//       if (method === 0) return body; // stored
//       if (method !== 8) return null; // only deflate is used by xlsx writers
//       // Fed straight from a ReadableStream rather than via a Blob — a subarray's backing
//       // buffer is typed ArrayBufferLike, which isn't assignable to BlobPart under strict TS.
//       const source = new ReadableStream<BufferSource>({
//         start(c) {
//           c.enqueue(body);
//           c.close();
//         },
//       });
//       const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
//       return new Uint8Array(await new Response(stream).arrayBuffer());
//     }
//     p += 46 + nameLen + extraLen + commentLen;
//   }
//   return null;
// }
//
// const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// const decodeXml = (s: string) =>
//   s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) =>
//     e[0] === '#' ? String.fromCodePoint(Number(e[1] === 'x' ? `0x${e.slice(2)}` : e.slice(1))) : XML_ENTITIES[e] ?? _,
//   );
//
// /**
//  * Worksheet names in workbook (tab) order, or null if the order can't be determined.
//  * Hidden sheets are included — the caller only uses this for ordering, not selection.
//  */
// export async function getXlsxSheetOrder(blob: Blob): Promise<string[] | null> {
//   try {
//     const bytes = new Uint8Array(await blob.arrayBuffer());
//     const xml = await readZipEntry(bytes, 'xl/workbook.xml');
//     if (!xml) return null;
//     const text = new TextDecoder().decode(xml);
//     // Only <sheet> children of <sheets> carry the tab order.
//     const sheetsBlock = /<sheets\b[^>]*>([\s\S]*?)<\/sheets>/.exec(text)?.[1] ?? text;
//     const names = [...sheetsBlock.matchAll(/<sheet\b[^>]*?\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
//     return names.length ? names : null;
//   } catch {
//     return null;
//   }
// }
//
// /**
//  * Reorder parsed sheets to match the workbook's tab order. Sheets absent from `order`
//  * (or when order is null) keep their original relative position at the end, so nothing
//  * is ever dropped.
//  */
// export function sortSheetsByWorkbookOrder<T extends { sheet: string }>(sheets: T[], order: string[] | null): T[] {
//   if (!order?.length) return sheets;
//   const rank = new Map(order.map((n, i) => [n, i]));
//   return [...sheets].sort((a, b) => (rank.get(a.sheet) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.sheet) ?? Number.MAX_SAFE_INTEGER));
// }

export {};
