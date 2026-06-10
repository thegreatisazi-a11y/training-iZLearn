import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { MultiSelect } from '@/components/common/MultiSelect';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { formatDate } from '@/lib/format';

interface ScheduleRow {
  id: string;
  topicId: string;
  topicTitle?: string;
  scheduledDate: string;
  trainingType: string;
  venue?: string | null;
  status: string;
}
interface Option {
  value: string;
  label: string;
}

const TRAINING_TYPES = ['CLASSROOM', 'E_LEARNING', 'OJT', 'OFFLINE', 'INDUCTION', 'REFRESHER', 'WORKSHOP'].map((v) => ({ value: v, label: v }));

function useLookup(kind: 'topics' | 'users') {
  return useQuery({
    queryKey: [kind, 'lookup'],
    queryFn: async () => {
      const r = kind === 'topics' ? await svc.topics.list({ pageSize: 200 }) : await svc.users.list({ pageSize: 200 });
      return r.data as Array<Record<string, unknown>>;
    },
  });
}

function NewScheduleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const topics = useLookup('topics');
  const users = useLookup('users');
  const topicOpts = useMemo<Option[]>(() => (topics.data ?? []).map((t) => ({ value: String(t.id), label: String(t.title ?? t.topicCode ?? t.id) })), [topics.data]);
  const userOpts = useMemo<Option[]>(() => (users.data ?? []).map((u) => ({ value: String(u.id), label: `${u.fullName} (${u.employeeId})` })), [users.data]);

  const [topicId, setTopicId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [trainingType, setTrainingType] = useState('CLASSROOM');
  const [methodology, setMethodology] = useState('');
  const [venue, setVenue] = useState('');
  const [maxTrainees, setMaxTrainees] = useState('');
  const [traineeIds, setTraineeIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  function reset() {
    setTopicId('');
    setScheduledDate('');
    setTrainerId('');
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
        trainerId,
        trainingType,
        methodology: methodology || undefined,
        venue: venue || undefined,
        maxTrainees: maxTrainees ? Number(maxTrainees) : undefined,
        traineeIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Schedule created.');
      reset();
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
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !topicId || !scheduledDate || !trainerId}>
            {mutation.isPending ? 'Saving…' : 'Create'}
          </Button>
        </>
      }
    >
      <Field label="Topic">
        <Select options={topicOpts} value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="Select a topic…" />
      </Field>
      <Field label="Scheduled date & time">
        <Input type="datetime-local" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
      </Field>
      <Field label="Trainer">
        <Select options={userOpts} value={trainerId} onChange={(e) => setTrainerId(e.target.value)} placeholder="Select a trainer…" />
      </Field>
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

function OjtDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const topics = useLookup('topics');
  const users = useLookup('users');
  const topicOpts = useMemo<Option[]>(() => (topics.data ?? []).map((t) => ({ value: String(t.id), label: String(t.title ?? t.id) })), [topics.data]);
  const userOpts = useMemo<Option[]>(() => (users.data ?? []).map((u) => ({ value: String(u.id), label: `${u.fullName} (${u.employeeId})` })), [users.data]);
  const today = new Date().toISOString().slice(0, 10);

  const [topicId, setTopicId] = useState('');
  const [userId, setUserId] = useState('');
  const [evaluatorId, setEvaluatorId] = useState('');
  const [evaluationDate, setEvaluationDate] = useState('');
  const [evaluationScore, setEvaluationScore] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      svc.schedules.createOjt({ topicId, userId, evaluatorId, evaluationDate, evaluationScore: Number(evaluationScore), remarks: remarks || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('OJT record saved.');
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
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !topicId || !userId || !evaluatorId || !evaluationDate || !evaluationScore}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Topic">
        <Select options={topicOpts} value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="Select a topic…" />
      </Field>
      <Field label="Trainee">
        <Select options={userOpts} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Select a trainee…" />
      </Field>
      <Field label="Evaluator">
        <Select options={userOpts} value={evaluatorId} onChange={(e) => setEvaluatorId(e.target.value)} placeholder="Select an evaluator…" />
      </Field>
      <Field label="Evaluation date">
        <Input type="date" max={today} value={evaluationDate} onChange={(e) => setEvaluationDate(e.target.value)} />
      </Field>
      <Field label="Evaluation score (0–100)">
        <Input type="number" min={0} max={100} value={evaluationScore} onChange={(e) => setEvaluationScore(e.target.value)} />
      </Field>
      <Field label="Remarks">
        <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

function OfflineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const topics = useLookup('topics');
  const users = useLookup('users');
  const topicOpts = useMemo<Option[]>(() => (topics.data ?? []).map((t) => ({ value: String(t.id), label: String(t.title ?? t.id) })), [topics.data]);
  const userOpts = useMemo<Option[]>(() => (users.data ?? []).map((u) => ({ value: String(u.id), label: `${u.fullName} (${u.employeeId})` })), [users.data]);
  const today = new Date().toISOString().slice(0, 10);

  const [topicId, setTopicId] = useState('');
  const [venue, setVenue] = useState('');
  const [trainerName, setTrainerName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [trainingDate, setTrainingDate] = useState('');
  const [traineeIds, setTraineeIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      svc.schedules.createOffline({ topicId, venue, trainerName, durationMinutes: Number(durationMinutes), trainingDate, traineeIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Offline training recorded.');
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
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !topicId || !venue || !trainerName || !durationMinutes || !trainingDate}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Topic">
        <Select options={topicOpts} value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="Select a topic…" />
      </Field>
      <Field label="Venue">
        <Input value={venue} onChange={(e) => setVenue(e.target.value)} />
      </Field>
      <Field label="Trainer name">
        <Input value={trainerName} onChange={(e) => setTrainerName(e.target.value)} />
      </Field>
      <Field label="Duration (minutes)">
        <Input type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
      </Field>
      <Field label="Training date">
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
  const [dialog, setDialog] = useState<'new' | 'ojt' | 'offline' | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ScheduleRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['schedules', page],
    queryFn: () => svc.schedules.list({ page, pageSize: 50 }),
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
    { key: 'topic', header: 'Topic', render: (r) => r.topicTitle ?? r.topicId },
    { key: 'scheduledDate', header: 'Scheduled', render: (r) => formatDate(r.scheduledDate) },
    { key: 'trainingType', header: 'Type' },
    { key: 'venue', header: 'Venue', render: (r) => r.venue || '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status}>{r.status}</Badge> },
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

      <NewScheduleDialog open={dialog === 'new'} onClose={() => setDialog(null)} />
      <OjtDialog open={dialog === 'ojt'} onClose={() => setDialog(null)} />
      <OfflineDialog open={dialog === 'offline'} onClose={() => setDialog(null)} />

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
