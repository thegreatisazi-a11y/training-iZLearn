import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { svc } from '@/services';
import { formatDate } from '@/lib/format';

interface MyTraining {
  id: string;
  topicId: string;
  status: string;
  dueDate: string | null;
  refresherDueDate: string | null;
  topic: {
    id: string;
    title: string;
    topicNumber?: string | null;
    topicCode: string;
    currentVersion: number;
    status: string;
    trainingType: string;
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
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'overdue'>('all');
  const { data, isLoading } = useQuery({ queryKey: ['my-trainings'], queryFn: () => svc.assignments.mine() as unknown as Promise<MyTraining[]> });

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
    { key: 'version', header: 'Version', render: (r) => `v${r.topic?.currentVersion ?? '—'}` },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'default'}>{r.status.replace(/_/g, ' ')}</Badge> },
    { key: 'due', header: 'Due', render: (r) => formatDate(r.dueDate) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => {
        const done = r.status === 'COMPLETED' || r.result?.isPassed;
        if (done) return <Badge tone="COMPLETED">{r.result?.score != null ? `Passed · ${r.result.score}%` : 'Completed'}</Badge>;
        if (r.status === 'BLOCKED') return <span className="text-sm text-red-600">Blocked</span>;
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
    </div>
  );
}
