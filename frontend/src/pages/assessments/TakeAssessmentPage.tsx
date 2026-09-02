import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
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
import { useAuthStore } from '@/store/authStore';
import { formatDateTime } from '@/lib/format';

interface ReadingItem {
  materialId: string;
  originalFileName: string;
  fileType: string;
  requiredSeconds: number;
  isCompleted: boolean;
  elapsedSeconds?: number;
  /** Whether this type paginates at all (video/audio/image/text do not). */
  paginates?: boolean;
  /** True once the last page has been reached — always true for non-paginating types. */
  reachedLastPage?: boolean;
  /**
   * True when THIS response discarded a finished-but-unacknowledged run. The in-session reading
   * state must then be dropped instead of merged, or the run that was just discarded carries on.
   */
  wasReset?: boolean;
  /** Course version these figures belong to — progress is recorded per version. */
  topicVersion?: number;
  // /** Coverage state. totalPages null = coverage doesn't apply to this material. */
  // totalPages?: number | null;
  // pagesViewed?: number[];
  // pagesRemaining?: number;
  // isCovered?: boolean;
  // /** 'page' for paginated documents, 'sheet' for natively-rendered .xlsx workbooks. */
  // coverageUnit?: 'page' | 'sheet' | null;
// }
//
// /** Live coverage state per material, refreshed from the server as units are credited. */
// interface Coverage {
  // totalPages: number | null;
  // pagesViewed: number[];
  // isCovered: boolean;
  // coverageUnit: 'page' | 'sheet' | null;
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
  unattempted?: number;
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
 * Generation counter for the reading screen, shared by every mount of this page.
 *
 * A reading timer that outlives its own mount is catastrophic here: it keeps banking seconds
 * (and POSTing them) for a document nobody is looking at, which inflates the stored reading
 * time past the requirement — the file then auto-completes on its own, and the next visit shows
 * "0s left · resumed" because there is no remaining time left to count down. Timers therefore
 * capture the generation they were created in and stop themselves as soon as a newer mount
 * exists, which holds even if their effect cleanup never ran.
 */
let readingGeneration = 0;

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
  // The read-and-understood declaration. Required on BOTH paths: it gates the assessment, and
  // (CR-41) completes a reading-only course.
  const [tcChecked, setTcChecked] = useState(false);
  // Materials whose LAST page has been reached during this session (the server also persists it).
  const [lastPageSeen, setLastPageSeen] = useState<Set<string>>(new Set());
  // // The read-and-understood declaration. Required on BOTH paths: it gates the assessment,
  // // and (CR-41) completes a no-assessment SOP.
  // const [tcChecked, setTcChecked] = useState(false);
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
  // Course version the reading state in this session belongs to (see the seeding effect).
  const seenVersionRef = useRef<number | null>(null);
  // Incremented every time the server reports a reset. A reading clock started before the reset
  // still holds the discarded seconds in its closure, and its cleanup would write them back — so it
  // checks this first and stays silent if a reset has intervened.
  const resetSeqRef = useRef(0);
  // This mount's reading-timer generation; timers from an older mount must not keep running.
  const genRef = useRef(0);
  useEffect(() => {
    genRef.current = ++readingGeneration;
  }, []);
  // // Page-coverage control: server-confirmed coverage per material, plus the page currently
  // // on screen (reported by the viewer) so the reporting timer knows what to credit.
  // const [coverage, setCoverage] = useState<Record<string, Coverage>>({});
  // const currentPageRef = useRef<Record<string, number>>({});
  // const coverageRef = useRef<Record<string, Coverage>>({});

  const tabBlocked = useSingleTabGuard(phase === 'assessment' && !result);

  // Resolve THIS course's assignment so attempts link to it (drives the assignment's
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
  // Reaching the last page of a document is recorded server-side (best-effort) and mirrored
  // locally so the declaration unlocks immediately without waiting for a refetch.
  const onLastPageReached = useCallback((materialId: string) => {
    setLastPageSeen((prev) => (prev.has(materialId) ? prev : new Set(prev).add(materialId)));
    svc.materials.markLastPage(materialId).catch(() => undefined);
  }, []);

