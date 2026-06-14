import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { formatDate, formatDateTime } from '@/lib/format';
import { svc } from '@/services';

interface AssignmentRow {
  id: string;
  topicId: string;
  topic: string;
  topicNumber?: string | null;
  trainingType?: string | null;
  version?: number | null;
  isSuperseded?: boolean;
  status: string;
  dueDate?: string | null;
  createdAt: string;
  maxAttempts?: number | null;
  extraAttempts?: number | null;
  attemptsUsed: number;
  bestScore?: number | null;
  isPassed: boolean;
  isBlocked: boolean;
  pendingRetakeId?: string | null;
}

interface RetakeRow {
  id: string;
  assignmentId: string;
  topic: string;
  status: string;
  justification: string;
  decisionRemarks?: string | null;
  createdAt: string;
  decidedAt?: string | null;
}

interface MemberHistory {
  user: { id: string; fullName: string; employeeId: string };
  assignments: AssignmentRow[];
  retakeRequests: RetakeRow[];
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  OVERDUE: 'REJECTED',
  BLOCKED: 'REJECTED',
  WAIVED: 'WAIVED',
  DEFERRED: 'PENDING',
};

/**
 * Supervisor's per-user detail page: every training assigned to the team member,
 * with status, attempts and scores, plus their assessment-retake requests (which
 * the supervisor can approve/reject). Backend scopes access to the user's own
 * supervisor (or SUPER_ADMIN).
 */
