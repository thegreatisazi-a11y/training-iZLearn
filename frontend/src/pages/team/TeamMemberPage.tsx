import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, UserCircle, Printer } from 'lucide-react';
import DOMPurify from 'dompurify';
import { printJobDescription } from '@/lib/jdPrint';
import { printCurriculumVitae } from '@/lib/cvPrint';
import { CvDocument } from '@/components/common/CvDocument';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
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
  requestType?: 'RETAKE' | 'OVERDUE_ACCESS' | string;
  justification: string;
  decisionRemarks?: string | null;
  createdAt: string;
  decidedAt?: string | null;
}

const REQUEST_LABEL = (t?: string) => (t === 'OVERDUE_ACCESS' ? 'Overdue access' : 'Retake');

interface MemberHistory {
  user: { id: string; fullName: string; employeeId: string };
  assignments: AssignmentRow[];
  retakeRequests: RetakeRow[];
}

interface MemberJD {
  id: string;
  title: string;
  version: number;
  status: string;
  content: string;
  departmentId?: string | null;
  functionalRoleId?: string | null;
  acknowledgedAt?: string | null;
}

interface CvHeader { employeeName: string; employeeCode: string; departmentName?: string | null; functionalRole?: string | null }
interface LanguageItem { language?: string; read?: boolean; write?: boolean; understand?: boolean }
interface CvData {
  version?: number;
  languagesKnown?: string | null;
  languages?: LanguageItem[];
  qualifications?: { year?: string; degree?: string; specialization?: string; institute?: string }[];
  currentRole?: string | null;
  currentResponsibilities?: string | null;
  experience?: { organisation?: string; role?: string; tenureFrom?: string; tenureTo?: string; responsibilities?: string }[];
  trainings?: { detail?: string }[];
  publications?: { detail?: string }[];
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
  const [jdOpen, setJdOpen] = useState(false);
  const [cvOpen, setCvOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['team-member', userId],
    queryFn: () => svc.users.teamHistory(userId) as unknown as Promise<MemberHistory>,
    enabled: !!userId,
  });

  // Supervisor view of the team member's JD(s) — fetched on demand (mirrors Team CVs).
  const { data: memberJDs, isLoading: jdLoading } = useQuery({
    queryKey: ['team-member-jds', userId],
    queryFn: () => svc.jds.user(userId) as unknown as Promise<MemberJD[]>,
    enabled: !!userId && jdOpen,
  });
  // Supervisor/admin view of the team member's CV — fetched on demand (Team CVs moved here).
  const { data: cvData, isLoading: cvLoading } = useQuery({
    queryKey: ['team-member-cv', userId],
    queryFn: () => svc.cv.user(userId) as unknown as Promise<{ header: CvHeader; cv: CvData | null }>,
    enabled: !!userId && cvOpen,
  });
  const { data: depts } = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }), enabled: jdOpen });
  const { data: desigs } = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }), enabled: jdOpen });
  const deptName = useMemo(() => new Map(((depts?.data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name])), [depts]);
  const roleName = useMemo(() => new Map(((desigs?.data ?? []) as { id: string; displayName: string }[]).map((d) => [d.id, d.displayName])), [desigs]);

  const decideMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.retake.decide(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-member', userId] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  async function confirmDecision(signature: ESignaturePayload) {
    if (!decision.row) return;
    const overdueApprove = decision.kind === 'APPROVE' && decision.row.requestType === 'OVERDUE_ACCESS';
    await decideMutation.mutateAsync({
      id: decision.row.id,
      body: {
        decision: decision.kind,
        decisionRemarks: signature.meaning,
        signature,
        reasonForChange: `Assessment retake ${decision.kind === 'APPROVE' ? 'approved' : 'rejected'}`,
      },
    });
    toast.success(
      decision.kind === 'REJECT'
        ? 'Retake request rejected.'
        : overdueApprove
          ? 'Approved — course re-opened and the due date extended by 7 days.'
          : 'Retake approved.',
    );
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
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setJdOpen(true)}>
              <FileText className="h-4 w-4" /> View Job Description
            </Button>
            <Button variant="outline" onClick={() => setCvOpen(true)}>
              <UserCircle className="h-4 w-4" /> View CV
            </Button>
          </div>
        }
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
          <h2 className="mb-2 text-sm font-semibold text-amber-800">Requests awaiting your approval</h2>
          <ul className="space-y-2">
            {pendingRetakes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white p-3">
                <div>
                  <div className="flex items-center gap-2 font-medium text-slate-800">
                    {r.topic}
                    <Badge tone={r.requestType === 'OVERDUE_ACCESS' ? 'PENDING' : 'IN_PROGRESS'}>{REQUEST_LABEL(r.requestType)}</Badge>
                  </div>
                  <div className="text-xs text-slate-500">Requested {formatDateTime(r.createdAt)} · “{r.justification}”</div>
                  {r.requestType === 'OVERDUE_ACCESS' && (
                    <div className="mt-1 text-xs text-amber-700">Approving re-opens the course and extends the due date by 7 days.</div>
                  )}
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

      {/* Team member's Job Description(s) — supervisor view, mirrors Team CVs. */}
      <Dialog
        open={jdOpen}
        onClose={() => setJdOpen(false)}
        className="max-w-2xl"
        title="Job Description"
        footer={<Button onClick={() => setJdOpen(false)}>Close</Button>}
      >
        {jdLoading ? (
          <PageLoader />
        ) : !memberJDs || memberJDs.length === 0 ? (
          <p className="text-sm text-slate-500">No active job description is assigned to this team member.</p>
        ) : (
          <div className="space-y-6">
            {memberJDs.map((jd) => (
              <div key={jd.id} className="text-sm">
                <div className="rounded-t-md border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-base font-semibold uppercase tracking-wide text-slate-800">Job Description</div>
                      <div className="text-xs text-slate-500">{jd.title}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={jd.status}>{jd.status.replace(/_/g, ' ')}</Badge>
                      <span className="rounded bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">Version v{jd.version}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          printJobDescription({
                            title: jd.title,
                            version: jd.version,
                            status: jd.status,
                            employeeName: data?.user.fullName ?? null,
                            employeeCode: data?.user.employeeId ?? null,
                            department: jd.departmentId ? deptName.get(jd.departmentId) ?? null : null,
                            functionalRole: jd.functionalRoleId ? roleName.get(jd.functionalRoleId) ?? null : null,
                            acknowledgedAt: jd.acknowledgedAt ?? null,
                            content: jd.content ?? null,
                          })
                        }
                      >
                        <Printer className="h-4 w-4" /> Print
                      </Button>
                    </div>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-x border-slate-200 px-4 py-4 text-slate-700 sm:grid-cols-3">
                  <div><dt className="text-xs uppercase tracking-wide text-slate-400">Employee Name</dt><dd className="font-medium">{data?.user.fullName ?? '—'}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wide text-slate-400">Employee Code</dt><dd className="font-medium">{data?.user.employeeId ?? '—'}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wide text-slate-400">Department</dt><dd className="font-medium">{jd.departmentId ? deptName.get(jd.departmentId) ?? '—' : '—'}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wide text-slate-400">Functional Role</dt><dd className="font-medium">{jd.functionalRoleId ? roleName.get(jd.functionalRoleId) ?? '—' : '—'}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wide text-slate-400">JD Version</dt><dd className="font-medium">v{jd.version}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wide text-slate-400">Acknowledged</dt><dd className="font-medium">{jd.acknowledgedAt ? `Yes · ${formatDate(jd.acknowledgedAt)}` : 'Pending'}</dd></div>
                </dl>
                <div className="rounded-b-md border border-slate-200 px-4 py-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Job Description Details</div>
                  <div className="prose-sm text-slate-700" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(jd.content ?? '') }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      {/* Team member's CV — supervisor/admin view (moved here from the Team CVs menu). */}
      <Dialog
        open={cvOpen}
        onClose={() => setCvOpen(false)}
        className="max-w-3xl"
        title={cvData?.header ? `CV — ${cvData.header.employeeName}` : 'Curriculum Vitae'}
        footer={
          <>
            {/* Download the CV as a print-to-PDF, mirroring the JD "Print" action above. */}
            <Button
              variant="outline"
              disabled={!cvData?.cv}
              onClick={() => cvData?.header && printCurriculumVitae(cvData.header, cvData.cv)}
            >
              <Printer className="h-4 w-4" /> Print CV
            </Button>
            <Button onClick={() => setCvOpen(false)}>Close</Button>
          </>
        }
      >
        {cvLoading ? (
          <PageLoader />
        ) : !cvData?.cv ? (
          <p className="text-sm text-slate-500">This team member has not created a CV yet.</p>
        ) : (
          <CvDocument header={cvData.header} cv={cvData.cv} />
        )}
      </Dialog>

      <ESignatureModal
        open={decision.open}
        onClose={() => setDecision((s) => ({ ...s, open: false }))}
        onConfirm={confirmDecision}
        title={`${decision.kind === 'APPROVE' ? 'Approve' : 'Reject'} ${REQUEST_LABEL(decision.row?.requestType)} — ${decision.row?.topic ?? ''}`}
        defaultMeaning={decision.kind === 'APPROVE' ? 'Approved' : 'Rejected'}
        requireReason
      />
    </div>
  );
}