  // CR-41: SOP / no-assessment courses complete via read + T&C acknowledgement.
  const ackComplete = useMutation({
    mutationFn: () => svc.assessments.acknowledgeRead({ topicId, assignmentId }) as unknown as Promise<SubmitResult>,
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['my-trainings'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // // The read-and-understood declaration for this course version. Queried so a trainee who
  // // already declared (e.g. resuming after a failed attempt) sees it already confirmed.
  // const ackStatusQ = useQuery({
    // queryKey: ['course-ack', topicId],
    // queryFn: () => svc.assessments.acknowledgementStatus(topicId) as unknown as Promise<{ acknowledged: boolean; statementText: string }>,
    // enabled: !!topicId,
  // });
  // const ackStatement = ackStatusQ.data?.statementText ?? 'I have read and understood the training contents.';
  // useEffect(() => {
    // if (ackStatusQ.data?.acknowledged) setTcChecked(true);
  // }, [ackStatusQ.data?.acknowledged]);
//
  // // Record the declaration, then start the assessment. The server independently re-checks
  // // both the reading controls and the acknowledgement, so this ordering is convenience,
  // // not the control itself.
  // const ackTopic = useMutation({
    // mutationFn: () => svc.assessments.acknowledgeTopic(topicId),
    // onSuccess: () => {
      // qc.invalidateQueries({ queryKey: ['course-ack', topicId] });
      // start.mutate();
    // },
    // onError: (e) => toast.error(apiError(e)),
  // });
//
  const topicQ = useQuery({ queryKey: ['topic-meta', topicId], queryFn: () => svc.topics.get(topicId), enabled: !!topicId });
  // The reading status is the AUTHORITY for the read-and-understood gate, and fetching it is what
  // applies the reset-if-unacknowledged rule server-side. It must therefore hit the server every
  // time this screen opens: with the app-wide 30s staleTime, re-entering a course quickly served a
  // cached snapshot, so the reset never ran (and stale progress was rendered).
  const readingQ = useQuery({
    queryKey: ['reading-status', topicId],
    queryFn: () => svc.materials.readingStatus(topicId) as unknown as Promise<ReadingItem[]>,
    enabled: !!topicId,
    staleTime: 0,
    refetchOnMount: 'always',
  });
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
  // BUG-04: show the course number alongside the title wherever the course is named.
  const topicMeta0 = topicQ.data as { topicNumber?: string; topicCode?: string } | undefined;
  const topicNumber = topicMeta0?.topicNumber ?? topicMeta0?.topicCode;
  const topicLabel = topicTitle ? `${topicNumber ? `${topicNumber} – ` : ''}${topicTitle}` : undefined;
  const mats = useMemo(() => (readingQ.data ?? []) as ReadingItem[], [readingQ.data]);
  const active = mats[activeMaterialIdx];
  const allDone = mats.length === 0 || mats.every((m) => done.has(m.materialId));
  // End-of-document gate: every paginated file must have had its LAST page reached (server-recorded,
  // plus anything reached in this session). Non-paginating types are always satisfied.
  const allEndsReached =
    mats.length > 0 &&
    mats.every((m) => m.paginates === false || m.reachedLastPage === true || lastPageSeen.has(m.materialId));
  // The read-and-understood declaration only becomes available once the required reading TIME is
  // met for every file AND the end of every document has been reached.
  const ackAvailable = allDone && allEndsReached;

  // Tell the server the moment the declaration actually becomes visible. The reset-instead-of-
  // resume rule keys off this recorded fact, so a run where the tick box never appeared is always
  // resumed. Fired once per visit.
  const ackShownRef = useRef(false);
  useEffect(() => {
    if (phase !== 'material' || !ackAvailable || ackShownRef.current || !topicId) return;
    ackShownRef.current = true;
    svc.materials.markAckAvailable(topicId).catch(() => undefined);
  }, [phase, ackAvailable, topicId]);

  // Seed completed/required state from the reading status. Keyed on `dataUpdatedAt` so it re-seeds
  // whenever a NEW server snapshot arrives — React Query renders the previous (cached) snapshot
  // first on re-entry, and without re-seeding the screen kept showing that stale state. The server
  // is authoritative; anything this session has already achieved is unioned in so nothing in
  // flight is lost. The query only fetches on mount, so this runs at most twice per visit.
  // A4: resume — subtract any previously-saved elapsed time from the remaining countdown.
  useEffect(() => {
    if (!readingQ.isSuccess) return;
    // A reset discards the whole run, so everything this session is holding has to go with it —
    // seconds banked, files marked read, ends reached. Merging any of it back is what let a reset
    // course carry straight on from the progress that had just been discarded.
    //
    // Republishing the course has the same effect for the same reason: progress is recorded per
    // course version, so a new version legitimately starts the reading again — and the state held
    // for the old version must not be merged over it. Unlike a reset this can happen while the
    // trainee is mid-read, so it is called out rather than left looking like lost progress.
    const serverVersion = mats.find((m) => m.topicVersion != null)?.topicVersion;
    const versionChanged = serverVersion != null && seenVersionRef.current != null && serverVersion !== seenVersionRef.current;
    if (serverVersion != null) seenVersionRef.current = serverVersion;
    if (versionChanged) {
      toast.info(`This course has been updated to version ${serverVersion}. The reading starts again so you cover the new content.`);
    }
    const wasReset = mats.some((m) => m.wasReset) || versionChanged;
    if (wasReset) {
      resetSeqRef.current += 1;
      actualSpentRef.current = {};
      savedElapsedRef.current = {};
      completedRef.current = new Set();
      startedRef.current = new Set();
      ackShownRef.current = false;
      setTcChecked(false);
    }
    const d = new Set<string>();
    const s: Record<string, number> = {};
    const r = new Set<string>();
    for (const m of mats) {
      // Only a material the SERVER has recorded as read counts as done — plus anything completed
      // in THIS session (the confirmation may still be in flight). A file with no required reading
      // time is NOT auto-completed: the trainee must still open it (and reach its end).
      const doneNow = m.isCompleted || completedRef.current.has(m.materialId);
      if (doneNow) d.add(m.materialId);
      const prior = Math.max(0, Math.floor(m.elapsedSeconds ?? 0));
      savedElapsedRef.current[m.materialId] = Math.max(savedElapsedRef.current[m.materialId] ?? 0, prior);
      actualSpentRef.current[m.materialId] = Math.max(actualSpentRef.current[m.materialId] ?? 0, prior);
      const remaining = Math.max(0, m.requiredSeconds - prior);
      s[m.materialId] = doneNow ? 0 : remaining;
      if (!doneNow && prior > 0 && m.requiredSeconds > 0) r.add(m.materialId);
    }
    setDone(d);
    setSecsLeft(s);
    setResumed(r);
    // End-of-document: adopt the server's record, keeping anything reached in this session — unless
    // the run was just reset, in which case the server's record is the only truth.
    setLastPageSeen((prev) => {
      const next = new Set<string>();
      for (const m of mats) if (m.reachedLastPage || (!wasReset && prev.has(m.materialId))) next.add(m.materialId);
      return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingQ.dataUpdatedAt, readingQ.isSuccess]);

  // // Mirror coverage into a ref so the reporting timer and the countdown can read the latest
  // // value without re-subscribing on every credited page.
  // useEffect(() => {
    // coverageRef.current = coverage;
  // }, [coverage]);
//
  // /**
   // * Report the page on screen every couple of seconds while a material is open. The server
   // * decides whether it has been dwelled on long enough to credit, so this only has to keep
   // * telling it where the trainee is — no client-side timing is trusted.
   // */
  // useEffect(() => {
    // if (phase !== 'material' || !active || !readyIds.has(active.materialId)) return;
    // const id = active.materialId;
    // const t = setInterval(() => {
      // if (document.hidden) return;
      // const cov = coverageRef.current[id];
      // if (cov && (cov.totalPages == null || cov.isCovered)) return; // nothing left to credit
      // const page = currentPageRef.current[id];
      // if (!page) return;
      // svc.materials
        // .recordPage(id, page)
        // .then((res) => {
          // const next = res as unknown as Coverage & { materialId: string };
          // setCoverage((prev) => ({
            // ...prev,
            // [id]: {
              // totalPages: next.totalPages ?? null,
              // pagesViewed: next.pagesViewed ?? [],
              // isCovered: !!next.isCovered,
              // coverageUnit: next.coverageUnit ?? prev[id]?.coverageUnit ?? null,
            // },
          // }));
        // })
        // .catch(() => undefined);
    // }, 2000);
    // return () => clearInterval(t);
  // }, [phase, active, readyIds]);
//
  // Record a server-side reading session when a material first becomes active — but only
  // once its file has actually loaded (#7), so the reading clock excludes load time.
  useEffect(() => {
    if (phase !== 'material' || !active || !readyIds.has(active.materialId) || done.has(active.materialId) || startedRef.current.has(active.materialId)) return;
    startedRef.current.add(active.materialId);
    svc.materials.startView(active.materialId).catch(() => undefined);
  }, [phase, active, done, readyIds]);

  // The active material's reading clock: ONE wall-clock measure drives the countdown shown on
  // screen, the value persisted for resume, and the completion call.
  //
  // This used to be two timers — a countdown that decremented once per interval tick, and a
  // separate wall-clock accrual — and they disagreed whenever the browser throttled timers
  // (background/inactive tabs get far fewer than one tick per second). The visible clock then ran
  // slower than real time, so the number the trainee watched count down, the seconds banked for
  // resume, and the figure sent to the server were three different quantities.
  //
  // #7: do not start counting until the file has finished loading and is visible, so load time is
  // never counted as reading time. Time while the tab is hidden is not counted either.
  useEffect(() => {
    if (phase !== 'material' || !active || done.has(active.materialId) || !readyIds.has(active.materialId)) return;
    const id = active.materialId;
    const required = active.requiredSeconds;
    const gen = genRef.current;
    const seq = resetSeqRef.current;
    // Seconds already banked for this material (server-seeded, so a resumed session continues
    // from where it stopped) plus the visible time accrued since this clock started.
    const base = actualSpentRef.current[id] ?? 0;
    let visibleMs = 0;
    let since: number | null = document.hidden ? null : Date.now();
    const settle = () => {
      if (since !== null) {
        visibleMs += Date.now() - since;
        since = document.hidden ? null : Date.now();
      } else if (!document.hidden) {
        since = Date.now();
      }
    };
    // Derived from elapsed time, never accumulated by incrementing a counter: a duplicated or
    // throttled timer recomputes the same value instead of drifting from real time.
    const spent = () => {
      settle();
      return base + Math.floor(visibleMs / 1000);
    };
    const onVisibility = () => settle();
    document.addEventListener('visibilitychange', onVisibility);
    let lastFlushed = base;
    const stop = () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    const save = (v: number) => {
      lastFlushed = v;
      savedElapsedRef.current[id] = v;
      svc.materials.saveProgress(id, v).catch(() => undefined);
    };
    const t = setInterval(() => {
      // A clock left running by a superseded mount would keep banking time for a document that is
      // no longer on screen, and march to zero unattended — completing the material on its own.
      if (gen !== readingGeneration || seq !== resetSeqRef.current) return stop();
      const v = spent();
      actualSpentRef.current[id] = v;
      setSecsLeft((prev) => (prev[id] === Math.max(0, required - v) ? prev : { ...prev, [id]: Math.max(0, required - v) }));
      if (v + 1 >= required && !completedRef.current.has(id)) {
        completedRef.current.add(id);
        // The same measured value is what the server validates the requirement against, so the
        // screen, the stored figure and the completion can no longer disagree.
        svc.materials
          .completeView(id, v)
          .then(() => setDone((p) => new Set(p).add(id)))
          .catch(() => { completedRef.current.delete(id); });
      }
      // Persist roughly every 5s of reading, so leaving early loses at most a few seconds even if
      // the flush below never lands.
      if (v - lastFlushed >= 5) save(v);
    }, 1000);
    return () => {
      stop();
      // Seconds measured before a reset belong to the discarded run and must not be written back.
      if (seq !== resetSeqRef.current) return;
      const v = spent();
      actualSpentRef.current[id] = v;
      if (v > lastFlushed) save(v);
    };
  }, [phase, active, done, readyIds]);


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
    // A reading-only course (requiresAssessment = false) is completed by read + acknowledge and
    // has no questions — so there is no score/pass-fail to report. Present it as a completion
    // record rather than an assessment result.
    const isReadingCompletion = (result.totalQuestions ?? 0) === 0;
    // BUG-07: the printout must mirror the full on-screen result — summary AND every
    // question with the user's answer, the correct answer and any explanation.
    const printResult = async () => {
      const head = start.data?.topicNumber ?? start.data?.topicCode;
      const heading = `${head ? `${head} – ` : ''}${(start.data?.topicTitle ?? topicTitle) || 'Assessment'}`;
      const me = useAuthStore.getState().user;
      // Pull the signed-in user's profile so the printout can show their Department (name),
      // matching the completed-attempts print. Self-scoped endpoint — falls back gracefully.
      const profile = (await svc.users.myProfile().catch(() => null)) as
        | { fullName?: string; employeeId?: string; departmentName?: string | null }
        | null;
      const employeeName = profile?.fullName || me?.fullName || '—';
      const employeeCode = profile?.employeeId || me?.employeeId || '—';
      const department = profile?.departmentName || '—';
      const completedOn = formatDateTime(new Date().toISOString());
      const passed = result.isPassed;
      const accent = isReadingCompletion ? '#15803d' : passed ? '#15803d' : '#b91c1c';
      const accentBg = isReadingCompletion ? '#dcfce7' : passed ? '#dcfce7' : '#fee2e2';
      // A reading-only course has no score to report — show a plain completion banner instead
      // of a pass/fail + percentage (there was no assessment).
      const banner = isReadingCompletion
        ? `<div style="border:1px solid ${accent};background:${accentBg};border-radius:8px;padding:12px 16px;margin:14px 0;">` +
          `<div style="font-size:18px;font-weight:700;letter-spacing:.03em;color:${accent};">COMPLETED</div>` +
          `<div style="font-size:11px;color:#64748b;margin-top:2px;">Read &amp; acknowledged — no assessment for this course</div>` +
          `</div>`
        : `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;` +
        `border:1px solid ${accent};background:${accentBg};border-radius:8px;padding:12px 16px;margin:14px 0;">` +
        `<div style="font-size:18px;font-weight:700;letter-spacing:.03em;color:${accent};">${passed ? 'PASSED' : 'FAILED'}</div>` +
        `<div style="text-align:right;color:#334155;">` +
        `<div style="font-size:22px;font-weight:700;line-height:1;">${result.score}%</div>` +
        `<div style="font-size:11px;color:#64748b;margin-top:2px;">Passing score ${result.passingScorePercent}%</div>` +
        `</div></div>`;
      const cell = (label: string, value: string) =>
        `<td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #eef2f7;width:33%;">` +
        `<div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:2px;">${escapeHtml(label)}</div>` +
        `<div style="font-size:13px;font-weight:600;color:#1e293b;">${value}</div></td>`;
      const row = (...cells: string[]) => `<tr>${cells.join('')}</tr>`;
      const blank = `<td style="border-bottom:1px solid #eef2f7;"></td>`;
      const identityRow = row(
        cell('Employee', escapeHtml(employeeName)),
        cell('Employee ID', escapeHtml(employeeCode)),
        cell('Department', escapeHtml(department)),
      );
      // Reading-only completion: identity + when + reading time. No score/question counts.
      const details = isReadingCompletion
        ? `<table style="width:100%;border-collapse:collapse;margin:6px 0 4px;">` +
          identityRow +
          row(
            cell('Completed On', escapeHtml(completedOn)),
            cell('Completion Method', 'Read &amp; acknowledged'),
            cell('Time on Reading', fmtDuration(result.readingTimeSeconds)),
          ) +
          `</table>`
        : `<table style="width:100%;border-collapse:collapse;margin:6px 0 4px;">` +
          identityRow +
          row(
            cell('Completed On', escapeHtml(completedOn)),
            cell('Attempt', `${result.attemptNumber} of ${result.maxAttempts}`),
            cell('Correct', String(result.correctCount)),
          ) +
          row(
            cell('Incorrect', String(result.incorrectCount)),
            cell('Unattempted', String(result.unattempted ?? 0)),
            cell('Time on Assessment', fmtDuration(result.timeSpentSeconds)),
          ) +
          row(cell('Time on Reading', fmtDuration(result.readingTimeSeconds)), blank, blank) +
          `</table>`;
      const summary = banner + details;
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
      const docTitle = isReadingCompletion ? 'Training Completion Record' : 'Assessment Result';
      printHtml(
        docTitle,
        `<h1>${escapeHtml(heading)}</h1><div class="sub">${docTitle}</div>${summary}${questions ? `<div class="section">Question Review</div>${questions}` : ''}`,
      );
    };
    return (
      <div>
        <PageHeader
          title={isReadingCompletion ? 'Training Completed' : 'Assessment Result'}
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
          {isReadingCompletion ? (
            /* Reading-only course: no assessment, so no score / pass-fail / question counts. */
            <CardContent className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
                <div>
                  <Badge tone="COMPLETED">Completed</Badge>
                  <div className="mt-1 text-sm text-slate-600">Read &amp; acknowledged</div>
                </div>
              </div>
              <div className="text-sm text-slate-600">
                <div>Time on reading: <strong>{fmtDuration(result.readingTimeSeconds)}</strong></div>
                <div className="text-slate-500">This course has no assessment.</div>
              </div>
            </CardContent>
          ) : (
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
                <div className="text-slate-500">Unattempted: {result.unattempted ?? 0}</div>
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
          )}
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
    // // Already-acknowledged trainees skip straight to starting the assessment.
    // const beginAssessment = () => (ackStatusQ.data?.acknowledged ? start.mutate() : ackTopic.mutate());
    // /** Pages still to be read for a material, or 0 when coverage doesn't apply to it. */
    // const pagesLeftFor = (materialId: string) => {
      // const cov = coverage[materialId];
      // if (!cov || cov.totalPages == null) return 0;
      // const seen = cov.pagesViewed.filter((p) => p >= 1 && p <= cov.totalPages!).length;
      // return Math.max(0, cov.totalPages - seen);
    // };
    // const activePagesLeft = active ? pagesLeftFor(active.materialId) : 0;
    // const activeCov = active ? coverage[active.materialId] : undefined;
    // /** "page"/"sheet" — a workbook is measured in worksheets, not print pages. */
    // const unitLabel = (materialId: string, plural = false) => {
      // const u = coverage[materialId]?.coverageUnit === 'sheet' ? 'sheet' : 'page';
      // return plural ? `${u}s` : u;
    // };
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
            {requiresAssessment && (
              <Button
                disabled={!ackAvailable || !tcChecked || start.isPending}
                title={
                  !ackAvailable
                    ? 'Read every file for its required time and reach the end of each document first.'
                    : !tcChecked
                      ? 'Confirm the acknowledgement below to continue.'
                      : undefined
                }
                onClick={() => start.mutate()}
              >
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
                // const cov = coverage[m.materialId];
                // const pagesLeft = pagesLeftFor(m.materialId);
                // // Page progress is the primary signal once the timer is satisfied, since
                // // that is then the only thing still standing between the trainee and the tick.
                // const pageNote =
                  // cov?.totalPages != null
                    // ? `${cov.totalPages - pagesLeft}/${cov.totalPages} ${unitLabel(m.materialId, true)}`
                    // : null;
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
                        {/* : [
                              m.requiredSeconds > 0 ? `${remaining}s left` : null,
                              pageNote,
                              resumed.has(m.materialId) ? 'resumed' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ') || 'Optional'} */}
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
                      // Unlocks the read-and-understood declaration once the end of every
                      // document has been reached (no per-page tracking — see onLastPage).
                      onLastPage={onLastPageReached}
                      // // Only records WHERE the trainee is. The page count and whether coverage
                      // // applies at all come from the server (reading-status), which is the sole
                      // // authority — a client-reported total could otherwise either weaken the
                      // // control or block a material the server never intends to gate on pages.
                      // onPageChange={(mid, page) => {
                        // currentPageRef.current[mid] = page;
                      // }}
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
            ) : active && !readyIds.has(active.materialId) ? (
              // #7: the reading clock deliberately excludes load time, but nothing used to say so —
              // time spent waiting for a large document looked like reading time, and then appeared
              // to have been lost on the next visit.
              <span>
                Loading "{active.originalFileName}" — the reading time starts once the document is on screen.
              </span>
            ) : (
              <span>
                Keep this chapter open — <strong>{activeSecs}s</strong> remaining for "{active?.originalFileName}".
                {/* Keep this chapter open
                {activeSecs > 0 && (
                  <>
                    {' '}
                    — <strong>{activeSecs}s</strong> remaining
                  </>
                )}
                {activePagesLeft > 0 && active && (
                  <>
                    {activeSecs > 0 ? ' and ' : ' — '}
                    <strong>
                      {activePagesLeft} of {activeCov?.totalPages} {unitLabel(active.materialId, activePagesLeft !== 1)}
                    </strong>{' '}
                    still to read
                  </>
                )}{' '}
                for "{active?.originalFileName}". */}
                {active && resumed.has(active.materialId) && <span className="ml-1 text-primary">(resumed)</span>}
              </span>
            )}
          </div>
          {/* No document attached → nothing to read, so the read-and-understood declaration is
              meaningless and must not be offered (the server refuses it too). */}
          {!requiresAssessment && mats.length === 0 && (
            <p className="text-sm text-amber-700">
              This course has no training document yet, so it cannot be completed. Please contact your administrator.
            </p>
          )}
          {/* The read-and-understood declaration, shown on BOTH paths and only once the reading
              is genuinely finished: the required TIME is met for every file AND the end of every
              document has been reached. On a reading-only course it completes the training; on an
              assessment course it unlocks the assessment. Both are re-verified server-side. */}
          {mats.length > 0 && ackAvailable && (
            <div className="flex flex-col items-end gap-2">
              {/* This declaration is about the COURSE CONTENT. It is NOT the global
                  instruction-file acknowledgement — that has its own checkbox on the instruction
                  step, which only appears when an instruction file is configured. */}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={tcChecked} onChange={(e) => setTcChecked(e.target.checked)} />
                I have read and understood the training contents.
              </label>
              {!requiresAssessment && (
                <Button disabled={!tcChecked || ackComplete.isPending} onClick={() => ackComplete.mutate()}>
                  {ackComplete.isPending ? 'Completing…' : 'Mark as read & complete'}
                </Button>
              )}
            </div>
          )}
        </div>
        {/* Why the tick box isn't available yet — naming the outstanding files, otherwise its
            absence just looks broken and there is no way to tell what is missing. */}
        {mats.length > 0 && !ackAvailable && (
          <div className="mt-3 text-xs text-slate-400">
            <p>
              The “I have read and understood the training contents.” confirmation becomes available once every file has been
              read for its required time and you have reached the end of every document.
            </p>
            {(() => {
              const needsTime = mats.filter((m) => !done.has(m.materialId));
              const needsEnd = mats.filter(
                (m) => m.paginates !== false && m.reachedLastPage !== true && !lastPageSeen.has(m.materialId),
              );
              return (
                <>
                  {needsTime.length > 0 && (
                    <p className="mt-1">Still to read for the required time: {needsTime.map((m) => m.originalFileName).join(', ')}.</p>
                  )}
                  {needsEnd.length > 0 && (
                    <p className="mt-1">Scroll to the end of: {needsEnd.map((m) => m.originalFileName).join(', ')}.</p>
                  )}
                </>
              );
            })()}
          </div>
        )}
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
