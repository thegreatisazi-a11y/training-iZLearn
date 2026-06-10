import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { InlineFileViewer } from '@/components/common/InlineFileViewer';
import { Button } from '@/components/ui/button';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';

/** Full-page, full-width in-app material viewer (Step 6 / UR full-window reading). */
export default function MaterialViewerPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const name = params.get('name') || 'material';
  const type = params.get('type') || undefined;

  return (
    <div className="flex h-[calc(100vh-2rem)] flex-col">
      <div className="mb-3 flex items-center justify-between">
        <button className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="truncate px-3 font-medium text-slate-800">{name}</div>
        <Button variant="outline" size="sm" onClick={() => svc.materials.download(id, name).catch((e) => toast.error(apiError(e)))}>
          <Download className="h-4 w-4" /> Download
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <InlineFileViewer materialId={id} fileName={name} fileType={type} heightClass="h-full" />
      </div>
    </div>
  );
}
