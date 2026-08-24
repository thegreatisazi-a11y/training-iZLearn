// ============================================================================
// DISABLED — reading-gate / xlsx work, commented out on request (2026-08-06).
//
// Nothing imports this file, so it is inert. To re-enable, uncomment the whole
// file and restore the call sites (see the saved patch noted in the handover).
// ============================================================================
// import type { XlsxRenderResult, XlsxWorkerResponse } from './xlsxWorker';
//
// /** Raised when a workbook exceeds the inline-render limits — shown to the user as guidance,
//  *  not as a failure, so the caller can distinguish it from a genuine render error. */
// export class XlsxTooLargeError extends Error {
//   constructor(message: string) {
//     super(message);
//     this.name = 'XlsxTooLargeError';
//   }
// }
//
// /**
//  * Render an .xlsx workbook to HTML on a worker thread, so parsing never blocks the UI.
//  *
//  * The worker is spawned per call and always terminated — including on abort, so navigating
//  * away from a slow workbook stops the work instead of leaving it burning a core.
//  */
// export function renderXlsxInWorker(blob: Blob, signal?: AbortSignal): Promise<XlsxRenderResult> {
//   return new Promise<XlsxRenderResult>((resolve, reject) => {
//     if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
//
//     // Vite rewrites this URL to the emitted worker chunk at build time.
//     const worker = new Worker(new URL('./xlsxWorker.ts', import.meta.url), { type: 'module' });
//     const finish = (fn: () => void) => {
//       signal?.removeEventListener('abort', onAbort);
//       worker.terminate();
//       fn();
//     };
//     function onAbort() {
//       finish(() => reject(new DOMException('Aborted', 'AbortError')));
//     }
//     signal?.addEventListener('abort', onAbort, { once: true });
//
//     worker.onmessage = (e: MessageEvent<XlsxWorkerResponse>) => {
//       const res = e.data;
//       if (res.ok) finish(() => resolve({ html: res.html, sheetCount: res.sheetCount }));
//       else if ('tooLarge' in res) finish(() => reject(new XlsxTooLargeError(res.tooLarge)));
//       else finish(() => reject(new Error(res.error)));
//     };
//     worker.onerror = (ev) => finish(() => reject(new Error(ev.message || 'Workbook renderer failed.')));
//
//     // A Blob is structured-cloneable and only a reference to its bytes, so this does not copy
//     // the file into the worker.
//     worker.postMessage(blob);
//   });
// }

export {};
