import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, ArrowLeft, Clock, Printer } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { printHtml, escapeHtml } from '@/lib/print';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/spinner';
import { InlineFileViewer } from '@/components/common/InlineFileViewer';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';

interface ReadingItem {
  materialId: string;
  originalFileName: string;
  fileType: string;
  requiredSeconds: number;
  isCompleted: boolean;
  elapsedSeconds?: number;
}

interface QuestionOption {
  id: string;
  text: string;
}
interface MatchData {
  lefts: string[];
  rights: string[];
}
interface AssessmentQuestion {
  id: string;
  questionText: string;
  questionType: string;
  options?: unknown;
  helpText?: string | null;
}
interface StartResult {
  attemptId: string;
  attemptNumber: number;
  maxAttempts: number;
  topicTitle?: string;
  topicNumber?: string;
  topicCode?: string;
  topicVersion?: number;
  assessmentTimeMinutes?: number | null;
  expiresAt?: string | null;
  questions: AssessmentQuestion[];
}
interface IncorrectDetail {
  questionId: string;
  questionText: string;
  isCorrect?: boolean;
  userAnswer?: unknown;
  correctAnswer: unknown;
  explanation?: string | null;
}
interface SubmitResult {
  score: number;
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  passingScorePercent: number;
  isPassed: boolean;
  isBlocked: boolean;
  attemptNumber: number;
  maxAttempts: number;
  incorrectDetails?: IncorrectDetail[];
  allDetails?: IncorrectDetail[];
  timeSpentSeconds?: number;
  readingTimeSeconds?: number;
  submissionReason?: string;
  submissionReasonLabel?: string;
  certificateId?: string;
}

/** Format a duration in seconds as "Xm Ys" (or "Ys"). */
function fmtDuration(s?: number | null): string {
  if (s === null || s === undefined) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

type Answer = string | string[] | Record<string, string>;

/**
 * CR-40: single-tab guard. While an assessment is in progress, a newly-opened tab
 * detects an existing active tab (via BroadcastChannel ping/pong) and blocks itself,
 * so the assessment can only be taken in one tab.
 */
function useSingleTabGuard(active: boolean): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!active || typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('izlearn-assessment');
    const tabId = Math.random().toString(36).slice(2);
    let isBlocked = false;
    bc.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; tabId?: string };
      if (!msg || msg.tabId === tabId) return;
      if (msg.type === 'ping' && !isBlocked) bc.postMessage({ type: 'pong', tabId });
      if (msg.type === 'pong') {
        isBlocked = true;
        setBlocked(true);
      }
    };
    bc.postMessage({ type: 'ping', tabId });
    return () => bc.close();
  }, [active]);
  return blocked;
}

function asOptions(q: AssessmentQuestion): QuestionOption[] {
  return Array.isArray(q.options) ? (q.options as QuestionOption[]).filter((o) => o && 'id' in o) : [];
}
function asMatch(q: AssessmentQuestion): MatchData {
  const o = q.options as { lefts?: unknown; rights?: unknown } | null | undefined;
  return {
    lefts: Array.isArray(o?.lefts) ? (o!.lefts as string[]) : [],
    rights: Array.isArray(o?.rights) ? (o!.rights as string[]) : [],
  };
}
/** Pretty-print a stored correct answer (handles MATCH pair arrays). */
function formatCorrect(c: unknown): string {
  if (Array.isArray(c)) {
    if (c.length && typeof c[0] === 'object' && c[0] && 'left' in (c[0] as object)) {
      return (c as Array<{ left: string; right: string }>).map((p) => `${p.left} → ${p.right}`).join(', ');
    }
    return (c as unknown[]).join(', ');
  }
  // #7: defensive fallback for an object answer (e.g. a fill-in-the-blanks map) so it
  // never renders as "[object Object]"; the backend normally flattens these already.
  if (c && typeof c === 'object') {
    return Object.values(c as Record<string, unknown>).map((v) => String(v)).join(', ');
  }
  return String(c ?? '');
}

