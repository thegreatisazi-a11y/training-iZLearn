import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { svc } from '@/services';
import { formatDate } from '@/lib/format';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';

interface RetakeRequest {
  id: string;
  assignmentId: string;
  status: string;
}

interface MyTraining {
  id: string;
  topicId: string;
  status: string;
  dueDate: string | null;
  refresherDueDate: string | null;
  // Per-row version: a completed row keeps the version it was completed at; an actionable
  // row shows the topic's current version. Falls back to the topic's current version.
  topicVersion?: number | null;
  topic: {
    id: string;
    title: string;
    topicNumber?: string | null;
    topicCode: string;
    currentVersion: number;
    status: string;
    trainingType: string;
    durationMinutes?: number | null;
  } | null;
  result: { isPassed: boolean; score: number | null; attempts: number } | null;
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  OVERDUE: 'REJECTED',
  BLOCKED: 'REJECTED',
  WAIVED: 'WAIVED',
};

export default function MyTrainingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'overdue'>('all');
  const [retakeFor, setRetakeFor] = useState<MyTraining | null>(null);
  const [justification, setJustification] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['my-trainings'], queryFn: () => svc.assignments.mine() as unknown as Promise<MyTraining[]> });
  const { data: retakes } = useQuery({ queryKey: ['my-retakes'], queryFn: () => svc.retake.mine() as unknown as Promise<RetakeRequest[]> });
  // BUG-01: training can only be initiated once the user's JD is approved and CV exists.
  const { data: myJds } = useQuery({ queryKey: ['my-jd-list'], queryFn: () => svc.jds.mineList() as unknown as Promise<{ status: string }[]> });
  const { data: myCv } = useQuery({ queryKey: ['my-cv'], queryFn: () => svc.cv.mine() as unknown as Promise<{ cv: unknown | null }> });
  const canInitiate = (myJds ?? []).some((j) => j.status === 'APPROVED') && !!myCv?.cv;

  // assignmentId -> latest pending retake status, so a blocked row shows "requested".
  const pendingByAssignment = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of retakes ?? []) {
      if (r.status === 'PENDING_APPROVAL') m.set(r.assignmentId, r.status);
    }
    return m;
  }, [retakes]);

  const retakeMutation = useMutation({
    mutationFn: (body: unknown) => svc.retake.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-retakes'] });
      toast.success(
        retakeFor?.status === 'OVERDUE'
          ? 'Access request submitted to your supervisor.'
          : 'Retake request submitted to your supervisor.',
      );
      setRetakeFor(null);
      setJustification('');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const rows = useMemo(() => {
    const all = (data ?? []).filter((t) => t.topic); // only show trainings whose topic still exists
    if (filter === 'pending') return all.filter((t) => ['PENDING', 'IN_PROGRESS'].includes(t.status));
    if (filter === 'completed') return all.filter((t) => t.status === 'COMPLETED' || t.result?.isPassed);
    if (filter === 'overdue') return all.filter((t) => t.status === 'OVERDUE');
    return all;
  }, [data, filter]);

  const counts = useMemo(() => {
    const all = data ?? [];
    return {
      total: all.length,
      pending: all.filter((t) => ['PENDING', 'IN_PROGRESS'].includes(t.status)).length,
      completed: all.filter((t) => t.status === 'COMPLETED' || t.result?.isPassed).length,
      overdue: all.filter((t) => t.status === 'OVERDUE').length,
    };
  }, [data]);

  const columns: Column<MyTraining>[] = [
    { key: 'num', header: 'Topic No.', render: (r) => <span className="font-mono text-xs">{r.topic?.topicNumber || r.topic?.topicCode}</span> },
    { key: 'title', header: 'Training', render: (r) => <span className="font-medium text-slate-800">{r.topic?.title}</span> },
    { key: 'type', header: 'Type', render: (r) => (r.topic?.trainingType ?? '').replace(/_/g, ' ') },
    { key: 'duration', header: 'Duration', render: (r) => (r.topic?.durationMinutes ? `${r.topic.durationMinutes} min` : '—') },
    { key: 'version', header: 'Version', render: (r) => `v${r.topicVersion ?? r.topic?.currentVersion ?? '—'}` },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'default'}>{r.status.replace(/_/g, ' ')}</Badge> },
    { key: 'due', header: 'Due', render: (r) => formatDate(r.dueDate) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => {
        const done = r.status === 'COMPLETED' || r.result?.isPassed;
        if (done) return <Badge tone="COMPLETED">{r.result?.score != null ? `Passed · ${r.result.score}%` : 'Completed'}</Badge>;
        if (r.status === 'BLOCKED') {
          if (pendingByAssignment.has(r.id)) {
            return <span className="text-xs text-amber-600">Retake requested</span>;
          }
          return (
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-red-600">Blocked — max attempts reached</span>
              <Button size="sm" variant="outline" onClick={() => setRetakeFor(r)}>Request retake</Button>
            </div>
          );
        }
        // Overdue: the course is locked until the supervisor re-opens it (same flow as retake).
        if (r.status === 'OVERDUE') {
          if (pendingByAssignment.has(r.id)) {
            return <span className="text-xs text-amber-600">Access requested</span>;
          }
          return (
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-red-600">Overdue — past due date</span>
              <Button size="sm" variant="outline" onClick={() => setRetakeFor(r)}>Request access</Button>
            </div>
          );
        }
        // BUG-01: block initiating training until JD is approved and CV is completed.
        if (!canInitiate) {
          return (
            <div className="flex flex-col items-end gap-1">
              <Button size="sm" disabled>{r.status === 'IN_PROGRESS' ? 'Continue' : 'Start Training'}</Button>
              <span className="text-xs text-red-600">Please complete the JD and CV to initiate the training.</span>
            </div>
          );
        }
        return (
          <Button size="sm" onClick={() => navigate(`/assessments/take/${r.topicId}`)}>
            {r.status === 'IN_PROGRESS' ? 'Continue' : 'Start Training'}
          </Button>
        );
      },
    },
  ];

  const Tab = ({ k, label, n }: { k: typeof filter; label: string; n: number }) => (
    <button
      onClick={() => setFilter(k)}
      className={`rounded-md px-3 py-1.5 text-sm ${filter === k ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
    >
      {label} <span className="ml-1 opacity-70">{n}</span>
    </button>
  );

  return (
    <div>
      <PageHeader title="My Trainings" description="Your assigned trainings, due dates, status and completion." />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent><div className="text-2xl font-semibold text-slate-800">{counts.total}</div><div className="text-xs text-slate-500">Total</div></CardContent></Card>
        <Card><CardContent><div className="text-2xl font-semibold text-amber-600">{counts.pending}</div><div className="text-xs text-slate-500">Pending</div></CardContent></Card>
        <Card><CardContent><div className="text-2xl font-semibold text-green-600">{counts.completed}</div><div className="text-xs text-slate-500">Completed</div></CardContent></Card>
        <Card><CardContent><div className="text-2xl font-semibold text-red-600">{counts.overdue}</div><div className="text-xs text-slate-500">Overdue</div></CardContent></Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Tab k="all" label="All" n={counts.total} />
        <Tab k="pending" label="Pending" n={counts.pending} />
        <Tab k="completed" label="Completed" n={counts.completed} />
        <Tab k="overdue" label="Overdue" n={counts.overdue} />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyText="You have no assigned trainings."
      />
      <p className="mt-3 flex items-center gap-1 text-xs text-slate-400"><GraduationCap className="h-3.5 w-3.5" /> Click Start Training to read the material and take the assessment.</p>

      {/* Request dialog — retake (blocked) or access (overdue). */}
      <Dialog
        open={!!retakeFor}
        onClose={() => setRetakeFor(null)}
        title={`${retakeFor?.status === 'OVERDUE' ? 'Request Access' : 'Request Retake'} — ${retakeFor?.topic?.title ?? ''}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRetakeFor(null)}>Cancel</Button>
            <Button
              disabled={justification.trim().length < 5 || retakeMutation.isPending}
              onClick={() => retakeFor && retakeMutation.mutate({ assignmentId: retakeFor.id, justification: justification.trim() })}
            >
              Submit request
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          {retakeFor?.status === 'OVERDUE'
            ? 'This training is past its due date and is locked. Explain why you still need to take it — your request will be sent to your supervisor for approval.'
            : 'You have reached the maximum attempts for this assessment. Explain why you should be allowed to retake it — your request will be sent to your supervisor for approval.'}
        </p>
        <textarea
          className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          rows={4}
          placeholder={`Reason for requesting ${retakeFor?.status === 'OVERDUE' ? 'access' : 'a retake'} (min 5 characters)…`}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
        />
      </Dialog>
    </div>
  );
}
