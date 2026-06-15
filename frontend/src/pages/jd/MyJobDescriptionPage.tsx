import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Printer } from 'lucide-react';
import DOMPurify from 'dompurify';
import { printHtml, escapeHtml } from '@/lib/print';
import { useAuthStore } from '@/store/authStore';
import { JD_ACK_SENTENCE } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/spinner';
import { ESignatureModal } from '@/components/common/ESignatureModal';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { formatDateTime } from '@/lib/format';

interface MyJD {
  id: string;
  title: string;
  content: string;
  status: string;
  departmentId: string;
  functionalRoleId?: string | null;
  assignedBy?: string | null;
  assignedAt?: string | null;
  acknowledgedAt?: string | null;
  acknowledgementText?: string | null;
}

export default function MyJobDescriptionPage() {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const [signOpen, setSignOpen] = useState(false);
  const userName = useAuthStore((s) => s.user?.fullName);

  const printMyJD = (j: MyJD) => {
    printHtml(
      j.title,
      `<h1>${escapeHtml(j.title)}</h1><div class="sub">Status: ${escapeHtml(j.status)}${j.acknowledgedAt ? ` · Acknowledged ${escapeHtml(formatDateTime(j.acknowledgedAt))}` : ''}</div><div>${DOMPurify.sanitize(j.content)}</div>`,
      { printedBy: userName },
    );
  };

  const { data, isLoading } = useQuery({ queryKey: ['my-jd'], queryFn: () => svc.jds.mine() as unknown as Promise<MyJD | null> });

  const ackMut = useMutation({
    mutationFn: (sig: unknown) => svc.jds.acknowledge((data as MyJD).id, { acknowledgementText: typed.trim(), signature: sig }),
    onSuccess: () => {
      toast.success('Job Description acknowledged.');
      qc.invalidateQueries({ queryKey: ['my-jd'] });
      setTyped('');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading) return <PageLoader />;
  const jd = data as MyJD | null;

  if (!jd) {
    return (
      <div>
        <PageHeader title="My Job Description" />
        <Card>
          <CardContent>
            <p className="text-sm text-slate-600">
              No Job Description has been assigned to you yet. Your supervisor assigns a JD when they set your Functional Role.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const acknowledged = !!jd.acknowledgedAt;
  const exactMatch = typed.trim() === JD_ACK_SENTENCE;

  return (
    <div>
      <PageHeader
        title="My Job Description"
        description={jd.title}
        actions={
          <Button variant="outline" onClick={() => printMyJD(jd)}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" />
            <div>
              <div className="font-semibold text-slate-800">{jd.title}</div>
              <div className="text-xs text-slate-500">
                {jd.assignedAt ? `Assigned ${formatDateTime(jd.assignedAt)}` : 'Assigned'} · Status: {jd.status}
              </div>
            </div>
          </div>
          {acknowledged ? (
            <Badge tone="COMPLETED">Acknowledged</Badge>
          ) : (
            <Badge tone="PENDING">Pending acknowledgement</Badge>
          )}
        </CardContent>
      </Card>

      {!acknowledged && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Please read your Job Description below and acknowledge it. You must type the acknowledgement sentence and sign with your signature password.
        </div>
      )}

      {/* Locked, read-only JD content */}
      <Card className="mb-4">
        <CardContent>
          <div
            className="prose-sm select-none text-sm text-slate-700"
            style={{ userSelect: 'none' }}
            onContextMenu={(e) => e.preventDefault()}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(jd.content) }}
          />
        </CardContent>
      </Card>

      {acknowledged ? (
        <Card>
          <CardContent className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle2 className="h-5 w-5" />
            Acknowledged on {formatDateTime(jd.acknowledgedAt as string)} — "{jd.acknowledgementText}"
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <Field label={`Type exactly: "${JD_ACK_SENTENCE}"`} required>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={JD_ACK_SENTENCE} />
            </Field>
            <Button disabled={!exactMatch} onClick={() => setSignOpen(true)}>
              Acknowledge &amp; Sign
            </Button>
          </CardContent>
        </Card>
      )}

      <ESignatureModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title="Sign to Acknowledge Job Description"
        defaultMeaning="Acknowledged"
        onConfirm={async (sig) => {
          await ackMut.mutateAsync(sig);
          setSignOpen(false);
        }}
      />
    </div>
  );
}
