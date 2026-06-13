import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { tniStatus } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Column } from '@/components/common/DataTable';
import { ESignatureModal, ESignaturePayload } from '@/components/common/ESignatureModal';
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
  roles: { id: string; roleName: string }[];
  topics: { id: string; title: string; topicCode: string; topicNumber?: string | null }[];
  cells: { roleId: string; topicId: string; isRequired: boolean }[];
}

const STATUS_OPTIONS = tniStatus.options.map((s) => ({ value: s, label: s }));
const emptyForm = { userId: '', topicId: '', justification: '' };

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
  const { data, isLoading } = useQuery({ queryKey: ['tni-matrix'], queryFn: () => svc.tni.matrix() as unknown as Promise<MatrixData> });

  const setMut = useMutation({
    mutationFn: (body: { roleId: string; topicId: string; isRequired: boolean }) => svc.tni.setRequirement(body),
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
  const isRequired = (roleId: string, topicId: string) =>
    data.cells.some((c) => c.roleId === roleId && c.topicId === topicId && c.isRequired);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-600">Mark which published topics are <strong>Required</strong> for each role, then assign.</p>
        {canAssign && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={assignLater} onChange={(e) => setAssignLater(e.target.checked)} />
              Assign later
            </label>
            {assignLater && (
              <Input type="date" className="max-w-[150px]" value={activateOn} onChange={(e) => setActivateOn(e.target.value)} title="Activate on (optional)" />
            )}
            <Button onClick={() => setSignOpen(true)} disabled={data.topics.length === 0}>
              {assignLater ? 'Schedule assignment' : 'Assign from matrix'}
            </Button>
          </div>
        )}
      </div>
      {data.topics.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No published topics yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Topic</th>
                {data.roles.map((r) => (
                  <th key={r.id} className="px-3 py-2 text-center font-medium">{r.roleName}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.topics.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-700">
                    <span className="font-mono text-xs text-slate-400">{t.topicNumber || t.topicCode}</span> {t.title}
                  </td>
                  {data.roles.map((r) => (
                    <td key={r.id} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        disabled={!canEdit || setMut.isPending}
                        checked={isRequired(r.id, t.id)}
                        onChange={(e) => setMut.mutate({ roleId: r.id, topicId: t.id, isRequired: e.target.checked })}
                        title="Required for this role"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
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
    mutationFn: () => svc.tni.create(form),
    onSuccess: () => {
      toast.success('TNI submitted');
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
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.userId || !form.topicId || !form.justification}>
              {createMut.isPending ? 'Saving…' : 'Submit'}
            </Button>
          </>
        }
      >
        <Field label="User">
          <Select options={userOptions} placeholder="Select user…" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />
        </Field>
        <Field label="Topic">
          <Select options={topicOptions} placeholder="Select topic…" value={form.topicId} onChange={(e) => setForm({ ...form, topicId: e.target.value })} />
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
