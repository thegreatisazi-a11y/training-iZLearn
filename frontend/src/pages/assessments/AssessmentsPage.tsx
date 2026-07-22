import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { formatDateTime } from '@/lib/format';
import { printHtml, escapeHtml } from '@/lib/print';

interface ReviewDetail {
  questionId: string;
  questionText: string;
  isCorrect?: boolean;
  userAnswer?: unknown;
  correctAnswer: unknown;
  explanation?: string | null;
}
interface AttemptReview {
  // S2: the assessed employee's identity, shown at the top of the view/printout.
  employeeName?: string | null;
  employeeId?: string | null;
  department?: string | null;
  topicTitle?: string | null;
  topicNumber?: string | null;
  score: number;
  passingScorePercent: number;
  correctCount: number;
  incorrectCount: number;
  isPassed: boolean;
  attemptNumber: number;
  maxAttempts: number;
  allDetails?: ReviewDetail[];
  incorrectDetails?: ReviewDetail[];
  timeSpentSeconds?: number | null;
  readingTimeSeconds?: number | null;
  submissionReason?: string | null;
  submissionReasonLabel?: string | null;
}

/** Pretty-print a stored answer (mirrors the post-submit result screen). */
function formatCorrect(c: unknown): string {
  if (Array.isArray(c)) {
    if (c.length && typeof c[0] === 'object' && c[0] && 'left' in (c[0] as object)) {
      return (c as Array<{ left: string; right: string }>).map((p) => `${p.left} → ${p.right}`).join(', ');
    }
    return (c as unknown[]).join(', ');
  }
  if (c && typeof c === 'object') return Object.values(c as Record<string, unknown>).map((v) => String(v)).join(', ');
  return String(c ?? '');
}

interface Attempt {
  id: string;
  topicId: string;
  topicTitle?: string;
  topicNumber?: string | null;
  attemptNumber: number;
  score: number | null;
  isPassed: boolean;
  completedAt: string | null;
  timeSpentSeconds?: number | null;
  submissionReasonLabel?: string | null;
}
interface BlockedAssignment {
  id: string;
  userId: string;
  userFullName?: string;
  employeeId?: string | null;
  topicId: string;
  topicTitle?: string;
  topicNumber?: string | null;
  status: string;
}
/** Item B: an assignment row from the my-trainings endpoint (drives the Start dropdown). */
interface MyTraining {
  topicId: string;
  topicTitle?: string | null;
  topicNumber?: string | null;
  status: string;
  requiresAssessment?: boolean;
  readingComplete?: boolean;
  result?: { isPassed?: boolean } | null;
}
/** Item 3: a completed attempt of another user the requester may view/download. */
interface ManagedAttempt extends Attempt {
  userId: string;
  userFullName?: string | null;
  employeeId?: string | null;
}

