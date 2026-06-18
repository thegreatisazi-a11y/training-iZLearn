import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { tniStatus } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Column } from '@/components/common/DataTable';
import { ESignatureModal, ESignaturePayload } from '@/components/common/ESignatureModal';
import { MultiSelect } from '@/components/common/MultiSelect';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { svc } from '@/services';

interface TNI {
  id: string;
  userFullName?: string;
  topicTitle?: string;
  justification: string;
  status: string;
}

interface MatrixData {
  designations: { id: string; displayName: string }[];
  topics: { id: string; title: string; topicCode: string; topicNumber?: string | null }[];
  cells: { designationId: string; topicId: string; isRequired: boolean }[];
}

const STATUS_OPTIONS = tniStatus.options.map((s) => ({ value: s, label: s }));
const emptyForm = { userId: '', topicIds: [] as string[], justification: '' };

/**
 * CR-46/47/49: the role × topic requirement matrix. Toggling a cell saves the
 * Required flag; "Assign from matrix" e-signs and creates assignments for every
 * required (role, topic) pair. TNI is the primary assignment workflow.
 */
function RequirementMatrix() {
  const qc = useQueryClient();
  const canEdit = useAuthStore((s) => s.hasPermission)('tni', 'edit');
  const canAssign = useAuthStore((s) => s.hasPermission)('tni', 'assign');
  const [signOpen, setSignOpen] = useState(false);
  const [assignLater, setAssignLater] = useState(false);
  const [activateOn, setActivateOn] = useState('');
  const [q, setQ] = useState('');
  // J1: permission-style layout — each topic is an expandable card of per-role toggles.
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());
  const { data, isLoading } = useQuery({ queryKey: ['tni-matrix'], queryFn: () => svc.tni.matrix() as unknown as Promise<MatrixData> });

  type Cell = { designationId: string; topicId: string; isRequired: boolean };
  const setMut = useMutation({
    mutationFn: (body: Cell) => svc.tni.setRequirement(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tni-matrix'] }),
    onError: (e) => toast.error(apiError(e)),
  });
  const bulkMut = useMutation({
    mutationFn: (cells: Cell[]) => Promise.all(cells.map((c) => svc.tni.setRequirement(c))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tni-matrix'] }),
    onError: (e) => toast.error(apiError(e)),
  });
  const applyMut = useMutation({
    mutationFn: (sig: ESignaturePayload) => {
      const { reason, ...signature } = sig;
      return svc.tni.applyMatrix({
        reasonForChange: (reason ?? '').trim(),
        activateLater: assignLater || undefined,
        activateOn: assignLater && activateOn ? activateOn : undefined,
        signature,
      });
    },
    onSuccess: (r) => {
      const count = (r as { created?: number })?.created ?? 0;
      toast.success(`${count} assignment(s) created from the matrix.`);
      setSignOpen(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading || !data) return <div className="py-8 text-center text-sm text-slate-500">Loading matrix…</div>;

  const reqSet = new Set(data.cells.filter((c) => c.isRequired).map((c) => `${c.designationId}|${c.topicId}`));
  const isRequired = (d: string, t: string) => reqSet.has(`${d}|${t}`);
  const term = q.trim().toLowerCase();
  const topics = term
    ? data.topics.filter((t) => t.title.toLowerCase().includes(term) || (t.topicNumber || t.topicCode || '').toLowerCase().includes(term))
    : data.topics;
  const rowCount = (t: string) => data.designations.filter((d) => isRequired(d.id, t)).length;
  const busy = setMut.isPending || bulkMut.isPending;
  const setRow = (topicId: string, on: boolean) => bulkMut.mutate(data.designations.map((d) => ({ designationId: d.id, topicId, isRequired: on })));

  const noRoles = data.designations.length === 0;
  const noTopics = data.topics.length === 0;

  return (
    <div>
      {/* Header: intent + summary + assign controls */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            Mark which published SOPs/topics are <span className="font-medium text-green-700">Required</span> for each Functional Role, then assign.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>{data.designations.length} functional role(s)</span>
            <span>·</span>
            <span>{data.topics.length} topic(s)</span>
            <span>·</span>
            <Badge tone="APPROVED">{reqSet.size} required mapping(s)</Badge>
          </div>
        </div>
        {canAssign && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={assignLater} onChange={(e) => setAssignLater(e.target.checked)} />
              Assign later
            </label>
            {assignLater && (
              <Input type="date" className="max-w-[150px]" value={activateOn} onChange={(e) => setActivateOn(e.target.value)} title="Activate on (optional)" />
            )}
            <Button onClick={() => setSignOpen(true)} disabled={noTopics || reqSet.size === 0}>
              {assignLater ? 'Schedule assignment' : 'Assign from matrix'}
            </Button>
          </div>
        )}
      </div>

      {/* Toolbar: search + legend */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-md border border-slate-300 px-2 py-1.5">
          <Search className="h-4 w-4 text-slate-400" />
          <input className="bg-transparent text-sm outline-none" placeholder="Filter topics…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded bg-green-100 text-green-700"><Check className="h-3 w-3" /></span> Required</span>
          <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded bg-slate-100 text-slate-400">–</span> Not required</span>
        </div>
      </div>

      {noRoles ? (
        <p className="py-8 text-center text-sm text-slate-500">No Functional Roles defined. Add them under Master Setup → Functional Roles first.</p>
      ) : noTopics ? (
        <p className="py-8 text-center text-sm text-slate-500">No published topics yet.</p>
      ) : (
        // J1: permission-matrix style — each topic is a card; expand to toggle Required per functional role.
        <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
          {topics.map((t) => {
            const isOpen = openTopics.has(t.id);
            const count = rowCount(t.id);
            return (
              <div key={t.id} className="rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => setOpenTopics((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800">{t.title}</span>
                      <span className="block font-mono text-[10px] text-slate-400">{t.topicNumber || t.topicCode}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={count > 0 ? 'APPROVED' : 'default'}>{count}/{data.designations.length} roles</Badge>
                    {canEdit && (
                      <div className="flex gap-1 text-[10px]">
                        <button type="button" disabled={busy} className="rounded px-1 text-primary hover:underline disabled:opacity-50" onClick={() => setRow(t.id, true)}>All</button>
                        <span className="text-slate-300">|</span>
                        <button type="button" disabled={busy} className="rounded px-1 text-slate-400 hover:underline disabled:opacity-50" onClick={() => setRow(t.id, false)}>None</button>
                      </div>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.designations.map((d) => {
                      const req = isRequired(d.id, t.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          disabled={!canEdit || busy}
                          onClick={() => setMut.mutate({ designationId: d.id, topicId: t.id, isRequired: !req })}
                          className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                            req ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100'
                          }`}
                          title={req ? 'Required — click to clear' : 'Not required — click to set required'}
                        >
                          <span className="min-w-0 truncate text-sm text-slate-700">{d.displayName}</span>
                          <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${req ? 'border-green-300 bg-green-100 text-green-700' : 'border-slate-200 bg-white text-slate-300'}`}>
                            {req ? <Check className="h-4 w-4" /> : <span className="text-xs">–</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {topics.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-400">No topics match "{q}".</p>
          )}
        </div>
      )}

      <ESignatureModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title="Sign — assign training from matrix"
        defaultMeaning="Approved"
        requireReason
        onConfirm={async (sig) => { await applyMut.mutateAsync(sig); }}
      />
    </div>
  );
}

export default function TNIPage() {
  const qc = useQueryClient();
  const canWrite = useAuthStore((s) => s.hasPermission)('tni', 'write');
  const canApprove = useAuthStore((s) => s.hasPermission)('tni', 'approve');

  const [view, setView] = useState<'requests' | 'matrix'>('requests');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [decision, setDecision] = useState<{ tni: TNI; type: 'APPROVE' | 'REJECT' } | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [dueDate, setDueDate] = useState('');

  const { data: users } = useQuery({ queryKey: ['users', 'all'], queryFn: () => svc.users.list({ pageSize: 200 }) });
  const { data: topics } = useQuery({ queryKey: ['topics', 'all'], queryFn: () => svc.topics.list({ pageSize: 200 }) });
  const userOptions = ((users?.data ?? []) as { id: string; fullName: string }[]).map((u) => ({ value: u.id, label: u.fullName }));
  const topicOptions = ((topics?.data ?? []) as { id: string; title: string }[]).map((t) => ({ value: t.id, label: t.title }));

  const { data, isLoading } = useQuery({
    queryKey: ['tni', { page, status }],
    queryFn: () => svc.tni.list({ page, status: status || undefined }),
  });

  const createMut = useMutation({
    mutationFn: () => svc.tni.create({ userId: form.userId, topicIds: form.topicIds, justification: form.justification }),
    onSuccess: (r) => {
      const count = (r as { created?: number })?.created ?? 0;
      toast.success(count > 1 ? `${count} training needs submitted` : 'TNI submitted');
      qc.invalidateQueries({ queryKey: ['tni'] });
      setCreating(false);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const decideMut = useMutation({
    mutationFn: (sig: ESignaturePayload) =>
      svc.tni.decide(decision!.tni.id, {
        decision: decision!.type,
        dueDate: decision!.type === 'APPROVE' && dueDate ? dueDate : undefined,
        signature: sig,
      }),
    onSuccess: () => {
      toast.success('Decision recorded');
      qc.invalidateQueries({ queryKey: ['tni'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const columns: Column<TNI>[] = [
    { key: 'user', header: 'User', render: (r) => <span className="font-medium text-slate-800">{r.userFullName ?? '—'}</span> },
    { key: 'topic', header: 'Topic', render: (r) => r.topicTitle ?? '—' },
    { key: 'justification', header: 'Justification', render: (r) => <span className="text-slate-600">{r.justification}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status}>{r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) =>
        canApprove && r.status === 'PENDING' ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              onClick={() => {
                setDueDate('');
                setDecision({ tni: r, type: 'APPROVE' });
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setDecision({ tni: r, type: 'REJECT' });
                setSignOpen(true);
              }}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Training Needs Identification"
        description="Identify and approve role-based training needs — the primary assignment workflow"
        actions={
          canWrite && view === 'requests' && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New TNI
            </Button>
          )
        }
      />

      <div className="mb-4 flex gap-2 border-b border-slate-200">
        <button
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${view === 'requests' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          onClick={() => setView('requests')}
        >
          Requests
        </button>
        <button
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${view === 'matrix' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          onClick={() => setView('matrix')}
        >
          Requirement Matrix
        </button>
      </div>

      {view === 'matrix' && <RequirementMatrix />}

      {view === 'requests' && (
      <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          className="max-w-[180px]"
          options={STATUS_OPTIONS}
          placeholder="All statuses"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <DataTable<TNI>
        columns={columns}
        rows={(data?.data ?? []) as unknown as TNI[]}
        loading={isLoading}
        page={data?.page}
        pageSize={data?.pageSize}
        total={data?.total}
        onPageChange={setPage}
        emptyText="No TNIs found."
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New Training Need"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={createMut.isPending}>
              Cancel
            </Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.userId || form.topicIds.length === 0 || !form.justification}>
              {createMut.isPending ? 'Saving…' : 'Submit'}
            </Button>
          </>
        }
      >
        <Field label="User">
          <Select options={userOptions} placeholder="Select user…" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />
        </Field>
        {/* J2: multiple topics — one TNI row is created per selected topic. */}
        <Field label="Topics">
          <MultiSelect options={topicOptions} value={form.topicIds} onChange={(topicIds) => setForm({ ...form, topicIds })} placeholder="Search topics…" />
        </Field>
        <Field label="Justification">
          <Textarea value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} placeholder="Why is this training required?" />
        </Field>
      </Dialog>

      {/* Approve: capture optional due date before signing. */}
      <Dialog
        open={!!decision && decision.type === 'APPROVE'}
        onClose={() => setDecision(null)}
        title="Approve TNI"
        footer={
          <>
            <Button variant="outline" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button onClick={() => setSignOpen(true)}>Continue to sign</Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-slate-500">Approving activates the training assignment. An electronic signature is required.</p>
        <Field label="Due date (optional)">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </Dialog>

      <ESignatureModal
        open={signOpen}
        onClose={() => {
          setSignOpen(false);
          setDecision(null);
        }}
        defaultMeaning={decision?.type === 'REJECT' ? 'Rejected' : 'Approved'}
        title={decision?.type === 'REJECT' ? 'Sign — Reject TNI' : 'Sign — Approve TNI'}
        onConfirm={async (sig) => { await decideMut.mutateAsync(sig); }}
      />
      </>
      )}
    </div>
  );
}