function QuestionCard({ index, question, answer, onChange }: { index: number; question: AssessmentQuestion; answer: Answer | undefined; onChange: (a: Answer) => void }) {
  const { questionType } = question;

  function renderBody() {
    if (questionType === 'MULTIPLE_CHOICE_SINGLE' || questionType === 'TRUE_FALSE') {
      const opts = questionType === 'TRUE_FALSE' && asOptions(question).length === 0
        ? [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }]
        : asOptions(question);
      return (
        <div className="space-y-2">
          {opts.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name={question.id} checked={answer === o.id} onChange={() => onChange(o.id)} />
              {o.text}
            </label>
          ))}
        </div>
      );
    }
    if (questionType === 'MULTIPLE_CHOICE_MULTI') {
      const current = Array.isArray(answer) ? answer : [];
      return (
        <div className="space-y-2">
          <p className="text-xs italic text-slate-500">Select all that apply — multiple options can be selected.</p>
          {asOptions(question).map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={current.includes(o.id)}
                onChange={() => onChange(current.includes(o.id) ? current.filter((x) => x !== o.id) : [...current, o.id])}
              />
              {o.text}
            </label>
          ))}
        </div>
      );
    }
    if (questionType === 'FILL_IN_THE_BLANKS') {
      return <Input value={typeof answer === 'string' ? answer : ''} onChange={(e) => onChange(e.target.value)} placeholder="Type your answer…" />;
    }
    if (questionType === 'MATCH_THE_WORDS') {
      const { lefts, rights } = asMatch(question);
      const rightOpts = rights.map((r) => ({ value: r, label: r }));
      // CR-36: the answer is a { left: right } map.
      const current = answer && typeof answer === 'object' && !Array.isArray(answer) ? (answer as Record<string, string>) : {};
      function setRight(left: string, right: string) {
        const next = { ...current };
        if (right) next[left] = right;
        else delete next[left];
        onChange(next);
      }
      return (
        <div className="space-y-2">
          {lefts.map((left) => (
            <div key={left} className="grid grid-cols-2 items-center gap-3">
              <span className="text-sm text-slate-700">{left}</span>
              <Select options={rightOpts} value={current[left] ?? ''} onChange={(e) => setRight(left, e.target.value)} placeholder="Match…" />
            </div>
          ))}
        </div>
      );
    }
    return null;
  }

  return (
    <Card>
      <CardContent>
        <p className="mb-1 font-medium text-slate-800">
          {index + 1}. {question.questionText}
        </p>
        {question.helpText && <p className="mb-3 text-xs italic text-slate-500">{question.helpText}</p>}
        {renderBody()}
      </CardContent>
    </Card>
  );
}

