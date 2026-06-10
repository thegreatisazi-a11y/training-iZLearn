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
interface MatchPair {
  left: string;
  right: string;
}
interface AssessmentQuestion {
  id: string;
  questionText: string;
  questionType: string;
  options?: QuestionOption[] | MatchPair[] | null;
}
interface StartResult {
  attemptId: string;
  attemptNumber: number;
  maxAttempts: number;
  topicTitle?: string;
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

type Answer = string | string[];

function asOptions(q: AssessmentQuestion): QuestionOption[] {
  return Array.isArray(q.options) ? (q.options as QuestionOption[]).filter((o) => o && 'id' in o) : [];
}
function asPairs(q: AssessmentQuestion): MatchPair[] {
  return Array.isArray(q.options) ? (q.options as MatchPair[]).filter((o) => o && 'left' in o) : [];
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
      const pairs = asPairs(question);
      const rights = pairs.map((p) => p.right);
      const rightOpts = [...new Set(rights)].map((r) => ({ value: r, label: r }));
      // Answer is encoded as "left=>right" tokens.
      const current = Array.isArray(answer) ? answer : [];
      const getRight = (left: string) => current.find((c) => c.startsWith(`${left}=>`))?.split('=>')[1] ?? '';
      function setRight(left: string, right: string) {
        const without = current.filter((c) => !c.startsWith(`${left}=>`));
        onChange(right ? [...without, `${left}=>${right}`] : without);
      }
      return (
        <div className="space-y-2">
          {pairs.map((p) => (
            <div key={p.left} className="grid grid-cols-2 items-center gap-3">
              <span className="text-sm text-slate-700">{p.left}</span>
              <Select options={rightOpts} value={getRight(p.left)} onChange={(e) => setRight(p.left, e.target.value)} placeholder="Match…" />
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
        <p className="mb-3 font-medium text-slate-800">
          {index + 1}. {question.questionText}
        </p>
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
  const [activeMaterialIdx, setActiveMaterialIdx] = useState(0);
  const [secsLeft, setSecsLeft] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const startedRef = useRef<Set<string>>(new Set());
  const completedRef = useRef<Set<string>>(new Set());

  const start = useMutation({
    mutationFn: () => svc.assessments.start({ topicId }) as unknown as Promise<StartResult>,
    onSuccess: () => setPhase('assessment'),
    onError: (e) => toast.error(apiError(e)),
  });
  const submit = useMutation({
    mutationFn: () => svc.assessments.submit({ attemptId: start.data?.attemptId, answers }) as unknown as Promise<SubmitResult>,
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
                  <p className="mt-1 text-sm text-green-700">Correct answer: {Array.isArray(d.correctAnswer) ? d.correctAnswer.join(', ') : String(d.correctAnswer)}</p>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Clock className="h-4 w-4" />
            {mats.length === 0 || allDone ? (
              <span>Reading complete. You may start the assessment.</span>
            ) : activeDone ? (
              <span>This material is read. Open the remaining material(s) to finish.</span>
            ) : (
              <span>Keep this material open — <strong>{activeSecs}s</strong> remaining for "{active?.originalFileName}".</span>
            )}
          </div>
          <Button disabled={!allDone || start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? 'Starting…' : 'Continue to assessment'}
          </Button>
        </div>
      </div>
    );
  }

  // Assessment phase — the attempt has been started (reading confirmed server-side).
  if (!start.data) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title={start.data.topicTitle ? `Assessment: ${start.data.topicTitle}` : 'Assessment'}
        description={`Attempt ${start.data.attemptNumber} of ${start.data.maxAttempts}`}
        actions={
          <Button variant="ghost" onClick={() => navigate('/assessments')}>
            Cancel
          </Button>
        }
      />
      <div className="space-y-4">
        {questions.map((q, i) => (
          <QuestionCard key={q.id} index={i} question={q} answer={answers[q.id]} onChange={(a) => setAnswers((prev) => ({ ...prev, [q.id]: a }))} />
        ))}
      </div>
      <div className="mt-6">
        <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
          {submit.isPending ? 'Submitting…' : 'Submit Assessment'}
        </Button>
      </div>
    </div>
  );
}
