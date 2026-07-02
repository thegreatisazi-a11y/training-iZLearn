import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode } from 'react';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, MoveHorizontal, Maximize2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import DOMPurify from 'dompurify';
import { api, apiError } from '@/lib/axios';

// pdfjs runs its parser/renderer off the main thread; point it at the bundled worker.
// (new URL(..., import.meta.url) is rewritten by Vite to an emitted asset URL.)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

/**
 * Extension → render strategy (all locked, view-only):
 *   - docx / xlsx → rendered IN-BROWSER (mammoth / read-excel-file). No server needed.
 *   - ppt / pptx / doc / xls → server-converted to PDF (LibreOffice). If conversion is
 *     unavailable, a graceful "download to view" panel is shown instead of an error, and
 *     the file auto-upgrades to an inline PDF preview whenever LibreOffice is available.
 *   - images / video / audio / text → native locked players.
 */
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const VIDEO_EXTS = ['mp4', 'webm', 'ogg'];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'oga', 'opus'];
const TEXT_EXTS = ['txt', 'csv', 'log', 'md', 'json'];
/** Rendered via the server LibreOffice→PDF endpoint (presentations + legacy binaries). */
const SERVER_PDF_EXTS = ['ppt', 'pptx', 'doc', 'xls'];

/**
 * In-app LOCKED file viewer (CR-32 + CR-MAT1). Fetches the protected material as a
 * blob (so the JWT auth header is sent) and renders it inline as a controlled,
 * view-only surface for ALL roles — without any download, print, open-in-Drive, save,
 * or text-selection affordance. Supported types:
 *   - PDF and Office docs (doc/docx/ppt/pptx/xls/xlsx) → pdf.js. Office files are
 *     converted to PDF server-side (cached) and shown in the SAME locked surface.
 *   - images, video, audio → native locked players.
 *   - plain text/csv → read-only text.
 *
 * PDFs are rendered page-by-page to <canvas> via pdf.js (no text layer → nothing is
 * selectable/copyable and there is no native toolbar). The controls bar offers zoom
 * in/out, fit-width, fit-page and page next/prev, and the page indicator stays in sync
 * however the page changes — buttons, scrolling, or the keyboard arrow keys.
 */
