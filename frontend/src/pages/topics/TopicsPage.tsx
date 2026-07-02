import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, Pencil, Archive, Download, Printer, Trash2, RotateCcw } from 'lucide-react';
import { trainingType } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Column } from '@/components/common/DataTable';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { MultiSelect } from '@/components/common/MultiSelect';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { printHtml, printTable, escapeHtml } from '@/lib/print';
import { downloadCsv } from '@/lib/csv';
import { svc } from '@/services';

interface Topic {
  id: string;
  topicCode: string;
  topicNumber?: string | null;
  title: string;
  trainingType: string;
  status: string;
  durationMinutes: number;
  passingScorePercent: number;
  maxAttempts: number;
  currentVersion: number;
  isActive: boolean;
}

const TRAINING_TYPE_OPTIONS = trainingType.options.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }));

const STATUS_TONE: Record<string, 'APPROVED' | 'PENDING' | 'WAIVED'> = {
  PUBLISHED: 'APPROVED',
  DRAFT: 'PENDING',
  UNDER_REVIEW: 'PENDING',
  ARCHIVED: 'WAIVED',
};

const STATUS_FILTERS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ARCHIVED', label: 'Archived / Obsolete' },
  { value: 'ALL', label: 'All' },
];

const emptyForm = {
  title: '',
  topicNumber: '',
  description: '',
  trainingTypes: [trainingType.options[0]] as string[],
  departmentId: '',
  designationId: '',
  designationIds: [] as string[],
  durationMinutes: '',
  passingScorePercent: '',
  maxAttempts: '',
  questionLimit: '',
  refresherIntervalMonths: '',
  materialViewSeconds: '',
  effectiveDate: '',
  reviewDate: '',
  sequenceIndex: '', // CR-29
  signatories: [] as { userId: string; role: string; date: string }[], // CR-T9
  randomizeQuestions: true,
  showExplanations: true,
  blockAfterMaxAttempts: true,
};

