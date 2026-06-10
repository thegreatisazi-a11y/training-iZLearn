import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { formatDateTime } from '@/lib/format';

interface Attempt {
  id: string;
  topicId: string;
  topicTitle?: string;
  attemptNumber: number;
  score: number | null;
  isPassed: boolean;
  completedAt: string | null;
}
interface BlockedAssignment {
  id: string;
  userId: string;
  userFullName?: string;
  topicId: string;
  topicTitle?: string;
  status: string;
}

export default function AssessmentsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canManage = useAuthStore((s) => s.hasPermission)('assessments', 'write');

  const mine = useQuery({ queryKey: ['assessments', 'mine'], queryFn: () => svc.assessments.listMine() as unknown as Promise<Attempt[]> });
  const topics = useQuery({
    queryKey: ['topics', 'lookup'],
    queryFn: async () => (await svc.topics.list({ pageSize: 200 })).data as Array<Record<string, unknown>>,
  });
  const blocked = useQuery({
    queryKey: ['assignments', 'blocked'],
    queryFn: () => svc.assignments.list({ status: 'BLOCKED', pageSize: 200 }),
    enabled: canManage,
  });

  const topicOpts = useMemo(() => (topics.data ?? []).map((t) => ({ value: String(t.id), label: String(t.title ?? t.id) })), [topics.data]);
  const [selectedTopic, setSelectedTopic] = useState('');

  // Unblock flow: e-signature first, then capture the reason for change.
  const [unblockTarget, setUnblockTarget] = useState<BlockedAssignment | null>(null);
  const [signature, setSignature] = useState<ESignaturePayload | null>(null);

  const unblockMutation = useMutation({
    mutationFn: ({ assignmentId, reasonForChange, sig }: { assignmentId: string; reasonForChange: string; sig: ESignaturePayload }) =>
      svc.assessments.unblock(assignmentId, { reasonForChange, signature: sig }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments', 'blocked'] });
      toast.success('Assignment unblocked.');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const mineColumns: Column<Attempt>[] = [
    { key: 'topic', header: 'Topic', render: (r) => r.topicTitle ?? r.topicId },
    { key: 'attemptNumber', header: 'Attempt', render: (r) => `#${r.attemptNumber}` },
    { key: 'score', header: 'Score', render: (r) => (r.score == null ? '—' : `${r.score}%`) },
    { key: 'isPassed', header: 'Result', render: (r) => (r.completedAt ? <Badge tone={r.isPassed ? 'COMPLETED' : 'REJECTED'}>{r.isPassed ? 'Passed' : 'Failed'}</Badge> : <Badge tone="IN_PROGRESS">In Progress</Badge>) },
    { key: 'completedAt', header: 'Completed', render: (r) => formatDateTime(r.completedAt) },
  ];

  const blockedColumns: Column<BlockedAssignment>[] = [
    { key: 'user', header: 'Employee', render: (r) => r.userFullName ?? r.userId },
    { key: 'topic', header: 'Topic', render: (r) => r.topicTitle ?? r.topicId },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status}>{r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => { setUnblockTarget(r); setSignature(null); }}>
          Unblock
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Assessments" description="Take assigned assessments and review your attempts." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Start an Assessment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-64">
            <Select options={topicOpts} value={selectedTopic} onChange={(e) => setSelectedTopic(e.target.value)} placeholder="Choose an assigned topic…" />
          </div>
          <Button disabled={!selectedTopic} onClick={() => navigate(`/assessments/take/${selectedTopic}`)}>
            Start Assessment
          </Button>
        </CardContent>
      </Card>

      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">My Assessments</h2>
        <DataTable columns={mineColumns} rows={mine.data ?? []} loading={mine.isLoading} emptyText="You have not attempted any assessments yet." />
      </div>

      {canManage && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Blocked Assignments</h2>
          <DataTable columns={blockedColumns} rows={(blocked.data?.data ?? []) as unknown as BlockedAssignment[]} loading={blocked.isLoading} emptyText="No blocked assignments." />
        </div>
      )}

      {/* Step 1: electronic signature. */}
      <ESignatureModal
        open={!!unblockTarget && !signature}
        onClose={() => setUnblockTarget(null)}
        defaultMeaning="Approved"
        title="Sign to Unblock Assignment"
        onConfirm={async (sig) => setSignature(sig)}
      />
      {/* Step 2: reason for change, then submit. */}
      <ReasonForChangeDialog
        open={!!unblockTarget && !!signature}
        onClose={() => { setUnblockTarget(null); setSignature(null); }}
        title="Reason for Unblocking"
        onConfirm={async (reason) => {
          if (unblockTarget && signature) {
            await unblockMutation.mutateAsync({ assignmentId: unblockTarget.id, reasonForChange: reason, sig: signature });
            setUnblockTarget(null);
            setSignature(null);
          }
        }}
      />
    </div>
  );
}
