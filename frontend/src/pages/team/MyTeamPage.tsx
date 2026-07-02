import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/authStore';
import { printHtml, printTable } from '@/lib/print';
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

/**
 * Supervisor team view: every user reporting to the signed-in supervisor (admins
 * see everyone), with their training / JD / CV / TNI / certificate status. Gated by
 * the `team` permission module; the backend additionally scopes by supervisorId.
 * Click a member to open their full training detail page.
 */
export default function MyTeamPage() {
  const navigate = useNavigate();
  const canPrint = useAuthStore((s) => s.hasPermission)('team', 'print');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['my-team', search],
    queryFn: () => svc.users.team({ pageSize: 200, search: search || undefined }),
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
        <button className="text-left hover:underline" onClick={() => navigate(`/team/${r.id}`)}>
          <div className="font-medium text-primary">{r.fullName} {!r.isActive && <span className="text-xs text-slate-400">(inactive)</span>}</div>
          <div className="text-xs text-slate-500">{r.employeeId}{r.departmentName ? ` · ${r.departmentName}` : ''}</div>
        </button>
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
      // CV and JD are viewed from the member's detail page (Details), so no separate
      // View CV button is needed here.
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => navigate(`/team/${r.id}`)}>
          Details <ChevronRight className="h-4 w-4" />
        </Button>
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
    </div>
  );
}