/** BUG-04: "TT-001 – Title" (falls back gracefully when either part is missing). */
function topicLabel(number?: string | null, title?: string | null, id?: string): string {
  const t = title ?? id ?? '';
  return number ? `${number} – ${t}` : t;
}
/** BUG-05: seconds → "Xm Ys". */
function fmtDuration(s?: number | null): string {
  if (s === null || s === undefined) return '—';
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s % 60}s`;
}

/** Item 3: build & open a printable ("Save as PDF") document for a completed attempt —
 *  the same summary + per-question breakdown shown on screen. Used by the Download
 *  action on both a learner's own test and (for managers) a team member's test. */
function printAttemptReview(data: AttemptReview): void {
  const heading = `${data.topicNumber ? `${data.topicNumber} – ` : ''}${data.topicTitle ?? 'Assessment'}`;
  const summary =
    `<table>` +
    // S2: identify the assessed employee at the top of the printout.
    (data.employeeName ? `<tr><th>Employee Name</th><td>${escapeHtml(data.employeeName)}</td></tr>` : '') +
    (data.employeeId ? `<tr><th>Employee ID</th><td>${escapeHtml(data.employeeId)}</td></tr>` : '') +
    (data.department ? `<tr><th>Department</th><td>${escapeHtml(data.department)}</td></tr>` : '') +
    `<tr><th>Result</th><td>${data.isPassed ? 'Passed' : 'Failed'}</td></tr>` +
    `<tr><th>Score</th><td>${data.score}%</td></tr>` +
    `<tr><th>Passing score</th><td>${data.passingScorePercent}%</td></tr>` +
    `<tr><th>Correct</th><td>${data.correctCount}</td></tr>` +
    `<tr><th>Incorrect</th><td>${data.incorrectCount}</td></tr>` +
    `<tr><th>Attempt</th><td>${data.attemptNumber} of ${data.maxAttempts}</td></tr>` +
    `<tr><th>Time on assessment</th><td>${fmtDuration(data.timeSpentSeconds)}</td></tr>` +
    `<tr><th>Time on reading</th><td>${fmtDuration(data.readingTimeSeconds)}</td></tr>` +
    `</table>`;
  const review = data.allDetails?.length ? data.allDetails : data.incorrectDetails ?? [];
  const questions = review
    .map(
      (d, i) =>
        `<div style="margin:10px 0;padding:8px 0;border-top:1px solid #ddd;">` +
        `<div><strong>${i + 1}. ${escapeHtml(d.questionText)}</strong>${d.isCorrect === true ? ' ✓' : d.isCorrect === false ? ' ✗' : ''}</div>` +
        `<div>Your answer: ${escapeHtml(formatCorrect(d.userAnswer) || '—')}</div>` +
        `${d.correctAnswer != null && d.correctAnswer !== '' ? `<div>Correct answer: ${escapeHtml(formatCorrect(d.correctAnswer))}</div>` : ''}` +
        `${d.explanation ? `<div>Explanation: ${escapeHtml(String(d.explanation))}</div>` : ''}` +
        `</div>`,
    )
    .join('');
  printHtml('Assessment Result', `<h2>${escapeHtml(heading)}</h2>${summary}${questions ? `<h3>Questions</h3>${questions}` : ''}`);
}

/**
 * View a completed attempt's questions & answers in the SAME format shown right after
 * submission — a summary header plus the full per-question breakdown (user answer,
 * correct answer, explanation). Fetched on open from the review endpoint.
 */
function AttemptReviewDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['assessment-review', id],
    queryFn: () => svc.assessments.review(id as string) as unknown as Promise<AttemptReview>,
    enabled: !!id,
  });
  const title = data ? `${data.topicNumber ? `${data.topicNumber} – ` : ''}${data.topicTitle ?? 'Assessment'}` : 'Assessment Review';
  return (
    <Dialog open={!!id} onClose={onClose} className="max-w-2xl" title="Assessment Review" footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <div className="space-y-4">
          <div className="text-sm font-medium text-slate-700">{title}</div>
          {/* S2: identify the assessed employee at the top of the view. */}
          {(data.employeeName || data.employeeId || data.department) && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {data.employeeName && <span><span className="text-slate-400">Employee:</span> <strong>{data.employeeName}</strong></span>}
              {data.employeeId && <span><span className="text-slate-400">Employee ID:</span> <strong>{data.employeeId}</strong></span>}
              {data.department && <span><span className="text-slate-400">Department:</span> <strong>{data.department}</strong></span>}
            </div>
          )}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                {data.isPassed ? <CheckCircle2 className="h-10 w-10 text-green-600" /> : <XCircle className="h-10 w-10 text-red-600" />}
                <div>
                  <div className="text-3xl font-semibold text-slate-800">{data.score}%</div>
                  <Badge tone={data.isPassed ? 'COMPLETED' : 'REJECTED'}>{data.isPassed ? 'Passed' : 'Failed'}</Badge>
                </div>
              </div>
              <div className="text-sm text-slate-600">
                <div>Passing score: {data.passingScorePercent}%</div>
                <div className="text-green-700">Correct: {data.correctCount}</div>
                <div className="text-red-700">Incorrect: {data.incorrectCount}</div>
                <div>Attempt {data.attemptNumber} of {data.maxAttempts}</div>
              </div>
              <div className="text-sm text-slate-600">
                <div>Time on assessment: <strong>{fmtDuration(data.timeSpentSeconds)}</strong></div>
                <div>Time on reading: <strong>{fmtDuration(data.readingTimeSeconds)}</strong></div>
                {data.submissionReasonLabel && data.submissionReason !== 'USER_SUBMITTED' && (
                  <div>Ended due to: <strong>{data.submissionReasonLabel}</strong></div>
                )}
              </div>
            </CardContent>
          </Card>

          {(() => {
            const review = data.allDetails?.length ? data.allDetails : data.incorrectDetails;
            if (!review || review.length === 0) return <p className="text-sm text-slate-500">No question-level detail is available for this attempt.</p>;
            const showingAll = !!data.allDetails?.length;
            return (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase text-slate-500">{showingAll ? 'Review — all questions' : 'Review — incorrect answers'}</h3>
                {review.map((d, i) => {
                  const correct = d.isCorrect === true;
                  return (
                    <Card key={d.questionId} className={correct ? 'border-green-200' : 'border-red-200'}>
                      <CardContent>
                        <div className="flex items-start gap-2">
                          {showingAll && (correct ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />)}
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800">{i + 1}. {d.questionText}</p>
                            <p className={`mt-1 text-sm ${correct ? 'text-green-700' : 'text-red-700'}`}>Your answer: {formatCorrect(d.userAnswer) || '—'}</p>
                            {/* The correct answer / explanation are withheld on a learner's own
                                review (reattempts are possible) — the backend only sends them for
                                manager review of another user's attempt. */}
                            {!correct && d.correctAnswer != null && d.correctAnswer !== '' && (
                              <p className="mt-1 text-sm text-green-700">Correct answer: {formatCorrect(d.correctAnswer)}</p>
                            )}
                            {d.explanation && <p className="mt-1 text-sm text-slate-600">{d.explanation}</p>}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </Dialog>
  );
}

export default function AssessmentsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canManage = useAuthStore((s) => s.hasPermission)('assessments', 'write');
  // S1: the "Team Assessments" view (others' attempts) is gated on its own permission;
  // scope within it (team vs all) is enforced server-side by role.
  const canViewOthers = useAuthStore((s) => s.hasPermission)('assessments', 'view_others' as never);

  const mine = useQuery({ queryKey: ['assessments', 'mine'], queryFn: () => svc.assessments.listMine() as unknown as Promise<Attempt[]> });
  // Item B: the "Start Assessment" dropdown is built from the user's ASSIGNMENTS so it can
  // show only genuinely-remaining assessments (reading done, assessment still pending).
  const myTrainings = useQuery({ queryKey: ['my-trainings'], queryFn: () => svc.assignments.mine() as unknown as Promise<MyTraining[]> });
  const blocked = useQuery({
    queryKey: ['assignments', 'blocked'],
    queryFn: () => svc.assignments.list({ status: 'BLOCKED', pageSize: 200 }),
    enabled: canManage,
  });

  // BUG-01: a user may not initiate training until their JD is approved and CV exists.
  const myJds = useQuery({ queryKey: ['my-jd-list'], queryFn: () => svc.jds.mineList() as unknown as Promise<{ status: string }[]> });
  const myCv = useQuery({ queryKey: ['my-cv'], queryFn: () => svc.cv.mine() as unknown as Promise<{ cv: unknown | null }> });
  const jdApproved = (myJds.data ?? []).some((j) => j.status === 'APPROVED');
  const cvReady = !!myCv.data?.cv;
  const canInitiate = jdApproved && cvReady;

  // BUG-08: topics the user has already passed must not be startable again.
  const passedTopicIds = useMemo(() => new Set((mine.data ?? []).filter((a) => a.isPassed).map((a) => a.topicId)), [mine.data]);
  // Item B: only genuinely-remaining assessments. Include an assignment when it is
  // actionable (PENDING/IN_PROGRESS — this excludes OVERDUE, COMPLETED/WAIVED, and BLOCKED
  // which covers a pending retake request), its materials are fully read, the topic still
  // requires an assessment, and it has not already been passed. De-duplicated by topic.
  const topicOpts = useMemo(() => {
    const seen = new Set<string>();
    return (myTrainings.data ?? [])
      .filter(
        (a) =>
          (a.status === 'PENDING' || a.status === 'IN_PROGRESS') &&
          a.requiresAssessment !== false &&
          a.readingComplete === true &&
          a.result?.isPassed !== true &&
          !passedTopicIds.has(a.topicId),
      )
      .filter((a) => (seen.has(a.topicId) ? false : (seen.add(a.topicId), true)))
      .map((a) => ({ value: a.topicId, label: topicLabel(a.topicNumber ?? undefined, a.topicTitle ?? undefined, a.topicId) }));
  }, [myTrainings.data, passedTopicIds]);
  const [selectedTopic, setSelectedTopic] = useState('');
  const selectedPassed = passedTopicIds.has(selectedTopic);

  // Unblock flow: e-signature first, then capture the reason for change.
  const [unblockTarget, setUnblockTarget] = useState<BlockedAssignment | null>(null);
  const [signature, setSignature] = useState<ESignaturePayload | null>(null);
  // View a completed attempt's questions & answers.
  const [reviewId, setReviewId] = useState<string | null>(null);
  // Item 3: attempts of others the requester may view/download (team for a supervisor,
  // org-wide for admin/coordinator). Empty for a plain learner → the table stays hidden.
  const managed = useQuery({
    queryKey: ['assessments', 'managed'],
    queryFn: () => svc.assessments.listManaged() as unknown as Promise<ManagedAttempt[]>,
    enabled: canViewOthers, // avoid a 403 for trainees (route now requires view_others)
  });
  const managedRows = managed.data ?? [];
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Item 3: "Download" fetches the attempt's full review then opens a printable
  // ("Save as PDF") document. Own tests hide the answer key; managers get the full key.
  const downloadReview = async (attemptId: string) => {
    setDownloadingId(attemptId);
    try {
      const data = (await svc.assessments.review(attemptId)) as unknown as AttemptReview;
      printAttemptReview(data); // employee details come from the review payload (S2)
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDownloadingId(null);
    }
  };

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
    { key: 'topic', header: 'Topic', render: (r) => topicLabel(r.topicNumber, r.topicTitle, r.topicId) },
    { key: 'attemptNumber', header: 'Attempt', render: (r) => `#${r.attemptNumber}` },
    { key: 'score', header: 'Score', render: (r) => (r.score == null ? '—' : `${r.score}%`) },
    { key: 'isPassed', header: 'Result', render: (r) => (r.completedAt ? <Badge tone={r.isPassed ? 'COMPLETED' : 'REJECTED'}>{r.isPassed ? 'Passed' : 'Failed'}</Badge> : <Badge tone="IN_PROGRESS">In Progress</Badge>) },
    { key: 'time', header: 'Time spent', render: (r) => fmtDuration(r.timeSpentSeconds) },
    // Why the attempt ended — so a technical failure (network/system/device) is visible
    // and the learner isn't unfairly judged on a result caused by something outside them.
    { key: 'reason', header: 'Reason', render: (r) => r.submissionReasonLabel ?? '—' },
    { key: 'completedAt', header: 'Completed', render: (r) => formatDateTime(r.completedAt) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      // Once completed (passed or failed), let the user review AND download the test.
      render: (r) =>
        r.completedAt ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => setReviewId(r.id)}>
              View Test
            </Button>
            <Button size="sm" variant="outline" disabled={downloadingId === r.id} onClick={() => downloadReview(r.id)}>
              {downloadingId === r.id ? 'Preparing…' : 'Print'}
            </Button>
          </div>
        ) : null,
    },
  ];

  // Item 3: managed (team / org-wide) completed attempts — View + Download of others' tests.
  const managedColumns: Column<ManagedAttempt>[] = [
    { key: 'user', header: 'Employee', render: (r) => (r.userFullName ? `${r.userFullName}${r.employeeId ? ` (${r.employeeId})` : ''}` : r.userId) },
    { key: 'topic', header: 'Topic', render: (r) => topicLabel(r.topicNumber, r.topicTitle, r.topicId) },
    { key: 'attemptNumber', header: 'Attempt', render: (r) => `#${r.attemptNumber}` },
    { key: 'score', header: 'Score', render: (r) => (r.score == null ? '—' : `${r.score}%`) },
    { key: 'isPassed', header: 'Result', render: (r) => <Badge tone={r.isPassed ? 'COMPLETED' : 'REJECTED'}>{r.isPassed ? 'Passed' : 'Failed'}</Badge> },
    { key: 'completedAt', header: 'Completed', render: (r) => formatDateTime(r.completedAt) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setReviewId(r.id)}>
            View Test
          </Button>
          <Button size="sm" variant="outline" disabled={downloadingId === r.id} onClick={() => downloadReview(r.id)}>
            {downloadingId === r.id ? 'Preparing…' : 'Print'}
          </Button>
        </div>
      ),
    },
  ];

  const blockedColumns: Column<BlockedAssignment>[] = [
    { key: 'user', header: 'Employee', render: (r) => (r.userFullName ? `${r.userFullName}${r.employeeId ? ` (${r.employeeId})` : ''}` : r.userId) },
    { key: 'topic', header: 'Topic', render: (r) => topicLabel(r.topicNumber, r.topicTitle, r.topicId) },
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
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64">
              <Select options={topicOpts} value={selectedTopic} onChange={(e) => setSelectedTopic(e.target.value)} placeholder="Choose an assigned topic…" />
            </div>
            <Button disabled={!selectedTopic || selectedPassed || !canInitiate} onClick={() => navigate(`/assessments/take/${selectedTopic}`)}>
              Start Assessment
            </Button>
          </div>
          {/* BUG-01: JD/CV must be ready before any training can be initiated. */}
          {!canInitiate && (myJds.isSuccess || myCv.isSuccess) && (
            <p className="text-sm text-red-600">Please complete the JD and CV to initiate the training.</p>
          )}
          {/* BUG-08: a passed assessment cannot be restarted. */}
          {selectedPassed && <p className="text-sm text-amber-600">You have already completed and passed this assessment.</p>}
        </CardContent>
      </Card>

      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">My Assessments</h2>
        <DataTable columns={mineColumns} rows={mine.data ?? []} loading={mine.isLoading} emptyText="You have not attempted any assessments yet." />
      </div>

      {/* Item 3: team members' (supervisor) or everyone's (admin/coordinator) completed
          tests — view & download. Hidden when there are none the requester may access. */}
      {managedRows.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Team Assessments</h2>
          <DataTable columns={managedColumns} rows={managedRows} loading={managed.isLoading} emptyText="No completed assessments." />
        </div>
      )}

      {canManage && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Blocked Assignments</h2>
          <DataTable columns={blockedColumns} rows={(blocked.data?.data ?? []) as unknown as BlockedAssignment[]} loading={blocked.isLoading} emptyText="No blocked assignments." />
        </div>
      )}

      {/* View a completed attempt's questions & answers (passed or failed). */}
      <AttemptReviewDialog id={reviewId} onClose={() => setReviewId(null)} />

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
