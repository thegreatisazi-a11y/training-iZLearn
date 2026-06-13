import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, ArrowLeft, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
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
  certificateId?: string;
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
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  // Phase 6 / reading-gate: questions are gated behind per-material timed reading,
  // and the attempt is only STARTED once the server confirms reading is complete.
  const [phase, setPhase] = useState<'material' | 'assessment'>('material');
  // CR-38: one question at a time + countdown.
  const [current, setCurrent] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [tcChecked, setTcChecked] = useState(false); // CR-41: SOP T&C acknowledgement
  const answersRef = useRef<Record<string, Answer>>({});
  const submittedRef = useRef(false);
  const liveRef = useRef({ started: false, hasResult: false });
  const submitFnRef = useRef<(auto: boolean) => void>(() => {});
  const [activeMaterialIdx, setActiveMaterialIdx] = useState(0);
  const [secsLeft, setSecsLeft] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const startedRef = useRef<Set<string>>(new Set());
  const completedRef = useRef<Set<string>>(new Set());

  const tabBlocked = useSingleTabGuard(phase === 'assessment' && !result);

  const start = useMutation({
    mutationFn: () => svc.assessments.start({ topicId }) as unknown as Promise<StartResult>,
    onSuccess: () => setPhase('assessment'),
    onError: (e) => toast.error(apiError(e)),
  });
  const submit = useMutation({
    mutationFn: (opts?: { auto?: boolean }) =>
      svc.assessments.submit({
        attemptId: start.data?.attemptId,
        answers: answersRef.current,
        autoSubmitted: opts?.auto ?? false,
      }) as unknown as Promise<SubmitResult>,
    onSuccess: (r) => setResult(r),
    onError: (e) => {
      submittedRef.current = false; // allow a manual retry on transient failure
      toast.error(apiError(e));
    },
  });
  // CR-41: SOP / no-assessment topics complete via read + T&C acknowledgement.
  const ackComplete = useMutation({
    mutationFn: () => svc.assessments.acknowledgeRead({ topicId }) as unknown as Promise<SubmitResult>,
    onSuccess: (r) => setResult(r),
    onError: (e) => toast.error(apiError(e)),
  });

  const topicQ = useQuery({ queryKey: ['topic-meta', topicId], queryFn: () => svc.topics.get(topicId), enabled: !!topicId });
  const readingQ = useQuery({ queryKey: ['reading-status', topicId], queryFn: () => svc.materials.readingStatus(topicId) as unknown as Promise<ReadingItem[]>, enabled: !!topicId });
  const topicTitle = (topicQ.data as { title?: string } | undefined)?.title;
  const mats = useMemo(() => (readingQ.data ?? []) as ReadingItem[], [readingQ.data]);
  const active = mats[activeMaterialIdx];
  const allDone = mats.length === 0 || mats.every((m) => done.has(m.materialId));

  // Seed completed/required state once the reading status loads.
  useEffect(() => {
    if (!readingQ.isSuccess) return;
    const d = new Set<string>();
    const s: Record<string, number> = {};
    for (const m of mats) {
      if (m.isCompleted || m.requiredSeconds <= 0) d.add(m.materialId);
      s[m.materialId] = m.isCompleted ? 0 : m.requiredSeconds;
    }
    setDone(d);
    setSecsLeft(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingQ.isSuccess, mats.length]);

  // Record a server-side reading session when a material first becomes active.
  useEffect(() => {
    if (phase !== 'material' || !active || done.has(active.materialId) || startedRef.current.has(active.materialId)) return;
    startedRef.current.add(active.materialId);
    svc.materials.startView(active.materialId).catch(() => undefined);
  }, [phase, active, done]);

  // Tick the active material's countdown; on reaching zero, confirm completion server-side.
  useEffect(() => {
    if (phase !== 'material' || !active || done.has(active.materialId)) return;
    const id = active.materialId;
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
        return { ...prev, [id]: Math.max(0, cur - 1) };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase, active, done]);

  const questions = useMemo(() => start.data?.questions ?? [], [start.data]);

  // Keep the latest answers and lifecycle flags reachable from event handlers.
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  liveRef.current = { started: !!start.data, hasResult: !!result };
  submitFnRef.current = (auto: boolean) => {
    if (submittedRef.current || !start.data || result) return;
    submittedRef.current = true;
    submit.mutate({ auto });
  };

  // CR-38: server-stamped countdown; auto-submit when it reaches zero.
  useEffect(() => {
    if (phase !== 'assessment' || !start.data?.expiresAt || result) return;
    const deadline = new Date(start.data.expiresAt).getTime();
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) submitFnRef.current(true);
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
      if (!submittedRef.current && liveRef.current.started && !liveRef.current.hasResult) submitFnRef.current(true);
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
    return (
      <div>
        <PageHeader title="Assessment Result" description={start.data?.topicTitle ?? topicTitle} />
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

        {!result.isPassed && result.incorrectDetails && result.incorrectDetails.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase text-slate-500">Review</h2>
            {result.incorrectDetails.map((d) => (
              <Card key={d.questionId}>
                <CardContent>
                  <p className="font-medium text-slate-800">{d.questionText}</p>
                  <p className="mt-1 text-sm text-green-700">Correct answer: {formatCorrect(d.correctAnswer)}</p>
                  {d.explanation && <p className="mt-1 text-sm text-slate-600">{d.explanation}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Link to="/assessments" className="mt-6 inline-block">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4" /> Back to Assessments
          </Button>
        </Link>
      </div>
    );
  }

  // Reading-gate step — each material must be read for its required time (server
  // confirms each completion). The assessment is only STARTED once all are done.
  if (phase === 'material') {
    const activeSecs = active ? secsLeft[active.materialId] ?? active.requiredSeconds : 0;
    const activeDone = active ? done.has(active.materialId) : true;
    return (
      <div>
        <PageHeader
          title={topicTitle ? `Training: ${topicTitle}` : 'Training Material'}
          description="Step 1 of 2 — Review each training material for its required time before the assessment"
          actions={
            <Button variant="ghost" onClick={() => navigate('/assessments')}>
              Cancel
            </Button>
          }
        />
        {readingQ.isLoading ? (
          <PageLoader />
        ) : mats.length === 0 ? (
          <Card className="mb-4">
            <CardContent>
              <p className="text-sm text-slate-600">No reading material is attached to this training. You can proceed to the assessment.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {mats.map((m, i) => (
                <Button key={m.materialId} size="sm" variant={i === activeMaterialIdx ? 'primary' : 'outline'} onClick={() => setActiveMaterialIdx(i)}>
                  {done.has(m.materialId) ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Clock className="h-3.5 w-3.5" />} {m.originalFileName}
                </Button>
              ))}
            </div>
            {active && (
              <Card className="mb-4">
                <CardContent>
                  <InlineFileViewer materialId={active.materialId} fileName={active.originalFileName} fileType={active.fileType} heightClass="h-[72vh]" />
                </CardContent>
              </Card>
            )}
          </>
        )}
        {(() => {
          const requiresAssessment = (topicQ.data as { requiresAssessment?: boolean } | undefined)?.requiresAssessment !== false;
          return (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Clock className="h-4 w-4" />
                {mats.length === 0 || allDone ? (
                  <span>Reading complete. {requiresAssessment ? 'You may start the assessment.' : 'Please confirm the acknowledgement to complete.'}</span>
                ) : activeDone ? (
                  <span>This material is read. Open the remaining material(s) to finish.</span>
                ) : (
                  <span>Keep this material open — <strong>{activeSecs}s</strong> remaining for "{active?.originalFileName}".</span>
                )}
              </div>
              {requiresAssessment ? (
                <Button disabled={!allDone || start.isPending} onClick={() => start.mutate()}>
                  {start.isPending ? 'Starting…' : 'Continue to assessment'}
                </Button>
              ) : (
                <div className="flex flex-col items-end gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" disabled={!allDone} checked={tcChecked} onChange={(e) => setTcChecked(e.target.checked)} />
                    I have read &amp; understood (I accept the Terms &amp; Conditions).
                  </label>
                  <Button disabled={!allDone || !tcChecked || ackComplete.isPending} onClick={() => ackComplete.mutate()}>
                    {ackComplete.isPending ? 'Completing…' : 'Mark as read &amp; complete'}
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
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
    submitFnRef.current(false);
  }

  const topicMeta = [start.data.topicNumber ?? start.data.topicCode, start.data.topicVersion ? `v${start.data.topicVersion}` : '']
    .filter(Boolean)
    .join(' • ');

  return (
    <div>
      <PageHeader
        title={start.data.topicTitle ? `Assessment: ${start.data.topicTitle}` : 'Assessment'}
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
