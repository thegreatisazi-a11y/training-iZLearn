import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { History } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { printHtml, printTable } from '@/lib/print';
import { formatDateTime } from '@/lib/format';
import { svc } from '@/services';

interface TeamMember {
  id: string;
  fullName: string;
  employeeId: string;
  isActive: boolean;
  departmentName?: string | null;
  functionalRoleNames?: string[];
  training: { total: number; completed: number; pending: number; overdue: number };
  assessmentsPassed?: number;
  jdAcknowledged: boolean;
  cvCompleted: boolean;
  certificates: number;
  tniPending: number;
}

interface HistoryRow {
  user: { id: string; fullName: string; employeeId: string };
  assignments: { id: string; topic: string; status: string; dueDate?: string | null; createdAt: string }[];
  attempts: { id: string; topic: string; score?: number | null; isPassed?: boolean | null; attemptNumber: number; completedAt?: string | null }[];
}

/**
 * Supervisor team view: every user reporting to the signed-in supervisor (admins
 * see everyone), with their training / JD / CV / TNI / certificate status. Gated by
 * the `team` permission module; the backend additionally scopes by supervisorId.
 */
export default function MyTeamPage() {
  const navigate = useNavigate();
  const canPrint = useAuthStore((s) => s.hasPermission)('team', 'print');
  const [search, setSearch] = useState('');
  const [historyUser, setHistoryUser] = useState<TeamMember | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-team', search],
    queryFn: () => svc.users.team({ pageSize: 200, search: search || undefined }),
  });
  const history = useQuery({
    queryKey: ['team-history', historyUser?.id],
    queryFn: () => svc.users.teamHistory(historyUser!.id) as unknown as Promise<HistoryRow>,
    enabled: !!historyUser,
  });

  const rows = (data?.data ?? []) as unknown as TeamMember[];

  function handlePrint() {
    const body =
      `<h1>My Team</h1>` +
      `<div class="sub">${rows.length} team member(s)</div>` +
      printTable(
        ['Name', 'Employee ID', 'Functional Role(s)', 'Training (done/total)', 'Assessments passed', 'JD Ack', 'CV', 'Certificates', 'TNI pending'],
        rows.map((r) => [
          r.fullName,
          r.employeeId,
          (r.functionalRoleNames ?? []).join(', '),
          `${r.training.completed}/${r.training.total}`,
          r.assessmentsPassed ?? 0,
          r.jdAcknowledged ? 'Yes' : 'Pending',
          r.cvCompleted ? 'Yes' : 'No',
          r.certificates,
          r.tniPending,
        ]),
      );
    printHtml('My Team', body);
  }

  const columns: Column<TeamMember>[] = [
    {
      key: 'name',
      header: 'Team Member',
      render: (r) => (
        <div>
          <div className="font-medium text-slate-800">{r.fullName} {!r.isActive && <span className="text-xs text-slate-400">(inactive)</span>}</div>
          <div className="text-xs text-slate-500">{r.employeeId}{r.departmentName ? ` · ${r.departmentName}` : ''}</div>
        </div>
      ),
    },
    { key: 'fr', header: 'Functional Role(s)', render: (r) => (r.functionalRoleNames?.length ? r.functionalRoleNames.join(', ') : '—') },
    {
      key: 'training',
      header: 'Training',
      render: (r) => (
        <div className="flex flex-wrap gap-1 text-xs">
          <Badge tone="COMPLETED">{r.training.completed} done</Badge>
          {r.training.pending > 0 && <Badge tone="PENDING">{r.training.pending} pending</Badge>}
          {r.training.overdue > 0 && <Badge tone="REJECTED">{r.training.overdue} overdue</Badge>}
          {r.training.total === 0 && <span className="text-slate-400">none</span>}
        </div>
      ),
    },
    { key: 'assessments', header: 'Assessments', render: (r) => <span className="text-sm">{r.assessmentsPassed ?? 0} passed</span> },
    { key: 'jd', header: 'JD Ack', render: (r) => (r.jdAcknowledged ? <Badge tone="COMPLETED">Yes</Badge> : <Badge tone="PENDING">Pending</Badge>) },
    { key: 'cv', header: 'CV', render: (r) => (r.cvCompleted ? '✓' : '—') },
    { key: 'certs', header: 'Certificates', render: (r) => r.certificates },
    { key: 'tni', header: 'TNI Pending', render: (r) => (r.tniPending > 0 ? r.tniPending : '—') },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setHistoryUser(r)}>
            <History className="h-4 w-4" /> History
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/team-cvs?user=${r.id}`)}>
            View CV
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="My Team"
        description="Training, JD, CV and certificate status for your reporting users."
        actions={canPrint ? <Button variant="outline" onClick={handlePrint}>Print</Button> : undefined}
      />
      <div className="mb-4">
        <Input className="max-w-xs" placeholder="Search name or employee ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <DataTable columns={columns} rows={rows} loading={isLoading} emptyText="No team members are mapped to you yet." />

      {/* Training history drill-in */}
      <Dialog
        open={!!historyUser}
        onClose={() => setHistoryUser(null)}
        className="max-w-3xl"
        title={historyUser ? `Training History — ${historyUser.fullName}` : 'Training History'}
        footer={<Button variant="outline" onClick={() => setHistoryUser(null)}>Close</Button>}
      >
        {history.isLoading ? (
          <PageLoader />
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-400">Training assignments</div>
              {(history.data?.assignments ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">No assignments.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {(history.data?.assignments ?? []).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="text-slate-700">{a.topic}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={a.status}>{a.status.replace(/_/g, ' ')}</Badge>
                        <span className="text-xs text-slate-400">{a.dueDate ? `due ${formatDateTime(a.dueDate)}` : ''}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-400">Assessment attempts</div>
              {(history.data?.attempts ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">No attempts.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {(history.data?.attempts ?? []).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="text-slate-700">{a.topic} <span className="text-xs text-slate-400">(attempt {a.attemptNumber})</span></span>
                      <span className="flex items-center gap-2">
                        {a.score != null && <span className="text-xs text-slate-500">{a.score}%</span>}
                        <Badge tone={a.isPassed ? 'COMPLETED' : 'REJECTED'}>{a.isPassed ? 'Passed' : 'Failed'}</Badge>
                        <span className="text-xs text-slate-400">{a.completedAt ? formatDateTime(a.completedAt) : ''}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
