import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { MultiSelect } from '@/components/common/MultiSelect';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { Button } from '@/components/ui/button';
import { Input, Field, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Tabs } from '@/components/ui/tabs';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { formatDate, formatDateTime } from '@/lib/format';

interface ScheduleRow {
  id: string;
  topicId: string;
  topicTitle?: string;
  topicNumber?: string | null;
  scheduledDate: string;
  trainingType: string;
  trainerName?: string | null;
  venue?: string | null;
  status: string;
}
interface Option {
  value: string;
  label: string;
}
interface OjtRow {
  id: string;
  topicTitle?: string | null;
  topicNumber?: string | null;
  userFullName?: string | null;
  evaluatorName?: string | null;
  evaluationDate: string;
  evaluationScore: number;
  content?: string | null;
  remarks?: string | null;
}
interface OfflineRow {
  id: string;
  topicTitle?: string | null;
  topicNumber?: string | null;
  trainerName: string;
  venue: string;
  trainingDate: string;
  durationMinutes: number;
  traineeIds?: string[];
}

const TRAINING_TYPES = ['CLASSROOM', 'E_LEARNING', 'OJT', 'OFFLINE', 'INDUCTION', 'REFRESHER', 'WORKSHOP'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

/** Sentinel value used in a person dropdown to enter someone from OUTSIDE the org by name. */
const OTHER_PERSON = '__other__';

function useLookup(kind: 'topics' | 'users') {
  return useQuery({
    queryKey: [kind, 'lookup'],
    queryFn: async () => {
      const r = kind === 'topics' ? await svc.topics.list({ pageSize: 200 }) : await svc.users.list({ pageSize: 200 });
      return r.data as Array<Record<string, unknown>>;
    },
  });
}

function NewScheduleDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient();
  const topics = useLookup('topics');
  const users = useLookup('users');
  const topicOpts = useMemo<Option[]>(() => (topics.data ?? []).map((t) => ({ value: String(t.id), label: (t.topicNumber || t.topicCode) ? `${t.topicNumber || t.topicCode} – ${t.title ?? ''}` : String(t.title ?? t.id) })), [topics.data]);
  const userOpts = useMemo<Option[]>(() => (users.data ?? []).map((u) => ({ value: String(u.id), label: `${u.fullName} (${u.employeeId})` })), [users.data]);
  const trainerOptions = useMemo<Option[]>(() => [...userOpts, { value: OTHER_PERSON, label: 'Other (external trainer)…' }], [userOpts]);

  const [topicId, setTopicId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [trainerOther, setTrainerOther] = useState('');
  const [trainingType, setTrainingType] = useState('CLASSROOM');
  const [methodology, setMethodology] = useState('');
  const [venue, setVenue] = useState('');
  const [maxTrainees, setMaxTrainees] = useState('');
  const [traineeIds, setTraineeIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const isExtTrainer = trainerId === OTHER_PERSON;
  const trainerValid = isExtTrainer ? !!trainerOther.trim() : !!trainerId;

  function reset() {
    setTopicId('');
    setScheduledDate('');
    setTrainerId('');
    setTrainerOther('');
    setTrainingType('CLASSROOM');
    setMethodology('');
    setVenue('');
    setMaxTrainees('');
    setTraineeIds([]);
    setError('');
  }

  const mutation = useMutation({
    mutationFn: () =>
      svc.schedules.create({
        topicId,
        scheduledDate,
        // Internal trainer → send the user id; external ("Other") → send a name instead.
        trainerId: isExtTrainer ? undefined : trainerId,
        trainerName: isExtTrainer ? trainerOther.trim() : undefined,
        trainingType,
        methodology: methodology || undefined,
        venue: venue || undefined,
        maxTrainees: maxTrainees ? Number(maxTrainees) : undefined,
        traineeIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['my-trainings'] });
      toast.success('Schedule created.');
      reset();
      onSaved?.();
      onClose();
    },
    // The backend returns 400 if the trainer is also listed as a trainee — surface it inline.
    onError: (e) => setError(apiError(e)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New Schedule"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !topicId || !scheduledDate || !trainerValid}>
            {mutation.isPending ? 'Saving…' : 'Create'}
          </Button>
        </>
      }
    >
      <Field label="Topic" required>
        <Select options={topicOpts} value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="Select a topic…" />
      </Field>
      <Field label="Scheduled date & time" required>
        <Input type="datetime-local" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
      </Field>
      <Field label="Trainer" required>
        <Select options={trainerOptions} value={trainerId} onChange={(e) => setTrainerId(e.target.value)} placeholder="Select a trainer…" />
      </Field>
      {isExtTrainer && (
        <Field label="External trainer name" required>
          <Input value={trainerOther} onChange={(e) => setTrainerOther(e.target.value)} placeholder="Enter the external trainer's name" />
        </Field>
      )}
      <Field label="Training type">
        <Select options={TRAINING_TYPES} value={trainingType} onChange={(e) => setTrainingType(e.target.value)} />
      </Field>
      <Field label="Methodology">
        <Input value={methodology} onChange={(e) => setMethodology(e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Venue">
        <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Max trainees">
        <Input type="number" min={1} value={maxTrainees} onChange={(e) => setMaxTrainees(e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Trainees">
        <MultiSelect options={userOpts} value={traineeIds} onChange={setTraineeIds} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

function OjtDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient();
  const topics = useLookup('topics');
  const users = useLookup('users');
  const topicOpts = useMemo<Option[]>(() => (topics.data ?? []).map((t) => ({ value: String(t.id), label: (t.topicNumber || t.topicCode) ? `${t.topicNumber || t.topicCode} – ${t.title ?? ''}` : String(t.title ?? t.id) })), [topics.data]);
  const userOpts = useMemo<Option[]>(() => (users.data ?? []).map((u) => ({ value: String(u.id), label: `${u.fullName} (${u.employeeId})` })), [users.data]);
  const evaluatorOptions = useMemo<Option[]>(() => [...userOpts, { value: OTHER_PERSON, label: 'Other (external evaluator)…' }], [userOpts]);
  const today = new Date().toISOString().slice(0, 10);

  const [topicId, setTopicId] = useState('');
  const [userId, setUserId] = useState('');
  const [evaluatorId, setEvaluatorId] = useState('');
  const [evaluatorOther, setEvaluatorOther] = useState('');
  const [evaluationDate, setEvaluationDate] = useState('');
  const [evaluationScore, setEvaluationScore] = useState('');
  const [content, setContent] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const isExtEvaluator = evaluatorId === OTHER_PERSON;
  const evaluatorValid = isExtEvaluator ? !!evaluatorOther.trim() : !!evaluatorId;

  const mutation = useMutation({
    mutationFn: () =>
      svc.schedules.createOjt({
        topicId,
        userId,
        // Internal evaluator → user id; external ("Other") → a name instead.
        evaluatorId: isExtEvaluator ? undefined : evaluatorId,
        evaluatorName: isExtEvaluator ? evaluatorOther.trim() : undefined,
        evaluationDate,
        evaluationScore: Number(evaluationScore),
        content: content || undefined,
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ojt-records'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['my-trainings'] });
      toast.success('OJT record saved.');
      onSaved?.();
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record On-the-Job Training"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !topicId || !userId || !evaluatorValid || !evaluationDate || !evaluationScore}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Topic" required>
        <Select options={topicOpts} value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="Select a topic…" />
      </Field>
      <Field label="Trainee" required>
        <Select options={userOpts} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Select a trainee…" />
      </Field>
      <Field label="Evaluator" required>
        <Select options={evaluatorOptions} value={evaluatorId} onChange={(e) => setEvaluatorId(e.target.value)} placeholder="Select an evaluator…" />
      </Field>
      {isExtEvaluator && (
        <Field label="External evaluator name" required>
          <Input value={evaluatorOther} onChange={(e) => setEvaluatorOther(e.target.value)} placeholder="Enter the external evaluator's name" />
        </Field>
      )}
      <Field label="Evaluation date" required>
        <Input type="date" max={today} value={evaluationDate} onChange={(e) => setEvaluationDate(e.target.value)} />
      </Field>
      <Field label="Evaluation score (0–100)" required>
        <Input type="number" min={0} max={100} value={evaluationScore} onChange={(e) => setEvaluationScore(e.target.value)} />
      </Field>
      <Field label="Content" hint="Optional — detailed information about the training.">
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Optional details about the on-the-job training…" />
      </Field>
      <Field label="Remarks">
        <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

function OfflineDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient();
  const topics = useLookup('topics');
  const users = useLookup('users');
  const topicOpts = useMemo<Option[]>(() => (topics.data ?? []).map((t) => ({ value: String(t.id), label: (t.topicNumber || t.topicCode) ? `${t.topicNumber || t.topicCode} – ${t.title ?? ''}` : String(t.title ?? t.id) })), [topics.data]);
  const userOpts = useMemo<Option[]>(() => (users.data ?? []).map((u) => ({ value: String(u.id), label: `${u.fullName} (${u.employeeId})` })), [users.data]);
  const today = new Date().toISOString().slice(0, 10);

  const [topicId, setTopicId] = useState('');
  const [venue, setVenue] = useState('');
  // Trainer is picked from the org users, or "Other" to type an external trainer's name.
  const [trainerSel, setTrainerSel] = useState('');
  const [trainerOther, setTrainerOther] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [trainingDate, setTrainingDate] = useState('');
  const [traineeIds, setTraineeIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const trainerOptions = useMemo<Option[]>(() => [...userOpts, { value: OTHER_PERSON, label: 'Other (external trainer)…' }], [userOpts]);
  // Offline records store the trainer as a plain name, so a selected user resolves to their
  // full name and "Other" uses the typed external name.
  const resolvedTrainerName =
    trainerSel === OTHER_PERSON
      ? trainerOther.trim()
      : String((users.data ?? []).find((u) => String(u.id) === trainerSel)?.fullName ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      svc.schedules.createOffline({ topicId, venue, trainerName: resolvedTrainerName, durationMinutes: Number(durationMinutes), trainingDate, traineeIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['offline-records'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['my-trainings'] });
      toast.success('Offline training recorded.');
      onSaved?.();
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record Offline Training"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !topicId || !venue || !resolvedTrainerName || !durationMinutes || !trainingDate}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Topic" required>
        <Select options={topicOpts} value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="Select a topic…" />
      </Field>
      <Field label="Venue" required>
        <Input value={venue} onChange={(e) => setVenue(e.target.value)} />
      </Field>
      <Field label="Trainer" required>
        <Select options={trainerOptions} value={trainerSel} onChange={(e) => setTrainerSel(e.target.value)} placeholder="Select a trainer…" />
      </Field>
      {trainerSel === OTHER_PERSON && (
        <Field label="External trainer name" required>
          <Input value={trainerOther} onChange={(e) => setTrainerOther(e.target.value)} placeholder="Enter the external trainer's name" />
        </Field>
      )}
      <Field label="Duration (minutes)" required>
        <Input type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
      </Field>
      <Field label="Training date" required>
        <Input type="date" max={today} value={trainingDate} onChange={(e) => setTrainingDate(e.target.value)} />
      </Field>
      <Field label="Trainees">
        <MultiSelect options={userOpts} value={traineeIds} onChange={setTraineeIds} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

export default function SchedulesPage() {
  const canWrite = useAuthStore((s) => s.hasPermission)('scheduling', 'write');
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('schedules');
  const [dialog, setDialog] = useState<'new' | 'ojt' | 'offline' | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ScheduleRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['schedules', page],
    queryFn: () => svc.schedules.list({ page, pageSize: 50 }),
    enabled: tab === 'schedules',
  });
  const ojt = useQuery({
    queryKey: ['ojt-records', page],
    queryFn: () => svc.schedules.listOjt({ page, pageSize: 50 }),
    enabled: tab === 'ojt',
  });
  const offline = useQuery({
    queryKey: ['offline-records', page],
    queryFn: () => svc.schedules.listOffline({ page, pageSize: 50 }),
    enabled: tab === 'offline',
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => svc.schedules.cancel(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Schedule cancelled.');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const columns: Column<ScheduleRow>[] = [
    { key: 'topic', header: 'Topic', render: (r) => (r.topicNumber ? `${r.topicNumber} – ${r.topicTitle ?? ''}` : r.topicTitle ?? '—') },
    { key: 'trainer', header: 'Trainer', render: (r) => r.trainerName || '—' },
    { key: 'scheduledDate', header: 'Scheduled', render: (r) => formatDateTime(r.scheduledDate) },
    { key: 'trainingType', header: 'Type', render: (r) => (r.trainingType ? r.trainingType.replace(/_/g, ' ') : '—') },
    { key: 'venue', header: 'Venue', render: (r) => r.venue || '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status}>{r.status.replace(/_/g, ' ')}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-2">
          <Link to={`/schedules/${r.id}/attendance`} className="text-sm font-medium text-primary hover:underline">
            Attendance
          </Link>
          {canWrite && r.status !== 'CANCELLED' && r.status !== 'COMPLETED' && (
            <button className="text-sm font-medium text-red-600 hover:underline" onClick={() => setCancelTarget(r)}>
              Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  const topicCell = (r: { topicNumber?: string | null; topicTitle?: string | null }) =>
    r.topicNumber ? `${r.topicNumber} – ${r.topicTitle ?? ''}` : r.topicTitle ?? '—';

  const ojtColumns: Column<OjtRow>[] = [
    { key: 'topic', header: 'Topic', render: topicCell },
    { key: 'trainee', header: 'Trainee', render: (r) => r.userFullName ?? '—' },
    { key: 'evaluator', header: 'Evaluator', render: (r) => r.evaluatorName ?? '—' },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.evaluationDate) },
    { key: 'score', header: 'Score', render: (r) => `${r.evaluationScore}%` },
    { key: 'content', header: 'Content', render: (r) => (r.content ? <span className="line-clamp-2 max-w-xs whitespace-pre-wrap text-slate-600">{r.content}</span> : '—') },
    { key: 'status', header: 'Status', render: () => <Badge tone="COMPLETED">Completed</Badge> },
  ];
  const offlineColumns: Column<OfflineRow>[] = [
    { key: 'topic', header: 'Topic', render: topicCell },
    { key: 'trainer', header: 'Trainer', render: (r) => r.trainerName },
    { key: 'venue', header: 'Venue', render: (r) => r.venue || '—' },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.trainingDate) },
    { key: 'duration', header: 'Duration', render: (r) => `${r.durationMinutes} min` },
    { key: 'trainees', header: 'Trainees', render: (r) => String(r.traineeIds?.length ?? 0) },
    { key: 'status', header: 'Status', render: () => <Badge tone="COMPLETED">Completed</Badge> },
  ];

  return (
    <div>
      <PageHeader
        title="Training Scheduling"
        description="Plan classroom sessions and record offline / on-the-job training."
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setDialog('ojt')}>
                Record OJT
              </Button>
              <Button variant="outline" onClick={() => setDialog('offline')}>
                Record Offline Training
              </Button>
              <Button onClick={() => setDialog('new')}>New Schedule</Button>
            </>
          )
        }
      />

      <Tabs
        tabs={[
          { key: 'schedules', label: 'Schedules' },
          { key: 'ojt', label: 'OJT Records' },
          { key: 'offline', label: 'Offline Records' },
        ]}
        value={tab}
        onChange={(t) => { setTab(t); setPage(1); }}
      />

      <div className="mt-4">
        {tab === 'schedules' && (
          <DataTable
            columns={columns}
            rows={(data?.data ?? []) as unknown as ScheduleRow[]}
            loading={isLoading}
            page={page}
            pageSize={data?.pageSize ?? 50}
            total={data?.total ?? 0}
            onPageChange={setPage}
            emptyText="No schedules yet."
          />
        )}
        {tab === 'ojt' && (
          <DataTable
            columns={ojtColumns}
            rows={(ojt.data?.data ?? []) as unknown as OjtRow[]}
            loading={ojt.isLoading}
            page={page}
            pageSize={ojt.data?.pageSize ?? 50}
            total={ojt.data?.total ?? 0}
            onPageChange={setPage}
            emptyText="No OJT records yet."
          />
        )}
        {tab === 'offline' && (
          <DataTable
            columns={offlineColumns}
            rows={(offline.data?.data ?? []) as unknown as OfflineRow[]}
            loading={offline.isLoading}
            page={page}
            pageSize={offline.data?.pageSize ?? 50}
            total={offline.data?.total ?? 0}
            onPageChange={setPage}
            emptyText="No offline records yet."
          />
        )}
      </div>

      <NewScheduleDialog open={dialog === 'new'} onClose={() => setDialog(null)} onSaved={() => { setTab('schedules'); setPage(1); }} />
      <OjtDialog open={dialog === 'ojt'} onClose={() => setDialog(null)} onSaved={() => { setTab('ojt'); setPage(1); }} />
      <OfflineDialog open={dialog === 'offline'} onClose={() => setDialog(null)} onSaved={() => { setTab('offline'); setPage(1); }} />

      <ReasonForChangeDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="Cancel Schedule"
        onConfirm={async (reason) => {
          if (cancelTarget) await cancelMutation.mutateAsync({ id: cancelTarget.id, reason });
        }}
      />
    </div>
  );
}