export default function TeamMemberPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canApprove = useAuthStore((s) => s.hasPermission)('team', 'approve');

  const [decision, setDecision] = useState<{ open: boolean; kind: 'APPROVE' | 'REJECT'; row?: RetakeRow }>({ open: false, kind: 'APPROVE' });

  const { data, isLoading } = useQuery({
    queryKey: ['team-member', userId],
    queryFn: () => svc.users.teamHistory(userId) as unknown as Promise<MemberHistory>,
    enabled: !!userId,
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.retake.decide(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-member', userId] });
      toast.success('Retake decision recorded.');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  async function confirmDecision(signature: ESignaturePayload) {
    if (!decision.row) return;
    await decideMutation.mutateAsync({
      id: decision.row.id,
      body: {
        decision: decision.kind,
        decisionRemarks: signature.meaning,
        signature,
        reasonForChange: `Assessment retake ${decision.kind === 'APPROVE' ? 'approved' : 'rejected'}`,
      },
    });
  }

  const pendingRetakes = (data?.retakeRequests ?? []).filter((r) => r.status === 'PENDING_APPROVAL');

  const assignmentColumns: Column<AssignmentRow>[] = [
    { key: 'num', header: 'Topic No.', render: (r) => <span className="font-mono text-xs">{r.topicNumber ?? '—'}</span> },
    {
      key: 'title',
      header: 'Training',
      render: (r) => (
        <span>
          <span className="font-medium text-slate-800">{r.topic}</span>
          {r.isSuperseded && <span className="ml-2 text-xs text-slate-400">(superseded)</span>}
        </span>
      ),
    },
    { key: 'version', header: 'Version', render: (r) => (r.version != null ? `v${r.version}` : '—') },
    { key: 'type', header: 'Type', render: (r) => (r.trainingType ?? '').replace(/_/g, ' ') || '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'default'}>{r.status.replace(/_/g, ' ')}</Badge> },
    {
      key: 'attempts',
      header: 'Attempts',
      render: (r) => {
        const max = (r.maxAttempts ?? 0) + (r.extraAttempts ?? 0);
        return <span className="text-sm">{r.attemptsUsed}{max ? ` / ${max}` : ''}{r.extraAttempts ? <span className="ml-1 text-xs text-emerald-600">(+{r.extraAttempts})</span> : null}</span>;
      },
    },
    { key: 'score', header: 'Best Score', render: (r) => (r.bestScore != null ? `${r.bestScore}%` : '—') },
    {
      key: 'result',
      header: 'Result',
      render: (r) =>
        r.isPassed ? <Badge tone="COMPLETED">Passed</Badge> : r.isBlocked ? <Badge tone="REJECTED">Blocked</Badge> : <span className="text-slate-400">—</span>,
    },
    { key: 'due', header: 'Due', render: (r) => formatDate(r.dueDate) },
    {
      key: 'retake',
      header: '',
      render: (r) =>
        r.pendingRetakeId ? <span className="text-xs text-amber-600">Retake pending</span> : null,
    },
  ];

  if (isLoading) return <PageLoader />;

  const summary = (data?.assignments ?? []).reduce(
    (acc, a) => {
      acc.total += 1;
      if (a.isPassed || a.status === 'COMPLETED' || a.status === 'WAIVED') acc.completed += 1;
      else if (a.isBlocked) acc.blocked += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: 0, completed: 0, pending: 0, blocked: 0 },
  );

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-2" onClick={() => navigate('/team')}>
        <ArrowLeft className="h-4 w-4" /> Back to My Team
      </Button>
      <PageHeader
        title={data?.user.fullName ?? 'Team Member'}
        description={data?.user.employeeId ? `Employee ID: ${data.user.employeeId}` : undefined}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent><div className="text-2xl font-semibold text-slate-800">{summary.total}</div><div className="text-xs text-slate-500">Assigned</div></CardContent></Card>
        <Card><CardContent><div className="text-2xl font-semibold text-green-600">{summary.completed}</div><div className="text-xs text-slate-500">Completed</div></CardContent></Card>
        <Card><CardContent><div className="text-2xl font-semibold text-amber-600">{summary.pending}</div><div className="text-xs text-slate-500">In progress / pending</div></CardContent></Card>
        <Card><CardContent><div className="text-2xl font-semibold text-red-600">{summary.blocked}</div><div className="text-xs text-slate-500">Blocked</div></CardContent></Card>
      </div>

      {/* Pending retake requests awaiting this supervisor's decision */}
      {pendingRetakes.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-800">Retake requests awaiting your approval</h2>
          <ul className="space-y-2">
            {pendingRetakes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white p-3">
                <div>
                  <div className="font-medium text-slate-800">{r.topic}</div>
                  <div className="text-xs text-slate-500">Requested {formatDateTime(r.createdAt)} · “{r.justification}”</div>
                </div>
                {canApprove ? (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => setDecision({ open: true, kind: 'APPROVE', row: r })}>Approve</Button>
                    <Button size="sm" variant="danger" onClick={() => setDecision({ open: true, kind: 'REJECT', row: r })}>Reject</Button>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">Awaiting supervisor</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Assigned trainings</h2>
      <DataTable columns={assignmentColumns} rows={data?.assignments ?? []} emptyText="No trainings assigned to this user." />

      {/* Retake request history (decided ones) */}
      {(data?.retakeRequests ?? []).some((r) => r.status !== 'PENDING_APPROVAL') && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Retake request history</h2>
          <ul className="space-y-1 text-sm">
            {(data?.retakeRequests ?? [])
              .filter((r) => r.status !== 'PENDING_APPROVAL')
              .map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="text-slate-700">{r.topic}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={r.status === 'APPROVED' ? 'COMPLETED' : 'REJECTED'}>{r.status}</Badge>
                    <span className="text-xs text-slate-400">{r.decidedAt ? formatDateTime(r.decidedAt) : ''}</span>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <ESignatureModal
        open={decision.open}
        onClose={() => setDecision((s) => ({ ...s, open: false }))}
        onConfirm={confirmDecision}
        title={`${decision.kind === 'APPROVE' ? 'Approve' : 'Reject'} Retake — ${decision.row?.topic ?? ''}`}
        defaultMeaning={decision.kind === 'APPROVE' ? 'Approved' : 'Rejected'}
        requireReason
      />
    </div>
  );
}
