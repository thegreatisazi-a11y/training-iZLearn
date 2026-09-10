/**
 * Client side of server-rendered documents.
 *
 * Every "Print" and "Export PDF" button in the app goes through here. The browser sends only
 * a document type plus identifiers/filters; the server re-reads the record and renders the
 * PDF (see backend/src/utils/printDocument.ts for why).
 *
 * Printing a rendered PDF is also what removes the browser's own print furniture - the date,
 * the title, `about:blank` and the page counter Chrome stamped on the old HTML printouts. It
 * draws those only for pages it lays out itself, and no CSS could suppress them.
 */
import { api } from '@/lib/axios';
import { printPdfBlob } from '@/lib/print';
import { toast } from '@/store/uiStore';

/** Document types the server can render. Mirrors PRINT_DOCUMENTS on the backend. */
export type PrintDocType =
  | 'users'
  | 'my-team'
  | 'tni'
  | 'courses'
  | 'course'
  | 'roles'
  | 'role-permissions'
  | 'bundles'
  | 'bundle'
  | 'job-description'
  | 'cv'
  | 'assessment-result';

type Params = Record<string, string | number | boolean | null | undefined>;

/** Drop empty values so the server sees only filters that were actually applied. */
function query(params?: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  }
  return out;
}

/** An error body arrives as a Blob when responseType is 'blob' — read the JSON message out. */
async function messageFrom(e: unknown, fallback: string): Promise<string> {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.error?.message) return parsed.error.message as string;
    } catch {
      /* not JSON — fall through to the generic message */
    }
  }
  const msg = (e as { message?: string })?.message;
  return msg || fallback;
}

async function fetchDocument(docType: PrintDocType, params?: Params, download = false): Promise<Blob> {
  const r = await api.get(`/print/${docType}`, {
    params: { ...query(params), ...(download ? { download: 'true' } : {}) },
    responseType: 'blob',
  });
  return r.data as Blob;
}

/**
 * Render the document and open the browser's print dialog for it.
 *
 * Rendering happens over the network, so the caller should show a pending state; the pop-up
 * is opened only once the PDF has arrived. A blocked pop-up is reported rather than failing
 * silently, because nothing visible happens otherwise.
 */
export async function printDocument(docType: PrintDocType, params?: Params): Promise<void> {
  try {
    const blob = await fetchDocument(docType, params);
    if (!printPdfBlob(blob)) toast.error('Please allow pop-ups to print this document.');
  } catch (e) {
    toast.error(await messageFrom(e, 'Could not prepare the document for printing.'));
  }
}

/** Download the same document as a PDF file. */
export async function downloadDocumentPdf(docType: PrintDocType, params?: Params): Promise<void> {
  try {
    const blob = await fetchDocument(docType, params, true);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // The server sets Content-Disposition with the standard izlearn_<subject>_<stamp>.pdf
    // name; this is only the fallback for browsers that ignore it on a blob: URL.
    a.download = `${docType}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    toast.error(await messageFrom(e, 'Could not download the document.'));
  }
}
