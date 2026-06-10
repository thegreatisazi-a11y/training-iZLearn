import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, apiError } from '@/lib/axios';
import { Button } from '../ui/button';
import { svc } from '@/services';

/**
 * In-app file viewer. Fetches the protected material as a blob (so the JWT auth
 * header is sent) and renders it inline: PDFs/images in-page, video with a player,
 * and a download fallback for types the browser cannot preview. Used by the timed
 * training-material step (Phase 6) and the materials "View" action (Phase 7.1).
 */
export function InlineFileViewer({
  materialId,
  fileName = 'material',
  fileType,
  heightClass = 'h-[60vh]',
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

  if (isPdf) return <iframe title={fileName} src={url} className={`w-full rounded border border-slate-200 ${heightClass}`} />;
  if (isImage) return <img alt={fileName} src={url} className={`mx-auto max-w-full rounded border border-slate-200 ${heightClass} object-contain`} />;
  if (isVideo) return <video src={url} controls className={`w-full rounded border border-slate-200 ${heightClass}`} />;

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center">
      <p className="mb-3 text-sm text-slate-600">This file type ({ext || 'unknown'}) cannot be previewed in the browser.</p>
      <Button variant="outline" onClick={() => svc.materials.download(materialId, fileName)}>
        <Download className="h-4 w-4" /> Download to view
      </Button>
    </div>
  );
}
