import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, MoveHorizontal, Maximize2 } from 'lucide-react';
import { api, apiError } from '@/lib/axios';

/**
 * In-app LOCKED file viewer (CR-32 + CR-MAT1). Fetches the protected material as a
 * blob (so the JWT auth header is sent) and renders it inline as a controlled,
 * view-only surface for ALL roles: PDFs/images/video are shown without any
 * download, print, open-in-Drive, save, or text-selection affordance.
 *
 * PDFs get a controls bar — zoom in/out, fit-width, fit-page, and page next/prev —
 * driven by the PDF URL fragment (zoom/page/view), so no external PDF.js dependency
 * is needed and the native toolbar stays hidden.
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // PDF view controls.
  const [zoomMode, setZoomMode] = useState<'fit-width' | 'fit-page' | 'custom'>('fit-width');
  const [zoomPct, setZoomPct] = useState(100);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError('');
    setPage(1);
    api
      .get(`/materials/${materialId}/download`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data as Blob);
        setUrl(objectUrl);
      })
      .catch((e) => !cancelled && setError(apiError(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [materialId]);

  const ext = (fileType ?? fileName.split('.').pop() ?? '').toLowerCase();
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
  const isVideo = ['mp4', 'webm', 'ogg'].includes(ext);

  if (loading) return <div className="flex h-40 items-center justify-center text-sm text-slate-500">Loading preview…</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!url) return null;

  const lockClass = 'select-none w-full';
  const lockStyle = { userSelect: 'none' as const };
  const onCtx = (e: MouseEvent) => e.preventDefault();

  const zoomIn = () => { setZoomMode('custom'); setZoomPct((p) => Math.min(400, (zoomMode === 'custom' ? p : 100) + 25)); };
  const zoomOut = () => { setZoomMode('custom'); setZoomPct((p) => Math.max(40, (zoomMode === 'custom' ? p : 100) - 25)); };

  if (isPdf) {
    const frag = zoomMode === 'fit-width' ? 'view=FitH' : zoomMode === 'fit-page' ? 'view=Fit' : `zoom=${zoomPct}`;
    const src = `${url}#toolbar=0&navpanes=0&scrollbar=0&page=${page}&${frag}`;
    const ToolbarBtn = ({ onClick, title, children, active }: { onClick: () => void; title: string; children: ReactNode; active?: boolean }) => (
      <button
        type="button"
        title={title}
        onClick={onClick}
        className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium ${active ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        {children}
      </button>
    );
    return (
      <div className={`flex flex-col ${heightClass} ${lockClass} rounded border border-slate-200`} style={lockStyle} onContextMenu={onCtx}>
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
          <ToolbarBtn onClick={zoomOut} title="Zoom out"><ZoomOut className="h-4 w-4" /></ToolbarBtn>
          <span className="w-12 text-center text-xs tabular-nums text-slate-600">{zoomMode === 'custom' ? `${zoomPct}%` : 'Fit'}</span>
          <ToolbarBtn onClick={zoomIn} title="Zoom in"><ZoomIn className="h-4 w-4" /></ToolbarBtn>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <ToolbarBtn onClick={() => setZoomMode('fit-width')} title="Fit width" active={zoomMode === 'fit-width'}><MoveHorizontal className="h-4 w-4" /> Width</ToolbarBtn>
          <ToolbarBtn onClick={() => setZoomMode('fit-page')} title="Fit page" active={zoomMode === 'fit-page'}><Maximize2 className="h-4 w-4" /> Page</ToolbarBtn>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <ToolbarBtn onClick={() => setPage((p) => Math.max(1, p - 1))} title="Previous page"><ChevronLeft className="h-4 w-4" /></ToolbarBtn>
          <span className="text-xs text-slate-600">Page {page}</span>
          <ToolbarBtn onClick={() => setPage((p) => p + 1)} title="Next page"><ChevronRight className="h-4 w-4" /></ToolbarBtn>
        </div>
        <iframe key={src} title={fileName} src={src} className="min-h-0 w-full flex-1" />
      </div>
    );
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

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center">
      <p className="text-sm text-slate-600">This file can only be viewed in the controlled viewer and cannot be downloaded.</p>
    </div>
  );
}
