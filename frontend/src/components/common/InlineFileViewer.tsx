import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { api, apiError } from '@/lib/axios';

/**
 * In-app LOCKED file viewer (CR-32). Fetches the protected material as a blob (so
 * the JWT auth header is sent) and renders it inline as a controlled, view-only
 * surface for ALL roles: PDFs/images/video are shown without any download, print,
 * open-in-Drive, save, or text-selection affordance. Unsupported types show an
 * informational message rather than a download fallback. Used by the timed
 * training-material step (Phase 6) and the materials "View" action (Phase 7.1).
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

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError('');
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

  // Locked container: blocks the context menu (Save/Print/etc.) and disables
  // text highlighting/selection. #8: the wrapper carries the height so media using
  // `h-full` (full-page viewer) fills its parent instead of collapsing to zero.
  const lockProps = {
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    className: `select-none w-full ${heightClass}`,
    style: { userSelect: 'none' as const },
  };

  if (isPdf) {
    // Append viewer params so the native PDF toolbar (download/print/open-in-Drive) is hidden.
    return (
      <div {...lockProps}>
        <iframe
          title={fileName}
          src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          className="h-full w-full rounded border border-slate-200"
        />
      </div>
    );
  }

  if (isImage) {
    return (
      <div {...lockProps}>
        <img
          alt={fileName}
          src={url}
          draggable={false}
          className="mx-auto h-full max-w-full rounded border border-slate-200 object-contain"
        />
      </div>
    );
  }

  if (isVideo) {
    return (
      <div {...lockProps}>
        <video
          src={url}
          controls
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          className="h-full w-full rounded border border-slate-200"
        />
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center">
      <p className="text-sm text-slate-600">
        This file can only be viewed in the controlled viewer and cannot be downloaded.
      </p>
    </div>
  );
}
