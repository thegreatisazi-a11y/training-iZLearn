import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { PageLoader } from '@/components/ui/spinner';
import { EmptyState } from '@/components/common/EmptyState';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';

type QType = 'RATING' | 'TEXT' | 'MULTIPLE_CHOICE';
interface BuilderQuestion {
  id: string;
  text: string;
  type: QType;
  options: string[];
}
interface FormQuestion {
  id: string;
  text: string;
  type: QType;
  options?: string[];
}
interface FeedbackForm {
  id: string;
  title: string;
  topicId: string;
  topicTitle?: string;
  questions: FormQuestion[];
}
interface Analysis {
  title: string;
  responseCount: number;
  perQuestion: Array<{
    questionId: string;
    text: string;
    type: QType;
    count: number;
    average?: number;
    distribution?: Record<string, number>;
    topThemes?: Array<{ word: string; count: number }>;
  }>;
}

const QTYPES = [
  { value: 'RATING', label: 'Rating (1–5)' },
  { value: 'TEXT', label: 'Free text' },
  { value: 'MULTIPLE_CHOICE', label: 'Multiple choice' },
];

let qidCounter = 1;
const newQid = () => `q${qidCounter++}`;

function CreateFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const topics = useQuery({
    queryKey: ['topics', 'lookup'],
    queryFn: async () => (await svc.topics.list({ pageSize: 200 })).data as Array<Record<string, unknown>>,
    enabled: open,
  });
  const topicOpts = useMemo(() => (topics.data ?? []).map((t) => ({ value: String(t.id), label: String(t.title ?? t.id) })), [topics.data]);

  const [topicId, setTopicId] = useState('');
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<BuilderQuestion[]>([{ id: newQid(), text: '', type: 'RATING', options: [] }]);
  const [error, setError] = useState('');

  function update(id: string, patch: Partial<BuilderQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  const mutation = useMutation({
    mutationFn: () =>
      svc.feedback.createForm({
        topicId,
        title,
        questions: questions.map((q) => ({
          id: q.id,
          text: q.text,
          type: q.type,
          options: q.type === 'MULTIPLE_CHOICE' ? q.options.filter((o) => o.trim()) : undefined,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feedback', 'forms'] });
      toast.success('Feedback form created.');
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New Feedback Form"
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !topicId || !title || questions.some((q) => !q.text.trim())}>
            {mutation.isPending ? 'Saving…' : 'Create'}
          </Button>
        </>
      }
    >
      <Field label="Topic">
        <Select options={topicOpts} value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="Select a topic…" />
      </Field>
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <div className="mb-2 flex items-center justify-between">
        <span className="iz-label mb-0">Questions</span>
        <Button size="sm" variant="outline" onClick={() => setQuestions((qs) => [...qs, { id: newQid(), text: '', type: 'RATING', options: [] }])}>
          <Plus className="h-4 w-4" /> Add question
        </Button>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-md border border-slate-200 p-3">
            <div className="flex items-start gap-2">
              <Input className="flex-1" placeholder={`Question ${i + 1}`} value={q.text} onChange={(e) => update(q.id, { text: e.target.value })} />
              <Select className="w-40" options={QTYPES} value={q.type} onChange={(e) => update(q.id, { type: e.target.value as QType })} />
              {questions.length > 1 && (
                <button className="rounded p-2 text-red-600 hover:bg-red-50" onClick={() => setQuestions((qs) => qs.filter((x) => x.id !== q.id))} aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            {q.type === 'MULTIPLE_CHOICE' && (
              <div className="mt-2 space-y-2 pl-1">
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <Input
                      placeholder={`Option ${oi + 1}`}
                      value={opt}
                      onChange={(e) => update(q.id, { options: q.options.map((o, j) => (j === oi ? e.target.value : o)) })}
                    />
                    <button className="rounded p-2 text-red-600 hover:bg-red-50" onClick={() => update(q.id, { options: q.options.filter((_, j) => j !== oi) })} aria-label="Remove option">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => update(q.id, { options: [...q.options, ''] })}>
                  <Plus className="h-4 w-4" /> Add option
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

function SubmitFeedbackDialog({ form, onClose }: { form: FeedbackForm | null; onClose: () => void }) {
  const [responses, setResponses] = useState<Record<string, string | number>>({});
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => svc.feedback.submit({ formId: form?.id, responses }),
    onSuccess: () => {
      toast.success('Feedback submitted. Thank you.');
      setResponses({});
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  if (!form) return null;
  return (
    <Dialog
      open={!!form}
      onClose={onClose}
      title={form.title}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Submitting…' : 'Submit'}
          </Button>
        </>
      }
    >
      {(form.questions ?? []).map((q) => (
        <Field key={q.id} label={q.text}>
          {q.type === 'RATING' && (
            <Select
              options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
              value={String(responses[q.id] ?? '')}
              onChange={(e) => setResponses((r) => ({ ...r, [q.id]: Number(e.target.value) }))}
              placeholder="Rate 1–5…"
            />
          )}
          {q.type === 'MULTIPLE_CHOICE' && (
            <Select
              options={(q.options ?? []).map((o) => ({ value: o, label: o }))}
              value={String(responses[q.id] ?? '')}
              onChange={(e) => setResponses((r) => ({ ...r, [q.id]: e.target.value }))}
              placeholder="Select…"
            />
          )}
          {q.type === 'TEXT' && (
            <Input value={String(responses[q.id] ?? '')} onChange={(e) => setResponses((r) => ({ ...r, [q.id]: e.target.value }))} />
          )}
        </Field>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

function AnalysisDialog({ formId, onClose }: { formId: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['feedback', 'analysis', formId],
    queryFn: () => svc.feedback.analysis(formId as string) as unknown as Promise<Analysis>,
    enabled: !!formId,
  });

  return (
    <Dialog open={!!formId} onClose={onClose} title="Feedback Analysis" className="max-w-2xl">
      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">
            {data.title} · {data.responseCount} response(s)
          </p>
          {data.perQuestion.map((q) => (
            <div key={q.questionId}>
              <p className="mb-1 text-sm font-medium text-slate-800">{q.text}</p>
              {q.type === 'RATING' && (
                <>
                  <p className="mb-1 text-xs text-slate-500">Average: {q.average ?? 0} · {q.count} response(s)</p>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={Object.entries(q.distribution ?? {}).map(([k, v]) => ({ rating: k, count: v }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="rating" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#0d9488" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
              {q.type === 'MULTIPLE_CHOICE' && (
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Object.entries(q.distribution ?? {}).map(([k, v]) => ({ option: k, count: v }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="option" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {q.type === 'TEXT' && (
                <div className="flex flex-wrap gap-2">
                  {(q.topThemes ?? []).length === 0 && <span className="text-xs text-slate-400">No responses.</span>}
                  {(q.topThemes ?? []).map((t) => (
                    <span key={t.word} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
                      {t.word} ({t.count})
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

export default function FeedbackPage() {
  const canWrite = useAuthStore((s) => s.hasPermission)('feedback', 'write');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitForm, setSubmitForm] = useState<FeedbackForm | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['feedback', 'forms', page],
    queryFn: () => svc.feedback.listForms({ page, pageSize: 50 }),
  });

  const columns: Column<FeedbackForm>[] = [
    { key: 'title', header: 'Title' },
    { key: 'topic', header: 'Topic', render: (r) => r.topicTitle ?? r.topicId },
    { key: 'questions', header: 'Questions', render: (r) => String(r.questions?.length ?? 0) },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setSubmitForm(r)}>
            Submit feedback
          </Button>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={() => setAnalysisId(r.id)}>
              Analyse
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Feedback"
        description="Collect and analyse post-training feedback."
        actions={canWrite && <Button onClick={() => setCreateOpen(true)}>New Form</Button>}
      />

      {isLoading ? (
        <PageLoader />
      ) : (data?.data ?? []).length === 0 ? (
        <EmptyState message="No feedback forms yet." />
      ) : (
        <DataTable
          columns={columns}
          rows={(data?.data ?? []) as unknown as FeedbackForm[]}
          page={page}
          pageSize={data?.pageSize ?? 50}
          total={data?.total ?? 0}
          onPageChange={setPage}
        />
      )}

      {canWrite && <CreateFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />}
      <SubmitFeedbackDialog form={submitForm} onClose={() => setSubmitForm(null)} />
      <AnalysisDialog formId={analysisId} onClose={() => setAnalysisId(null)} />
    </div>
  );
}