export function InlineFileViewer({
  materialId,
  fileName = 'material',
  fileType,
  heightClass = 'h-[80vh]',
}: {
  materialId: string;
  fileName?: string;
  fileType?: string;
  heightClass?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Image zoom controls (PDF has its own controls inside PdfDocViewer).
  const [zoomMode, setZoomMode] = useState<'fit-width' | 'fit-page' | 'custom'>('fit-width');
  const [zoomPct, setZoomPct] = useState(100);

  const ext = (fileType ?? fileName.split('.').pop() ?? '').toLowerCase();
  const isImage = IMAGE_EXTS.includes(ext);
  const isVideo = VIDEO_EXTS.includes(ext);
  const isAudio = AUDIO_EXTS.includes(ext);
  const isText = TEXT_EXTS.includes(ext);
  const isDocx = ext === 'docx';
  const isXlsx = ext === 'xlsx';
  const isPdf = ext === 'pdf';
  const usesServerPdf = SERVER_PDF_EXTS.includes(ext);
  // PDFs and server-converted Office docs both render through the locked pdf.js viewer.
  const rendersAsPdf = isPdf || usesServerPdf;

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError('');
    setBlob(null);
    // Presentations/legacy binaries fetch the server-converted PDF; everything else
    // (incl. docx/xlsx, which are converted in-browser) streams the raw file.
    const endpoint = usesServerPdf ? `/materials/${materialId}/view-pdf` : `/materials/${materialId}/download`;
    api
      .get(endpoint, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        const b = res.data as Blob;
        setBlob(b);
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch((e) => !cancelled && setError(apiError(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [materialId, usesServerPdf]);

  if (loading)
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-500">
        {usesServerPdf ? 'Preparing preview… (converting document)' : 'Loading preview…'}
      </div>
    );
  // A failed server conversion (e.g. LibreOffice unavailable) or any fetch error shows a
  // friendly download-to-view panel rather than a raw error.
  if (error) return <PreviewUnavailable message={error} heightClass={heightClass} />;
  if (!url) return null;

  const lockClass = 'select-none w-full';
  const lockStyle = { userSelect: 'none' as const };
  const onCtx = (e: MouseEvent) => e.preventDefault();

  const zoomIn = () => { setZoomMode('custom'); setZoomPct((p) => Math.min(400, (zoomMode === 'custom' ? p : 100) + 25)); };
  const zoomOut = () => { setZoomMode('custom'); setZoomPct((p) => Math.max(40, (zoomMode === 'custom' ? p : 100) - 25)); };

  if (rendersAsPdf) {
    return <PdfDocViewer url={url} heightClass={heightClass} lockClass={lockClass} lockStyle={lockStyle} onCtx={onCtx} />;
  }

  if (isDocx || isXlsx) {
    return <OfficeHtmlViewer blob={blob} kind={isDocx ? 'docx' : 'xlsx'} heightClass={heightClass} lockClass={lockClass} lockStyle={lockStyle} onCtx={onCtx} />;
  }

  if (isImage) {
    return (
      <div className={`flex flex-col ${heightClass} ${lockClass} rounded border border-slate-200`} style={lockStyle} onContextMenu={onCtx}>
        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
          <button type="button" title="Zoom out" onClick={zoomOut} className="inline-flex h-7 items-center rounded px-2 text-slate-600 hover:bg-slate-100"><ZoomOut className="h-4 w-4" /></button>
          <span className="w-12 text-center text-xs tabular-nums text-slate-600">{zoomMode === 'custom' ? `${zoomPct}%` : '100%'}</span>
          <button type="button" title="Zoom in" onClick={zoomIn} className="inline-flex h-7 items-center rounded px-2 text-slate-600 hover:bg-slate-100"><ZoomIn className="h-4 w-4" /></button>
          <button type="button" title="Reset" onClick={() => { setZoomMode('fit-width'); setZoomPct(100); }} className="ml-1 inline-flex h-7 items-center rounded px-2 text-xs text-slate-600 hover:bg-slate-100">Reset</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 text-center">
          <img
            alt={fileName}
            src={url}
            draggable={false}
            style={zoomMode === 'custom' ? { width: `${zoomPct}%` } : undefined}
            className={zoomMode === 'custom' ? 'mx-auto max-w-none' : 'mx-auto h-full max-w-full object-contain'}
          />
        </div>
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className={`${lockClass} ${heightClass}`} style={lockStyle} onContextMenu={onCtx}>
        <video
          src={url}
          controls
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          onContextMenu={onCtx}
          className="h-full w-full rounded border border-slate-200"
        />
      </div>
    );
  }

  if (isAudio) {
    return (
      <div className={`flex ${heightClass} ${lockClass} items-center justify-center rounded border border-slate-200 bg-slate-50`} style={lockStyle} onContextMenu={onCtx}>
        <audio src={url} controls controlsList="nodownload noplaybackrate" onContextMenu={onCtx} className="w-4/5 max-w-xl" />
      </div>
    );
  }

  if (isText) {
    return <TextFileViewer blob={blob} heightClass={heightClass} lockClass={lockClass} lockStyle={lockStyle} onCtx={onCtx} />;
  }

  return <PreviewUnavailable heightClass={heightClass} />;
}

/**
 * Friendly panel shown when a file can't be previewed inline (unsupported type, or a
 * server conversion that isn't available). Keeps the locked surface — it never exposes
 * the file; downloading (where permitted) is done from the surrounding page's controls.
 */
function PreviewUnavailable({ message, heightClass }: { message?: string; heightClass: string }) {
  return (
    <div className={`flex ${heightClass} items-center justify-center rounded border border-slate-200 bg-slate-50 p-6`}>
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-slate-700">Inline preview isn’t available for this file.</p>
        <p className="mt-1 text-xs text-slate-500">{message || 'Use the Download option (where permitted) to open it.'}</p>
      </div>
    </div>
  );
}

/** Convert a sheet's rows to a simple bordered HTML table. */
function rowsToTableHtml(rows: unknown[][]): string {
  if (!rows.length) return '';
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const [head, ...body] = rows;
  const headHtml = `<tr>${head.map((c) => `<th style="border:1px solid #cbd5e1;padding:6px;background:#f1f5f9;text-align:left">${esc(c)}</th>`).join('')}</tr>`;
  const bodyHtml = body.map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #cbd5e1;padding:6px">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;width:100%;font-size:12px">${headHtml}${bodyHtml}</table>`;
}

/**
 * Locked in-browser viewer for Word (.docx → mammoth) and Excel (.xlsx → read-excel-file).
 * Conversion runs client-side (no server/LibreOffice), the output HTML is sanitised with
 * DOMPurify, and the surface is view-only (no selection/copy). On failure it falls back to
 * the download-to-view panel.
 */
function OfficeHtmlViewer({
  blob,
  kind,
  heightClass,
  lockClass,
  lockStyle,
  onCtx,
}: {
  blob: Blob | null;
  kind: 'docx' | 'xlsx';
  heightClass: string;
  lockClass: string;
  lockStyle: { userSelect: 'none' };
  onCtx: (e: MouseEvent) => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!blob) return;
    (async () => {
      try {
        let out = '';
        if (kind === 'docx') {
          const mammoth = await import('mammoth');
          const arrayBuffer = await blob.arrayBuffer();
          out = (await mammoth.convertToHtml({ arrayBuffer })).value;
        } else {
          const readXlsxFile = (await import('read-excel-file/browser')).default;
          const rows = (await readXlsxFile(blob)) as unknown[][];
          out = rowsToTableHtml(rows);
        }
        if (!cancelled) setHtml(out || '<p>(Empty document)</p>');
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, kind]);

  if (failed) return <PreviewUnavailable heightClass={heightClass} message="This document couldn’t be rendered. Download it to view." />;
  if (html === null) return <div className="flex h-40 items-center justify-center text-sm text-slate-500">Rendering preview…</div>;
  return (
    <div className={`${heightClass} ${lockClass} overflow-auto rounded border border-slate-200 bg-white`} style={lockStyle} onContextMenu={onCtx}>
      <div className="prose prose-sm max-w-none p-4 text-slate-800" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
    </div>
  );
}

/** Read-only text/CSV surface — reads the fetched blob and renders it locked (no copy). */
function TextFileViewer({
  blob,
  heightClass,
  lockClass,
  lockStyle,
  onCtx,
}: {
  blob: Blob | null;
  heightClass: string;
  lockClass: string;
  lockStyle: { userSelect: 'none' };
  onCtx: (e: MouseEvent) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!blob) return;
    blob.text().then((t) => !cancelled && setText(t)).catch(() => !cancelled && setText('Unable to read file.'));
    return () => {
      cancelled = true;
    };
  }, [blob]);
  return (
    <div className={`${heightClass} ${lockClass} overflow-auto rounded border border-slate-200 bg-white`} style={lockStyle} onContextMenu={onCtx}>
      <pre className="whitespace-pre-wrap break-words p-4 text-xs text-slate-700">{text ?? 'Loading…'}</pre>
    </div>
  );
}

type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

/**
 * Locked PDF surface: every page is rendered to a <canvas> (no text/annotation layer,
 * so nothing is selectable, copyable or downloadable). The "Page X / N" indicator is
 * kept in sync no matter how the page changes — toolbar buttons, scrolling, or the
 * keyboard arrow keys (which the iframe-based native viewer could not report back).
 */
function PdfDocViewer({
  url,
  heightClass,
  lockClass,
  lockStyle,
  onCtx,
}: {
  url: string;
  heightClass: string;
  lockClass: string;
  lockStyle: { userSelect: 'none' };
  onCtx: (e: MouseEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null); // page 1 dims at scale 1
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [page, setPage] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width');
  const [zoomPct, setZoomPct] = useState(100);
  const [error, setError] = useState('');

  // Load the document (and read page 1's intrinsic size to drive fit-width/fit-page).
  useEffect(() => {
    let cancelled = false;
    const task = pdfjsLib.getDocument({ url });
    setDoc(null);
    setNumPages(0);
    setPage(1);
    setError('');
    task.promise
      .then(async (pdf) => {
        if (cancelled) return;
        setDoc(pdf);
        setNumPages(pdf.numPages);
        pageElsRef.current = new Array(pdf.numPages).fill(null);
        const p1 = await pdf.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        if (!cancelled) setBase({ w: vp.width, h: vp.height });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load PDF.'));
    return () => {
      cancelled = true;
      task.destroy().catch(() => undefined);
    };
  }, [url]);

  // Track the scroll viewport size to compute fit scales.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (!base) return 1;
    const padW = 24; // matches the px-3 padding around the page column
    if (zoomMode === 'custom') return zoomPct / 100;
    const fitW = box.w > 0 ? (box.w - padW) / base.w : 1;
    if (zoomMode === 'fit-width') return Math.max(0.1, fitW);
    const fitH = box.h > 0 ? (box.h - padW) / base.h : 1;
    return Math.max(0.1, Math.min(fitW, fitH)); // fit-page
  }, [base, box, zoomMode, zoomPct]);

  // Scrolling (wheel/trackpad/drag) → update the page indicator to the page nearest the top.
  const syncPageFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const marker = el.scrollTop + el.clientHeight * 0.35;
    let cur = 1;
    const els = pageElsRef.current;
    for (let i = 0; i < els.length; i++) {
      const p = els[i];
      if (p && p.offsetTop <= marker) cur = i + 1;
      else if (p) break;
    }
    setPage((prev) => (prev === cur ? prev : cur));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncPageFromScroll();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [syncPageFromScroll, numPages]);

  const goToPage = useCallback(
    (n: number) => {
      const target = Math.min(Math.max(1, n), Math.max(1, numPages));
      const el = scrollRef.current;
      const pageEl = pageElsRef.current[target - 1];
      if (el && pageEl) el.scrollTo({ top: pageEl.offsetTop, behavior: 'auto' });
      setPage(target);
    },
    [numPages],
  );

  // Keyboard arrows / page-up-down / home-end navigate pages and keep the indicator in sync.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        goToPage(page + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        goToPage(page - 1);
        break;
      case 'Home':
        e.preventDefault();
        goToPage(1);
        break;
      case 'End':
        e.preventDefault();
        goToPage(numPages);
        break;
      default:
        break;
    }
  };

  const zoomIn = () => {
    setZoomMode('custom');
    setZoomPct((p) => Math.min(400, (zoomMode === 'custom' ? p : Math.round(scale * 100)) + 25));
  };
  const zoomOut = () => {
    setZoomMode('custom');
    setZoomPct((p) => Math.max(40, (zoomMode === 'custom' ? p : Math.round(scale * 100)) - 25));
  };

  const ToolbarBtn = ({ onClick, title, children, active, disabled }: { onClick: () => void; title: string; children: ReactNode; active?: boolean; disabled?: boolean }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium disabled:opacity-40 ${active ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );

  return (
    <div className={`flex flex-col ${heightClass} ${lockClass} rounded border border-slate-200`} style={lockStyle} onContextMenu={onCtx}>
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
        <ToolbarBtn onClick={zoomOut} title="Zoom out"><ZoomOut className="h-4 w-4" /></ToolbarBtn>
        <span className="w-12 text-center text-xs tabular-nums text-slate-600">{Math.round(scale * 100)}%</span>
        <ToolbarBtn onClick={zoomIn} title="Zoom in"><ZoomIn className="h-4 w-4" /></ToolbarBtn>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <ToolbarBtn onClick={() => setZoomMode('fit-width')} title="Fit width" active={zoomMode === 'fit-width'}><MoveHorizontal className="h-4 w-4" /> Width</ToolbarBtn>
        <ToolbarBtn onClick={() => setZoomMode('fit-page')} title="Fit page" active={zoomMode === 'fit-page'}><Maximize2 className="h-4 w-4" /> Page</ToolbarBtn>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <ToolbarBtn onClick={() => goToPage(page - 1)} title="Previous page" disabled={page <= 1}><ChevronLeft className="h-4 w-4" /></ToolbarBtn>
        <span className="text-xs tabular-nums text-slate-600">Page {page}{numPages ? ` / ${numPages}` : ''}</span>
        <ToolbarBtn onClick={() => goToPage(page + 1)} title="Next page" disabled={numPages > 0 && page >= numPages}><ChevronRight className="h-4 w-4" /></ToolbarBtn>
      </div>
      <div ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-auto bg-slate-100 outline-none">
        {error ? (
          <div className="p-4 text-sm text-red-600">{error}</div>
        ) : !doc ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading PDF…</div>
        ) : (
          <div className="relative flex flex-col items-center gap-3 px-3 py-3">
            {Array.from({ length: numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                doc={doc}
                pageNumber={i + 1}
                scale={scale}
                registerEl={(el) => {
                  pageElsRef.current[i] = el;
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders a single PDF page to a canvas at the given scale (re-renders on scale change). */
function PdfPage({
  doc,
  pageNumber,
  scale,
  registerEl,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  registerEl: (el: HTMLDivElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    registerEl(wrapRef.current);
    return () => registerEl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;
    doc.getPage(pageNumber).then((p) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      setSize({ w: Math.floor(viewport.width), h: Math.floor(viewport.height) });
      renderTask = p.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTask.promise.catch(() => undefined); // cancellation throws — ignore
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale]);

  return (
    <div
      ref={wrapRef}
      className="bg-white shadow-sm"
      style={size ? { width: size.w, height: size.h } : { width: '100%', height: 400 }}
    >
      <canvas ref={canvasRef} draggable={false} style={size ? { width: size.w, height: size.h } : undefined} />
    </div>
  );
}