export default function TakeAssessmentPage() {
  const { topicId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  // Phase 6 / reading-gate: an optional instruction step (shown first if a global
  // training instruction is configured), then per-material timed reading, then the
  // assessment (only STARTED once the server confirms reading is complete).
  const [phase, setPhase] = useState<'instruction' | 'material' | 'assessment'>('instruction');
  const [instructionAck, setInstructionAck] = useState(false);
  // CR-38: one question at a time + countdown.
  const [current, setCurrent] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [tcChecked, setTcChecked] = useState(false); // CR-41: SOP T&C acknowledgement
  const answersRef = useRef<Record<string, Answer>>({});
  const submittedRef = useRef(false);
  const liveRef = useRef({ started: false, hasResult: false });
  const submitFnRef = useRef<(auto: boolean, reason?: string) => void>(() => {});
  const [activeMaterialIdx, setActiveMaterialIdx] = useState(0);
  const [secsLeft, setSecsLeft] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const startedRef = useRef<Set<string>>(new Set());
  const completedRef = useRef<Set<string>>(new Set());
  // A4: materials that were partially read in a previous session (resumed mid-way).
  const [resumed, setResumed] = useState<Set<string>>(new Set());
  // #7: materials whose file has finished loading in the viewer — the read-time timer
  // only starts once the active material is here, so load time isn't counted as reading.
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());
  // A4: throttle progress auto-saves (materialId → last-saved elapsed seconds).
  const savedElapsedRef = useRef<Record<string, number>>({});
  // BUG-05: actual wall-clock time the user keeps each material open (counts UP beyond
  // the required minimum), seeded from prior sessions and persisted as elapsedSeconds.
  const actualSpentRef = useRef<Record<string, number>>({});
  // A4: latest secsLeft reachable from the tick cleanup (to persist on material switch).
  const secsLeftRef = useRef<Record<string, number>>({});

  const tabBlocked = useSingleTabGuard(phase === 'assessment' && !result);

  // Resolve THIS topic's assignment so attempts link to it (drives the assignment's
  // status: IN_PROGRESS → COMPLETED on pass / BLOCKED on max attempts). Without this
  // the assignment would stay PENDING even after passing or exhausting attempts.
  const assignmentsQ = useQuery({
    queryKey: ['my-trainings'],
    queryFn: () => svc.assignments.mine() as unknown as Promise<{ id: string; topicId: string; status: string }[]>,
  });
  const assignmentId = useMemo(() => {
    const list = assignmentsQ.data ?? [];
    const forTopic = list.filter((a) => a.topicId === topicId);
    const active = forTopic.find((a) => !['COMPLETED', 'WAIVED'].includes(a.status));
    return (active ?? forTopic[0])?.id;
  }, [assignmentsQ.data, topicId]);

  const start = useMutation({
    mutationFn: () => svc.assessments.start({ topicId, assignmentId }) as unknown as Promise<StartResult>,
    onSuccess: () => setPhase('assessment'),
    onError: (e) => {
      // e.g. "Maximum attempts reached" — the assignment is now BLOCKED, so refresh
      // My Trainings to surface the "Request retake" action.
      qc.invalidateQueries({ queryKey: ['my-trainings'] });
      toast.error(apiError(e));
    },
  });
  const submit = useMutation({
    mutationFn: (opts?: { auto?: boolean; reason?: string }) =>
      svc.assessments.submit({
        attemptId: start.data?.attemptId,
        answers: answersRef.current,
        autoSubmitted: opts?.auto ?? false,
        // Distinct failure reason for the audit trail (server overrides on real time-out).
        reason: opts?.reason,
      }) as unknown as Promise<SubmitResult>,
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['my-trainings'] });
    },
    onError: (e) => {
      submittedRef.current = false; // allow a manual retry on transient failure
      toast.error(apiError(e));
    },
  });
  // CR-41: SOP / no-assessment topics complete via read + T&C acknowledgement.
  const ackComplete = useMutation({
    mutationFn: () => svc.assessments.acknowledgeRead({ topicId, assignmentId }) as unknown as Promise<SubmitResult>,
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['my-trainings'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const topicQ = useQuery({ queryKey: ['topic-meta', topicId], queryFn: () => svc.topics.get(topicId), enabled: !!topicId });
  const readingQ = useQuery({ queryKey: ['reading-status', topicId], queryFn: () => svc.materials.readingStatus(topicId) as unknown as Promise<ReadingItem[]>, enabled: !!topicId });
  // Global training instruction shown before reading (null when none is configured).
  const instructionQ = useQuery({
    queryKey: ['training-instruction'],
    queryFn: () => svc.materials.instruction() as unknown as Promise<{ id: string; originalFileName: string; fileType: string; version: number } | null>,
  });
  const instruction = instructionQ.data ?? null;
  // Skip the instruction step entirely when none is configured (unchanged flow).
  useEffect(() => {
    if (phase === 'instruction' && instructionQ.isSuccess && !instruction) setPhase('material');
  }, [phase, instructionQ.isSuccess, instruction]);
  const topicTitle = (topicQ.data as { title?: string } | undefined)?.title;
  // BUG-04: show the topic number alongside the title wherever the topic is named.
  const topicMeta0 = topicQ.data as { topicNumber?: string; topicCode?: string } | undefined;
  const topicNumber = topicMeta0?.topicNumber ?? topicMeta0?.topicCode;
  const topicLabel = topicTitle ? `${topicNumber ? `${topicNumber} – ` : ''}${topicTitle}` : undefined;
  const mats = useMemo(() => (readingQ.data ?? []) as ReadingItem[], [readingQ.data]);
  const active = mats[activeMaterialIdx];
  const allDone = mats.length === 0 || mats.every((m) => done.has(m.materialId));

  // Seed completed/required state once the reading status loads.
  // A4: resume — subtract any previously-saved elapsed time from the remaining countdown.
  useEffect(() => {
    if (!readingQ.isSuccess) return;
    const d = new Set<string>();
    const s: Record<string, number> = {};
    const r = new Set<string>();
    for (const m of mats) {
      if (m.isCompleted || m.requiredSeconds <= 0) d.add(m.materialId);
      const prior = Math.max(0, Math.floor(m.elapsedSeconds ?? 0));
      savedElapsedRef.current[m.materialId] = prior;
      actualSpentRef.current[m.materialId] = prior; // BUG-05: continue accruing actual time
      const remaining = Math.max(0, m.requiredSeconds - prior);
      s[m.materialId] = m.isCompleted ? 0 : remaining;
      if (!m.isCompleted && prior > 0 && m.requiredSeconds > 0) r.add(m.materialId);
    }
    setDone(d);
    setSecsLeft(s);
    setResumed(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingQ.isSuccess, mats.length]);

  // Record a server-side reading session when a material first becomes active — but only
  // once its file has actually loaded (#7), so the reading clock excludes load time.
  useEffect(() => {
    if (phase !== 'material' || !active || !readyIds.has(active.materialId) || done.has(active.materialId) || startedRef.current.has(active.materialId)) return;
    startedRef.current.add(active.materialId);
    svc.materials.startView(active.materialId).catch(() => undefined);
  }, [phase, active, done, readyIds]);

  // Tick the active material's countdown; on reaching zero, confirm completion server-side.
  // A4: every few seconds, persist accumulated reading time so a closed session resumes.
  // #7: do not start counting until the file has finished loading and is visible.
  useEffect(() => {
    if (phase !== 'material' || !active || done.has(active.materialId) || !readyIds.has(active.materialId)) return;
    const id = active.materialId;
    const required = active.requiredSeconds;
    const t = setInterval(() => {
      if (document.hidden) return;
      setSecsLeft((prev) => {
        const cur = prev[id] ?? 0;
        if (cur <= 1 && !completedRef.current.has(id)) {
          completedRef.current.add(id);
          svc.materials
            .completeView(id)
            .then(() => setDone((p) => new Set(p).add(id)))
            .catch(() => { completedRef.current.delete(id); });
        }
        const nextLeft = Math.max(0, cur - 1);
        // A4: throttle progress saves to roughly every 10s of reading.
        const elapsed = Math.max(0, required - nextLeft);
        const lastSaved = savedElapsedRef.current[id] ?? 0;
        if (required > 0 && elapsed - lastSaved >= 10) {
          savedElapsedRef.current[id] = elapsed;
          svc.materials.saveProgress(id, elapsed).catch(() => undefined);
        }
        return { ...prev, [id]: nextLeft };
      });
    }, 1000);
    return () => {
      clearInterval(t);
      // A4: persist the latest progress when leaving/switching the material.
      const left = secsLeftRef.current[id];
      if (required > 0 && left !== undefined && !completedRef.current.has(id)) {
        const elapsed = Math.max(0, required - left);
        if (elapsed > (savedElapsedRef.current[id] ?? 0)) {
          savedElapsedRef.current[id] = elapsed;
          svc.materials.saveProgress(id, elapsed).catch(() => undefined);
        }
      }
    };
  }, [phase, active, done, readyIds]);

  // A4: mirror secsLeft into a ref so the countdown cleanup can read the latest value.
  useEffect(() => {
    secsLeftRef.current = secsLeft;
  }, [secsLeft]);

  // BUG-05: capture the ACTUAL time spent on each material — keep counting while the
  // material is open and the tab is visible, even after the required minimum is met,
  // and persist it (stored as elapsedSeconds via a monotonic max on the server).
  useEffect(() => {
    // #7: only accrue actual reading time once the file is loaded and visible.
    if (phase !== 'material' || !active || !readyIds.has(active.materialId)) return;
    const id = active.materialId;
    const flush = () => svc.materials.saveProgress(id, actualSpentRef.current[id] ?? 0).catch(() => undefined);
    const t = setInterval(() => {
      if (document.hidden) return;
      actualSpentRef.current[id] = (actualSpentRef.current[id] ?? 0) + 1;
      if (actualSpentRef.current[id] % 10 === 0) flush();
    }, 1000);
    return () => {
      clearInterval(t);
      flush();
    };
  }, [phase, active, readyIds]);

  const questions = useMemo(() => start.data?.questions ?? [], [start.data]);

  // Keep the latest answers and lifecycle flags reachable from event handlers.
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  liveRef.current = { started: !!start.data, hasResult: !!result };
  submitFnRef.current = (auto: boolean, reason?: string) => {
    if (submittedRef.current || !start.data || result) return;
    submittedRef.current = true;
    submit.mutate({ auto, reason });
  };

  // CR-38: server-stamped countdown; auto-submit when it reaches zero.
  useEffect(() => {
    if (phase !== 'assessment' || !start.data?.expiresAt || result) return;
    const deadline = new Date(start.data.expiresAt).getTime();
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) submitFnRef.current(true, 'TIME_LIMIT_EXCEEDED');
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, start.data?.expiresAt, result]);

  // CR-38/39: leaving or closing a started assessment auto-submits it (one go, no resume).
  useEffect(() => {
    if (phase !== 'assessment') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!submittedRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Leaving with the test still open: record whether the cause was a lost connection
      // (offline) vs the tab/window being closed or navigated away.
      if (!submittedRef.current && liveRef.current.started && !liveRef.current.hasResult) {
        submitFnRef.current(true, typeof navigator !== 'undefined' && navigator.onLine === false ? 'NETWORK_FAILURE' : 'TAB_CLOSED');
      }
    };
  }, [phase]);

  // Assessment-phase guards (start runs only after reading is complete).
  if (phase === 'assessment' && start.isPending) return <PageLoader />;
  if (phase === 'assessment' && (start.isError || !start.data)) {
    return (
      <div>
        <PageHeader title="Assessment" />
        <Card>
          <CardContent>
            <p className="text-sm text-red-600">{apiError(start.error)}</p>
            <Link to="/assessments" className="mt-3 inline-block">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" /> Back to Assessments
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (result) {
    // BUG-07: the printout must mirror the full on-screen result — summary AND every
    // question with the user's answer, the correct answer and any explanation.
    const printResult = () => {
      const head = start.data?.topicNumber ?? start.data?.topicCode;
      const heading = `${head ? `${head} – ` : ''}${(start.data?.topicTitle ?? topicTitle) || 'Assessment'}`;
      const summary =
        `<table>` +
        `<tr><th>Result</th><td>${result.isPassed ? 'Passed' : 'Failed'}</td></tr>` +
        `<tr><th>Score</th><td>${result.score}%</td></tr>` +
        `<tr><th>Passing score</th><td>${result.passingScorePercent}%</td></tr>` +
        `<tr><th>Correct</th><td>${result.correctCount}</td></tr>` +
        `<tr><th>Incorrect</th><td>${result.incorrectCount}</td></tr>` +
        `<tr><th>Attempt</th><td>${result.attemptNumber} of ${result.maxAttempts}</td></tr>` +
        `<tr><th>Time on assessment</th><td>${fmtDuration(result.timeSpentSeconds)}</td></tr>` +
        `<tr><th>Time on reading</th><td>${fmtDuration(result.readingTimeSeconds)}</td></tr>` +
        `</table>`;
      const review = result.allDetails?.length ? result.allDetails : result.incorrectDetails ?? [];
      const questions = review
        .map(
          (d, i) =>
            `<div style="margin:10px 0;padding:8px 0;border-top:1px solid #ddd;">` +
            `<div><strong>${i + 1}. ${escapeHtml(d.questionText)}</strong>${d.isCorrect === true ? ' ✓' : d.isCorrect === false ? ' ✗' : ''}</div>` +
            `<div>Your answer: ${escapeHtml(formatCorrect(d.userAnswer) || '—')}</div>` +
            `<div>Correct answer: ${escapeHtml(formatCorrect(d.correctAnswer))}</div>` +
            `${d.explanation ? `<div>Explanation: ${escapeHtml(String(d.explanation))}</div>` : ''}` +
            `</div>`,
        )
        .join('');
      printHtml('Assessment Result', `<h2>${escapeHtml(heading)}</h2>${summary}${questions ? `<h3>Questions</h3>${questions}` : ''}`);
    };
    return (
      <div>
        <PageHeader
          title="Assessment Result"
          description={
            `${(start.data?.topicNumber ?? start.data?.topicCode ?? topicNumber) ? `${start.data?.topicNumber ?? start.data?.topicCode ?? topicNumber} – ` : ''}${start.data?.topicTitle ?? topicTitle ?? ''}`
          }
          actions={
            <Button variant="outline" onClick={printResult}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          }
        />
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              {result.isPassed ? <CheckCircle2 className="h-10 w-10 text-green-600" /> : <XCircle className="h-10 w-10 text-red-600" />}
              <div>
                <div className="text-3xl font-semibold text-slate-800">{result.score}%</div>
                <Badge tone={result.isPassed ? 'COMPLETED' : 'REJECTED'}>{result.isPassed ? 'Passed' : 'Failed'}</Badge>
              </div>
            </div>
            <div className="text-sm text-slate-600">
              <div>Passing score: {result.passingScorePercent}%</div>
              <div className="text-green-700">Correct: {result.correctCount}</div>
              <div className="text-red-700">Incorrect: {result.incorrectCount}</div>
              <div>
                Attempt {result.attemptNumber} of {result.maxAttempts}
              </div>
            </div>
            {/* BUG-05: actual time the user spent (not just the minimum required). */}
            <div className="text-sm text-slate-600">
              <div>Time on assessment: <strong>{fmtDuration(result.timeSpentSeconds)}</strong></div>
              <div>Time on reading: <strong>{fmtDuration(result.readingTimeSeconds)}</strong></div>
              {/* The recorded reason this attempt ended (transparency for technical failures). */}
              {result.submissionReasonLabel && result.submissionReason !== 'USER_SUBMITTED' && (
                <div>Ended due to: <strong>{result.submissionReasonLabel}</strong></div>
              )}
            </div>
          </CardContent>
        </Card>

        {result.isPassed && result.certificateId && (
          <p className="mb-4 text-sm">
            A certificate has been issued.{' '}
            <Link to="/certificates" className="font-medium text-primary hover:underline">
              View your certificates
            </Link>
            .
          </p>
        )}
        {result.isBlocked && (
          <p className="mb-4 text-sm text-red-600">You have reached the maximum number of attempts. This assessment is now blocked pending coordinator review.</p>
        )}

        {/* A2: full review — every question (correct + incorrect) with the user's answer,
            the correct answer and any explanation. Falls back to incorrect-only if the
            server didn't send the full breakdown. */}
        {(() => {
          const review = result.allDetails?.length ? result.allDetails : result.incorrectDetails;
          if (!review || review.length === 0) return null;
          const showingAll = !!result.allDetails?.length;
          return (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase text-slate-500">
                {showingAll ? 'Review — all questions' : 'Review — incorrect answers'}
              </h2>
              {review.map((d, i) => {
                const correct = d.isCorrect === true;
                return (
                  <Card key={d.questionId} className={correct ? 'border-green-200' : 'border-red-200'}>
                    <CardContent>
                      <div className="flex items-start gap-2">
                        {showingAll &&
                          (correct ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                          ) : (
                            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                          ))}
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800">
                            {i + 1}. {d.questionText}
                          </p>
                          <p className={`mt-1 text-sm ${correct ? 'text-green-700' : 'text-red-700'}`}>
                            Your answer: {formatCorrect(d.userAnswer) || '—'}
                          </p>
                          {!correct && <p className="mt-1 text-sm text-green-700">Correct answer: {formatCorrect(d.correctAnswer)}</p>}
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

        <Link to="/assessments" className="mt-6 inline-block">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4" /> Back to Assessments
          </Button>
        </Link>
      </div>
    );
  }

  // Instruction step — shown FIRST whenever a global training instruction is configured.
  // The trainee reads it in the locked viewer and must acknowledge before continuing to
  // the reading step. When no instruction exists, an effect advances straight to reading.
  if (phase === 'instruction') {
    if (instructionQ.isLoading || !instruction) return <PageLoader />;
    const proceed = () => {
      // Record the acknowledgement (best-effort — never block starting training on it).
      svc.materials.acknowledgeInstruction(instruction.id).catch(() => undefined);
      setPhase('material');
    };
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-400">Start Training · Instructions</div>
            <div className="truncate text-lg font-semibold text-slate-800">{topicLabel ?? 'Training Material'}</div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/my-trainings')}>Cancel</Button>
            <Button disabled={!instructionAck} onClick={proceed}>Continue</Button>
          </div>
        </div>
        <Card>
          <CardContent>
            <div className="mb-2 text-sm font-medium text-slate-700">Please read the instructions below before starting your training.</div>
            <InlineFileViewer materialId={instruction.id} fileName={instruction.originalFileName} fileType={instruction.fileType} heightClass="h-[72vh]" />
          </CardContent>
        </Card>
        {/* Checkbox AND a Continue button together at the bottom, so on small screens the
            acknowledgement and the action to proceed are always visible together (the top
            bar's Continue can scroll out of view under a tall document). */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={instructionAck} onChange={(e) => setInstructionAck(e.target.checked)} />
            I have read and understood the instructions.
          </label>
          <Button disabled={!instructionAck} onClick={proceed}>Continue</Button>
        </div>
      </div>
    );
  }

  // A1 reading-gate screen — a top course bar, a left chapter/material list with
  // overall progress, and the viewer. Each material must be read for its required time
  // (server-confirmed); the assessment only STARTS once all chapters are done. A4: the
  // remaining time resumes from previously-saved progress.
  if (phase === 'material') {
    const activeSecs = active ? secsLeft[active.materialId] ?? active.requiredSeconds : 0;
    const requiresAssessment = (topicQ.data as { requiresAssessment?: boolean } | undefined)?.requiresAssessment !== false;
    const totalChapters = mats.length;
    const doneCount = mats.filter((m) => done.has(m.materialId)).length;
    const progressPct = totalChapters ? Math.round((doneCount / totalChapters) * 100) : 100;
    const totalSeconds = mats.reduce((sum, m) => sum + (m.requiredSeconds || 0), 0);
    const fmt = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

    return (
      <div>
        {/* A1: top course header bar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-400">Start Training · Step 1 of 2 — Reading</div>
            <div className="truncate text-lg font-semibold text-slate-800">{topicLabel ?? 'Training Material'}</div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {totalSeconds > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-slate-600">
                <Clock className="h-4 w-4" /> Reading time: <strong>{fmt(totalSeconds)}</strong>
              </div>
            )}
            <div className="text-sm text-slate-600">
              Progress: <strong>{doneCount}/{totalChapters}</strong> · {progressPct}%
            </div>
            {/* BUG-11: Cancel returns cleanly to My Trainings (no error). */}
            <Button variant="ghost" onClick={() => navigate('/my-trainings')}>Cancel</Button>
            {requiresAssessment && (
              <Button disabled={!allDone || start.isPending} onClick={() => start.mutate()}>
                {start.isPending ? 'Starting…' : 'Continue to Assessment'}
              </Button>
            )}
          </div>
        </div>

        {/* A1: overall progress bar */}
        {totalChapters > 0 && (
          <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        )}

        {readingQ.isLoading ? (
          <PageLoader />
        ) : mats.length === 0 ? (
          <Card className="mb-4">
            <CardContent>
              <p className="text-sm text-slate-600">No reading material is attached to this training. You can proceed to the assessment.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            {/* A1: left chapter list */}
            <div className="space-y-1.5">
              <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Chapters</div>
              {mats.map((m, i) => {
                const isActive = i === activeMaterialIdx;
                const matDone = done.has(m.materialId);
                const remaining = secsLeft[m.materialId] ?? m.requiredSeconds;
                return (
                  <button
                    key={m.materialId}
                    type="button"
                    onClick={() => setActiveMaterialIdx(i)}
                    className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      isActive ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">
                      {matDone ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Clock className="h-4 w-4 text-slate-400" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-700">{i + 1}. {m.originalFileName}</span>
                      <span className="block text-xs text-slate-400">
                        {matDone
                          ? 'Read'
                          : m.requiredSeconds > 0
                          ? `${remaining}s left${resumed.has(m.materialId) ? ' · resumed' : ''}`
                          : 'Optional'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* viewer */}
            <div>
              {active && (
                <Card>
                  <CardContent>
                    <InlineFileViewer
                      materialId={active.materialId}
                      fileName={active.originalFileName}
                      fileType={active.fileType}
                      heightClass="h-[72vh]"
                      onReady={(mid) => setReadyIds((s) => (s.has(mid) ? s : new Set(s).add(mid)))}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* footer status + completion controls */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Clock className="h-4 w-4" />
            {mats.length === 0 || allDone ? (
              <span>Reading complete. {requiresAssessment ? 'You may start the assessment.' : 'Please confirm the acknowledgement to complete.'}</span>
            ) : active && done.has(active.materialId) ? (
              <span>This chapter is read. Open the remaining chapter(s) to finish.</span>
            ) : (
              <span>
                Keep this chapter open — <strong>{activeSecs}s</strong> remaining for "{active?.originalFileName}".
                {active && resumed.has(active.materialId) && <span className="ml-1 text-primary">(resumed)</span>}
              </span>
            )}
          </div>
          {!requiresAssessment && (
            <div className="flex flex-col items-end gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" disabled={!allDone} checked={tcChecked} onChange={(e) => setTcChecked(e.target.checked)} />
                I have read &amp; understood (I accept the Terms &amp; Conditions).
              </label>
              <Button disabled={!allDone || !tcChecked || ackComplete.isPending} onClick={() => ackComplete.mutate()}>
                {ackComplete.isPending ? 'Completing…' : 'Mark as read & complete'}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assessment phase — the attempt has been started (reading confirmed server-side).
  if (!start.data) return <PageLoader />;

  // CR-40: this assessment is already open in another tab.
  if (tabBlocked) {
    return (
      <div>
        <PageHeader title="Assessment" />
        <Card>
          <CardContent>
            <p className="text-sm text-red-600">
              This assessment is already open in another tab or window. To protect assessment integrity, it can only be taken in one place at a time. Close this tab and continue in the original one.
            </p>
            <Link to="/assessments" className="mt-3 inline-block">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" /> Back to Assessments
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const total = questions.length;
  const idx = Math.min(current, Math.max(0, total - 1));
  const q = questions[idx];
  const timed = !!start.data.assessmentTimeMinutes;
  const mm = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const ss = String(timeLeft % 60).padStart(2, '0');
  const isAnswered = (qid: string) => {
    const a = answers[qid];
    if (a === undefined || a === '') return false;
    if (Array.isArray(a)) return a.length > 0;
    if (typeof a === 'object') return Object.keys(a).length > 0;
    return true;
  };
  const answeredCount = questions.filter((qq) => isAnswered(qq.id)).length;
  const isLast = idx >= total - 1;

  function handleManualSubmit() {
    if (answeredCount < total && !window.confirm(`You have answered ${answeredCount} of ${total} questions. Submit now? This assessment cannot be resumed.`)) return;
    submitFnRef.current(false, 'USER_SUBMITTED');
  }

  const topicMeta = [start.data.topicNumber ?? start.data.topicCode, start.data.topicVersion ? `v${start.data.topicVersion}` : '']
    .filter(Boolean)
    .join(' • ');

  return (
    <div>
      <PageHeader
        title={start.data.topicTitle ? `Assessment: ${start.data.topicNumber ?? start.data.topicCode ? `${start.data.topicNumber ?? start.data.topicCode} – ` : ''}${start.data.topicTitle}` : 'Assessment'}
        description={`${topicMeta ? `${topicMeta} • ` : ''}Attempt ${start.data.attemptNumber} of ${start.data.maxAttempts}`}
        actions={
          timed ? (
            <div className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${timeLeft <= 30 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
              <Clock className="h-4 w-4" /> {mm}:{ss}
            </div>
          ) : undefined
        }
      />

      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        This is a single continuous attempt. Leaving this page{timed ? ' or letting the timer run out' : ''} will submit it automatically — you cannot resume.
      </div>

      <div className="mb-3 flex items-center justify-between text-sm text-slate-600">
        <span>
          Question {idx + 1} of {total}
        </span>
        <span>{answeredCount} answered</span>
      </div>

      {/* one-question-at-a-time navigator */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {questions.map((qq, i) => (
          <button
            key={qq.id}
            type="button"
            onClick={() => setCurrent(i)}
            className={`h-7 w-7 rounded text-xs font-medium ${i === idx ? 'bg-primary text-white' : isAnswered(qq.id) ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {q && <QuestionCard index={idx} question={q} answer={answers[q.id]} onChange={(a) => setAnswers((prev) => ({ ...prev, [q.id]: a }))} />}

      <div className="mt-6 flex items-center justify-between">
        <Button variant="outline" disabled={idx === 0} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>
          Previous
        </Button>
        {isLast ? (
          <Button onClick={handleManualSubmit} disabled={submit.isPending}>
            {submit.isPending ? 'Submitting…' : 'Submit Assessment'}
          </Button>
        ) : (
          <Button onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))}>Next</Button>
        )}
      </div>
    </div>
  );
}
