import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, Pencil, RefreshCw, Archive, Download, Printer } from 'lucide-react';
import { trainingType } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Column } from '@/components/common/DataTable';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
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
  sopNumber: '',
  description: '',
  trainingType: trainingType.options[0],
  departmentId: '',
  designationId: '',
  roleId: '',
  durationMinutes: '',
  passingScorePercent: '',
  maxAttempts: '',
  questionLimit: '',
  refresherIntervalMonths: '',
  materialViewSeconds: '',
  effectiveDate: '',
  reviewDate: '',
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
  const canRevise = can('courseManagement', 'revise');
  const canArchive = can('courseManagement', 'archive');
  const canExport = can('courseManagement', 'export');
  const canPrint = can('courseManagement', 'print');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [reviseTarget, setReviseTarget] = useState<Topic | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Topic | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['topics', { page, search, statusFilter }],
    queryFn: () => svc.topics.list({ page, search: search || undefined, status: statusFilter }),
  });
  const departments = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }), enabled: creating });
  const designations = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }), enabled: creating });
  const roles = useQuery({ queryKey: ['roles', 'all'], queryFn: () => svc.roles.list({ pageSize: 200 }), enabled: creating });
  const deptOptions = ((departments.data?.data ?? []) as unknown as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }));
  const desigOptions = ((designations.data?.data ?? []) as unknown as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }));
  const roleOptions = ((roles.data?.data ?? []) as unknown as { id: string; roleName: string }[]).map((r) => ({ value: r.id, label: r.roleName }));

  const createMut = useMutation({
    mutationFn: (status: 'DRAFT' | 'PUBLISHED') =>
      svc.topics.create({
        title: form.title,
        topicNumber: form.topicNumber || undefined,
        sopNumber: form.sopNumber || undefined,
        description: form.description || undefined,
        trainingType: form.trainingType,
        status,
        departmentId: form.departmentId || undefined,
        designationId: form.designationId || undefined,
        roleId: form.roleId || undefined,
        durationMinutes: Number(form.durationMinutes),
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
      }),
    onSuccess: (_d, status) => {
      toast.success(status === 'PUBLISHED' ? 'Topic created & published' : 'Draft topic created');
      qc.invalidateQueries({ queryKey: ['topics'] });
      setCreating(false);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const reviseMut = useMutation({
    mutationFn: (signature: ESignaturePayload) => {
      const { reason, ...sig } = signature;
      return svc.topics.revise(reviseTarget!.id, { reasonForChange: (reason ?? '').trim(), signature: sig });
    },
    onSuccess: () => {
      toast.success('New version created — previous version moved to Archived/Obsolete');
      qc.invalidateQueries({ queryKey: ['topics'] });
      setReviseTarget(null);
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

  const rows = (data?.data ?? []) as unknown as Topic[];

  function exportOne(r: Topic) {
    downloadCsv(
      `topic-${r.topicNumber || r.topicCode}.csv`,
      ['Field', 'Value'],
      [
        ['Topic No.', r.topicNumber || r.topicCode],
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
        ['Topic No.', 'Title', 'Type', 'Duration', 'Pass %', 'Version', 'Status'],
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
    { key: 'topicNumber', header: 'Topic No.', render: (r) => <span className="font-mono text-xs">{r.topicNumber || r.topicCode}</span> },
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
            {canRevise && !isArchived && <Button size="sm" variant="ghost" title="Revise (new version)" onClick={() => setReviseTarget(r)}><RefreshCw className="h-4 w-4" /></Button>}
            {canArchive && !isArchived && <Button size="sm" variant="ghost" title="Archive" onClick={() => setArchiveTarget(r)}><Archive className="h-4 w-4" /></Button>}
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

      {/* Revise (e-signature + reason) */}
      <ESignatureModal
        open={!!reviseTarget}
        onClose={() => setReviseTarget(null)}
        onConfirm={async (sig) => { await reviseMut.mutateAsync(sig); }}
        title={`Revise "${reviseTarget?.title ?? ''}" — New Version (e-signature required)`}
        requireReason
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

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New Training Topic"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={createMut.isPending}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => createMut.mutate('DRAFT')}
              disabled={createMut.isPending || !form.title || !form.durationMinutes || !form.passingScorePercent || !form.maxAttempts}
            >
              {createMut.isPending ? 'Saving…' : 'Save as Draft'}
            </Button>
            <Button
              onClick={() => createMut.mutate('PUBLISHED')}
              disabled={createMut.isPending || !form.title || !form.durationMinutes || !form.passingScorePercent || !form.maxAttempts}
            >
              {createMut.isPending ? 'Saving…' : 'Create & Publish'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-slate-500">The topic code is generated automatically and locked once created. Drafts are hidden from trainees until published.</p>
        <Field label="Title">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Topic No. (shown to users; optional)">
            <Input value={form.topicNumber} onChange={(e) => setForm({ ...form, topicNumber: e.target.value })} placeholder="e.g. SOP-014" />
          </Field>
          <Field label="SOP / Document No. (optional)">
            <Input value={form.sopNumber} onChange={(e) => setForm({ ...form, sopNumber: e.target.value })} placeholder="e.g. QA-SOP-014" />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Training Type">
            <Select options={TRAINING_TYPE_OPTIONS} value={form.trainingType} onChange={(e) => setForm({ ...form, trainingType: e.target.value as typeof form.trainingType })} />
          </Field>
          <Field label="Department (optional)">
            <Select placeholder="Select department…" options={deptOptions} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation (optional)">
            <Select placeholder="Select designation…" options={desigOptions} value={form.designationId} onChange={(e) => setForm({ ...form, designationId: e.target.value })} />
          </Field>
          <Field label="Role (optional)">
            <Select placeholder="Select role…" options={roleOptions} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Duration (min)">
            <Input type="number" min={1} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
          </Field>
          <Field label="Passing Score %">
            <Input type="number" min={0} max={100} value={form.passingScorePercent} onChange={(e) => setForm({ ...form, passingScorePercent: e.target.value })} />
          </Field>
          <Field label="Max Attempts">
            <Input type="number" min={1} value={form.maxAttempts} onChange={(e) => setForm({ ...form, maxAttempts: e.target.value })} />
          </Field>
          <Field label="Question Limit">
            <Input type="number" min={1} value={form.questionLimit} onChange={(e) => setForm({ ...form, questionLimit: e.target.value })} placeholder="default" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Refresher Interval (months, optional)">
            <Input type="number" min={1} value={form.refresherIntervalMonths} onChange={(e) => setForm({ ...form, refresherIntervalMonths: e.target.value })} />
          </Field>
          <Field label="Min. material reading time (seconds, optional)">
            <Input type="number" min={0} value={form.materialViewSeconds} onChange={(e) => setForm({ ...form, materialViewSeconds: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective Date (optional)">
            <Input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
          </Field>
          <Field label="Next Review Date (optional)">
            <Input type="date" value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} />
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
