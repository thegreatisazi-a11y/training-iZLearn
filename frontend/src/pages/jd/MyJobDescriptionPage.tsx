import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Printer, ChevronLeft } from 'lucide-react';
import DOMPurify from 'dompurify';
import { printHtml, escapeHtml } from '@/lib/print';
import { useAuthStore } from '@/store/authStore';
import { JD_ACK_SENTENCE } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
  version: number;
  status: string;
  departmentId: string;
  functionalRoleId?: string | null;
  assignedBy?: string | null;
  assignedByName?: string | null;
  assignedAt?: string | null;
  acknowledgedAt?: string | null;
  acknowledgementText?: string | null;
  acknowledgementComment?: string | null;
}

type Decision = 'APPROVE' | 'REJECT';

export default function MyJobDescriptionPage() {
  const qc = useQueryClient();
  // Acknowledge form: tick the statement (Approve) or pick Reject + a comment to send back.
  const [accepted, setAccepted] = useState(false);
  const [decision, setDecision] = useState<Decision>('APPROVE');
  const [comment, setComment] = useState('');
  const [signOpen, setSignOpen] = useState(false);
  // B1: when the user holds more than one JD, this is the one they opened from the list.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const userName = useAuthStore((s) => s.user?.fullName);

  const printMyJD = (j: MyJD) => {
    printHtml(
      j.title,
      `<h1>${escapeHtml(j.title)}</h1><div class="sub">Status: ${escapeHtml(j.status)} · Version v${j.version}${j.acknowledgedAt ? ` · Acknowledged ${escapeHtml(formatDateTime(j.acknowledgedAt))}` : ''}</div><div>${DOMPurify.sanitize(j.content)}</div>`,
      { printedBy: userName },
    );
  };

  const { data, isLoading } = useQuery({ queryKey: ['my-jd-list'], queryFn: () => svc.jds.mineList() as unknown as Promise<MyJD[]> });
  const jds = (data ?? []) as MyJD[];
  // Auto-select when there is exactly one JD; otherwise the list is shown first.
  const selected = jds.find((j) => j.id === selectedId) ?? (jds.length === 1 ? jds[0] : null);

  const ackMut = useMutation({
    mutationFn: (sig: unknown) =>
      svc.jds.acknowledge((selected as MyJD).id, {
        decision,
        acknowledgementText: decision === 'APPROVE' ? JD_ACK_SENTENCE : undefined,
        comment: comment.trim() || undefined,
        signature: sig,
      }),
    onSuccess: () => {
      toast.success(decision === 'APPROVE' ? 'Job Description acknowledged.' : 'Job Description returned to the assigner.');
      qc.invalidateQueries({ queryKey: ['my-jd-list'] });
      setAccepted(false);
      setComment('');
      setDecision('APPROVE');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading) return <PageLoader />;

  if (!jds.length) {
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

  // B1: list view when there is more than one JD and none is currently open.
  if (!selected) {
    const columns: Column<MyJD>[] = [
      {
        key: 'title',
        header: 'Job Description Name',
        render: (j) => (
          <button className="text-left font-medium text-primary hover:underline" onClick={() => setSelectedId(j.id)}>
            {j.title}
          </button>
        ),
      },
      { key: 'assignedByName', header: 'Assigned by', render: (j) => j.assignedByName ?? '—' },
      // Show the version + status so a reviewed/updated JD is distinguishable from the
      // original copy of the same JD (a person can hold several versions at once).
      { key: 'version', header: 'Version', render: (j) => <span className="font-medium tabular-nums">v{j.version}</span> },
      { key: 'status', header: 'Status', render: (j) => <Badge tone={j.status}>{j.status.replace(/_/g, ' ')}</Badge> },
      {
        key: 'acknowledgedAt',
        header: 'Acknowledged',
        render: (j) => (j.acknowledgedAt ? <Badge tone="COMPLETED">Yes</Badge> : <Badge tone="PENDING">Pending</Badge>),
      },
      {
        key: 'actions',
        header: '',
        className: 'text-right',
        render: (j) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelectedId(j.id)}>
              View
            </Button>
            <Button size="sm" variant="outline" onClick={() => printMyJD(j)}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        ),
      },
    ];
    return (
      <div>
        <PageHeader title="My Job Descriptions" description={`${jds.length} assigned`} />
        <DataTable columns={columns} rows={jds} emptyText="No job descriptions." />
      </div>
    );
  }

  const jd = selected;
  const acknowledged = !!jd.acknowledgedAt;
  const rejected = !acknowledged && jd.status === 'REJECTED';
  // Approve requires the tick; Reject requires a comment to send back to the assigner.
  const canSubmit = decision === 'APPROVE' ? accepted : comment.trim().length > 0;

  return (
    <div>
      <PageHeader
        title="My Job Description"
        description={jd.title}
        actions={
          <div className="flex gap-2">
            {jds.length > 1 && (
              <Button variant="outline" onClick={() => setSelectedId(null)}>
                <ChevronLeft className="h-4 w-4" /> Back to list
              </Button>
            )}
            <Button variant="outline" onClick={() => printMyJD(jd)}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" />
            <div>
              <div className="font-semibold text-slate-800">{jd.title}</div>
              <div className="text-xs text-slate-500">
                {jd.assignedAt ? `Assigned ${formatDateTime(jd.assignedAt)}` : 'Assigned'}
                {jd.assignedByName ? ` by ${jd.assignedByName}` : ''} · Status: {jd.status} · Version v{jd.version}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">v{jd.version}</span>
            {acknowledged ? (
              <Badge tone="COMPLETED">Acknowledged</Badge>
            ) : (
              <Badge tone="PENDING">Pending acknowledgement</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {!acknowledged && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Please read your Job Description below, then tick to accept (or choose Reject with a comment) and sign with your signature password.
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
          <CardContent className="space-y-3">
            {rejected && jd.acknowledgementComment && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                You returned this Job Description to the assigner — "{jd.acknowledgementComment}". They will review and re-assign.
              </div>
            )}
            {/* Tick to accept (no typing) */}
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} disabled={decision !== 'APPROVE'} />
              <span>{JD_ACK_SENTENCE}</span>
            </label>
            {/* Decision dropdown: Approve / Reject */}
            <Field label="Decision" required>
              <Select
                value={decision}
                onChange={(e) => setDecision(e.target.value as Decision)}
                options={[
                  { value: 'APPROVE', label: 'Approve / Acknowledge' },
                  { value: 'REJECT', label: 'Reject (send back to assigner)' },
                ]}
              />
            </Field>
            {/* Comment — required when rejecting; sent back to the assigner. */}
            <Field label={decision === 'REJECT' ? 'Comment (required — sent to the assigner)' : 'Comment (optional)'} required={decision === 'REJECT'}>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={decision === 'REJECT' ? 'Why are you returning this Job Description?' : 'Optional note…'} />
            </Field>
            <Button disabled={!canSubmit} onClick={() => setSignOpen(true)}>
              Submit
            </Button>
          </CardContent>
        </Card>
      )}

      <ESignatureModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title={decision === 'REJECT' ? 'Sign to Return Job Description' : 'Sign to Acknowledge Job Description'}
        defaultMeaning={decision === 'REJECT' ? 'Rejected' : 'Acknowledged'}
        hideMeaning
        onConfirm={async (sig) => {
          await ackMut.mutateAsync(sig);
          setSignOpen(false);
        }}
      />
    </div>
  );
}