export default function TopicsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.hasPermission);
  const canCreate = can('courseManagement', 'create');
  const canEdit = can('courseManagement', 'edit');
  const canArchive = can('courseManagement', 'archive');
  const canExport = can('courseManagement', 'export');
  const canPrint = can('courseManagement', 'print');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [archiveTarget, setArchiveTarget] = useState<Topic | null>(null);
  // Restore an archived course back to Draft (e-signed).
  const [restoreTarget, setRestoreTarget] = useState<Topic | null>(null);
  // G5: a course may be deleted only before it is published.
  const [deleteTarget, setDeleteTarget] = useState<Topic | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['topics', { page, search, statusFilter }],
    queryFn: () => svc.topics.list({ page, search: search || undefined, status: statusFilter }),
  });
  const designations = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }), enabled: creating });
  const desigOptions = ((designations.data?.data ?? []) as unknown as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }));
  const signatoryUsers = useQuery({ queryKey: ['users', 'signatory'], queryFn: () => svc.users.list({ pageSize: 500 }), enabled: creating });
  const signatoryOptions = ((signatoryUsers.data?.data ?? []) as unknown as { id: string; fullName: string; employeeId: string }[]).map((u) => ({ value: u.id, label: `${u.fullName} (${u.employeeId})` }));

  const createMut = useMutation({
    mutationFn: (status: 'DRAFT' | 'PUBLISHED') =>
      svc.topics.create({
        title: form.title,
        topicNumber: form.topicNumber || undefined,
        description: form.description || undefined,
        trainingType: form.trainingTypes[0] ?? trainingType.options[0],
        trainingTypes: form.trainingTypes,
        status,
        departmentId: form.departmentId || undefined,
        designationIds: form.designationIds,
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : undefined,
        passingScorePercent: Number(form.passingScorePercent),
        maxAttempts: Number(form.maxAttempts),
        questionLimit: form.questionLimit ? Number(form.questionLimit) : undefined,
        randomizeQuestions: form.randomizeQuestions,
        showExplanations: form.showExplanations,
        blockAfterMaxAttempts: form.blockAfterMaxAttempts,
        refresherIntervalMonths: form.refresherIntervalMonths ? Number(form.refresherIntervalMonths) : undefined,
        materialViewSeconds: form.materialViewSeconds ? Number(form.materialViewSeconds) : undefined,
        effectiveDate: form.effectiveDate || undefined,
        reviewDate: form.reviewDate || undefined,
        sequenceIndex: form.sequenceIndex ? Number(form.sequenceIndex) : undefined,
        signatories: form.signatories.filter((s) => s.userId),
      }),
    onSuccess: (_d, status) => {
      toast.success(status === 'PUBLISHED' ? 'Topic created & published' : 'Draft topic created');
      qc.invalidateQueries({ queryKey: ['topics'] });
      setCreating(false);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const archiveMut = useMutation({
    mutationFn: (signature: ESignaturePayload) => {
      const { reason, ...sig } = signature;
      return svc.topics.updateStatus(archiveTarget!.id, { status: 'ARCHIVED', reasonForChange: (reason ?? '').trim(), signature: sig });
    },
    onSuccess: () => {
      toast.success('Topic archived — moved to Archived/Obsolete and hidden from active courses');
      qc.invalidateQueries({ queryKey: ['topics'] });
      setArchiveTarget(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Restore an archived course → returns it to Draft (e-signed, reason captured).
  const restoreMut = useMutation({
    mutationFn: (signature: ESignaturePayload) => {
      const { reason, ...sig } = signature;
      return svc.topics.updateStatus(restoreTarget!.id, { status: 'DRAFT', reasonForChange: (reason ?? '').trim(), signature: sig });
    },
    onSuccess: () => {
      toast.success('Course restored to Draft.');
      qc.invalidateQueries({ queryKey: ['topics'] });
      setRestoreTarget(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // G5: delete a not-yet-published course (controlled — reason for change required).
  const deleteMut = useMutation({
    mutationFn: (reason: string) => svc.topics.remove(deleteTarget!.id, reason),
    onSuccess: () => {
      toast.success('Course deleted');
      qc.invalidateQueries({ queryKey: ['topics'] });
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const rows = (data?.data ?? []) as unknown as Topic[];

  function exportOne(r: Topic) {
    downloadCsv(
      `topic-${r.topicNumber || r.topicCode}.csv`,
      ['Field', 'Value'],
      [
        ['SOP No.', r.topicNumber || r.topicCode],
        ['Title', r.title],
        ['Type', r.trainingType],
        ['Duration (min)', r.durationMinutes],
        ['Pass %', r.passingScorePercent],
        ['Max Attempts', r.maxAttempts],
        ['Version', `v${r.currentVersion}`],
        ['Status', r.status],
      ],
    );
  }

  function printList() {
    const body =
      `<h1>Training Topics</h1><div class="sub">${rows.length} topic(s) · printed from izLearn</div>` +
      printTable(
        ['SOP No.', 'Title', 'Type', 'Duration', 'Pass %', 'Version', 'Status'],
        rows.map((r) => [r.topicNumber || r.topicCode, r.title, r.trainingType, r.durationMinutes, `${r.passingScorePercent}%`, `v${r.currentVersion}`, r.status]),
      );
    printHtml('Training Topics', body);
  }

  function printOne(r: Topic) {
    printHtml(
      `Topic — ${r.title}`,
      `<h1>${escapeHtml(r.title)}</h1><div class="sub">${escapeHtml(r.topicNumber || r.topicCode)} · v${r.currentVersion} · ${escapeHtml(r.status)}</div>` +
        printTable(
          ['Field', 'Value'],
          [
            ['Type', r.trainingType],
            ['Duration (min)', r.durationMinutes],
            ['Pass %', `${r.passingScorePercent}%`],
            ['Max Attempts', r.maxAttempts],
          ],
        ),
    );
  }

  const columns: Column<Topic>[] = [
    { key: 'topicNumber', header: 'SOP No.', render: (r) => <span className="font-mono text-xs">{r.topicNumber || r.topicCode}</span> },
    {
      key: 'title',
      header: 'Title',
      render: (r) => (
        <button className="font-medium text-primary hover:underline" onClick={() => navigate(`/topics/${r.id}`)}>
          {r.title}
        </button>
      ),
    },
    { key: 'trainingType', header: 'Type', render: (r) => r.trainingType.replace(/_/g, ' ') },
    { key: 'durationMinutes', header: 'Duration (min)' },
    { key: 'passingScorePercent', header: 'Pass %', render: (r) => `${r.passingScorePercent}%` },
    { key: 'maxAttempts', header: 'Max Attempts' },
    { key: 'currentVersion', header: 'Version', render: (r) => `v${r.currentVersion}` },
    { key: 'topicStatus', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'default'}>{(r.status || 'DRAFT').charAt(0) + (r.status || 'DRAFT').slice(1).toLowerCase()}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (r) => {
        const isArchived = r.status === 'ARCHIVED';
        return (
          <div className="flex flex-wrap justify-end gap-1">
            <Button size="sm" variant="ghost" title="View" onClick={() => navigate(`/topics/${r.id}`)}><Eye className="h-4 w-4" /></Button>
            {canEdit && !isArchived && <Button size="sm" variant="ghost" title="Edit" onClick={() => navigate(`/topics/${r.id}?edit=1`)}><Pencil className="h-4 w-4" /></Button>}
            {/* G2/G3: full-course "Revise" removed — Archive only; material changes auto-version. */}
            {canArchive && !isArchived && <Button size="sm" variant="ghost" title="Archive" onClick={() => setArchiveTarget(r)}><Archive className="h-4 w-4" /></Button>}
            {/* Restore an archived course back to Draft. */}
            {canArchive && isArchived && <Button size="sm" variant="ghost" title="Restore to Draft" onClick={() => setRestoreTarget(r)}><RotateCcw className="h-4 w-4" /></Button>}
            {/* G5: delete is allowed only before the course is published. */}
            {canArchive && (r.status === 'DRAFT' || r.status === 'UNDER_REVIEW') && (
              <Button size="sm" variant="ghost" title="Delete" onClick={() => setDeleteTarget(r)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
            )}
            {canExport && <Button size="sm" variant="ghost" title="Export (CSV)" onClick={() => exportOne(r)}><Download className="h-4 w-4" /></Button>}
            {canPrint && <Button size="sm" variant="ghost" title="Print" onClick={() => printOne(r)}><Printer className="h-4 w-4" /></Button>}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Training Topics"
        description="Controlled course catalogue"
        actions={
          <div className="flex flex-wrap gap-2">
            {canExport && <Button variant="outline" onClick={() => svc.topics.exportCsv({ status: statusFilter, search: search || undefined }).catch((e) => toast.error(apiError(e)))}><Download className="h-4 w-4" /> Export</Button>}
            {canPrint && <Button variant="outline" onClick={printList}><Printer className="h-4 w-4" /> Print</Button>}
            {canCreate && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New Topic
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search topics…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          className="max-w-[14rem]"
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <DataTable<Topic>
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={data?.page}
        pageSize={data?.pageSize}
        total={data?.total}
        onPageChange={setPage}
        emptyText="No topics found."
      />

      {/* Archive (e-signature + reason) */}
      <ESignatureModal
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={async (sig) => { await archiveMut.mutateAsync(sig); }}
        title={`Archive "${archiveTarget?.title ?? ''}" (e-signature required)`}
        defaultMeaning="Performed"
        requireReason
      />

      {/* Restore archived course → Draft (e-signature + reason) */}
      <ESignatureModal
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={async (sig) => { await restoreMut.mutateAsync(sig); }}
        title={`Restore "${restoreTarget?.title ?? ''}" to Draft (e-signature required)`}
        defaultMeaning="Performed"
        requireReason
      />

      {/* G5: delete a not-yet-published course (reason for change required) */}
      <ReasonForChangeDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async (reason) => { await deleteMut.mutateAsync(reason); }}
        title={`Delete "${deleteTarget?.title ?? ''}"`}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New Training Topic"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={createMut.isPending}>
              Cancel
            </Button>
            {/* Page 8: only Save as Draft on creation; publishing happens via the controlled signatory workflow afterwards. */}
            <Button
              onClick={() => createMut.mutate('DRAFT')}
              disabled={createMut.isPending || !form.title || form.trainingTypes.length === 0 || !form.passingScorePercent || !form.maxAttempts}
            >
              {createMut.isPending ? 'Saving…' : 'Save as Draft'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-slate-500">The topic code is generated automatically and locked once created. Drafts are hidden from trainees until published.</p>
        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="SOP Number (optional)">
          <Input value={form.topicNumber} onChange={(e) => setForm({ ...form, topicNumber: e.target.value })} placeholder="e.g. QA-SOP-014" />
        </Field>
        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Training Type(s)" required>
            <MultiSelect options={TRAINING_TYPE_OPTIONS} value={form.trainingTypes} onChange={(trainingTypes) => setForm({ ...form, trainingTypes })} placeholder="Select training type(s)…" heightClass="h-32" />
          </Field>
          <Field label="Functional Role(s) (optional)" hint="Eligibility/assignment is driven by Functional Role, TNI and JD.">
            <MultiSelect options={desigOptions} value={form.designationIds} onChange={(designationIds) => setForm({ ...form, designationIds })} placeholder="Search functional roles…" heightClass="h-32" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Passing Score %" required>
            <Input type="number" min={0} max={100} value={form.passingScorePercent} onChange={(e) => setForm({ ...form, passingScorePercent: e.target.value })} />
          </Field>
          <Field label="Max Attempts" required>
            <Input type="number" min={1} value={form.maxAttempts} onChange={(e) => setForm({ ...form, maxAttempts: e.target.value })} />
          </Field>
          <Field label="Question Limit">
            <Input type="number" min={1} value={form.questionLimit} onChange={(e) => setForm({ ...form, questionLimit: e.target.value })} placeholder="default" />
          </Field>
        </div>
        {/* CR-T9: structured signatories (User · Prepared/Reviewed/Approved · Date) — auto-completed on publish, they don't take the course. */}
        <div className="mt-1">
          <div className="mb-1 flex items-center justify-between">
            <span className="iz-label">Signatories</span>
            <Button size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, signatories: [...f.signatories, { userId: '', role: 'PREPARED', date: '' }] }))}>
              <Plus className="h-4 w-4" /> Add signatory
            </Button>
          </div>
          {form.signatories.length === 0 && (
            <p className="text-xs text-slate-400">Signatories are auto-marked complete on publish and don't take the course.</p>
          )}
          <div className="space-y-2">
            {form.signatories.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_150px_150px_auto] items-center gap-2">
                <Select placeholder="Select user…" options={signatoryOptions} value={s.userId} onChange={(e) => setForm((f) => ({ ...f, signatories: f.signatories.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)) }))} />
                <Select options={[{ value: 'PREPARED', label: 'Prepared' }, { value: 'REVIEWED', label: 'Reviewed' }, { value: 'APPROVED', label: 'Approved' }]} value={s.role} onChange={(e) => setForm((f) => ({ ...f, signatories: f.signatories.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) }))} />
                <Input type="date" value={s.date} onChange={(e) => setForm((f) => ({ ...f, signatories: f.signatories.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) }))} />
                <button type="button" className="text-red-600" aria-label="Remove signatory" onClick={() => setForm((f) => ({ ...f, signatories: f.signatories.filter((_, j) => j !== i) }))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Advanced (optional)</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (minutes)" hint="Optional. Auto-recalculated from material reading time once set.">
            <Input type="number" min={0} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} placeholder="e.g. 30" />
          </Field>
          <Field label="Effective Date">
            <Input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
          </Field>
        </div>
        <div className="mt-1 space-y-2 rounded border border-slate-200 p-3">
          <div className="text-xs font-medium uppercase text-slate-500">Assessment settings</div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.randomizeQuestions} onChange={(e) => setForm({ ...form, randomizeQuestions: e.target.checked })} />
            Randomize questions
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.showExplanations} onChange={(e) => setForm({ ...form, showExplanations: e.target.checked })} />
            Show incorrect-answer explanations after a failed attempt
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.blockAfterMaxAttempts} onChange={(e) => setForm({ ...form, blockAfterMaxAttempts: e.target.checked })} />
            Block the assessment after maximum failed attempts
          </label>
        </div>
      </Dialog>
    </div>
  );
}
