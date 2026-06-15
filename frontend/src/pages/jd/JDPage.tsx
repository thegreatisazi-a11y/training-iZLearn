import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Eye, Printer } from 'lucide-react';
import DOMPurify from 'dompurify';
import { printHtml, printTable, escapeHtml } from '@/lib/print';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Column } from '@/components/common/DataTable';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { ESignatureModal, ESignaturePayload } from '@/components/common/ESignatureModal';
import { SignatureBlock, SignatureRecord } from '@/components/common/SignatureBlock';
import { Tabs } from '@/components/ui/tabs';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { formatDate } from '@/lib/format';
import { svc } from '@/services';

interface JD {
  id: string;
  title: string;
  version: number;
  status: string;
  content: string;
  userId?: string;
  userFullName?: string | null;
  functionalRoleId?: string | null;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  acknowledgedAt?: string | null;
}

interface JDTemplate {
  id: string;
  title: string;
  content?: string;
  functionalRoleId?: string | null;
  departmentId?: string | null;
}

const emptyForm = { userId: '', departmentId: '', roleId: '', title: '', content: '' };
const emptyTemplate = { functionalRoleId: '', departmentId: '', title: '', content: '' };

export default function JDPage() {
  const qc = useQueryClient();
  const canWrite = useAuthStore((s) => s.hasPermission)('jobDescription', 'write');
  const canApprove = useAuthStore((s) => s.hasPermission)('jobDescription', 'approve');
  const canPrint = useAuthStore((s) => s.hasPermission)('jobDescription', 'print');
  const currentUserName = useAuthStore((s) => s.user?.fullName);

  const [tab, setTab] = useState('jds');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<JD | null>(null);
  const [editForm, setEditForm] = useState({ title: '', content: '' });
  const [editReasonOpen, setEditReasonOpen] = useState(false);
  const [signTarget, setSignTarget] = useState<{ jd: JD; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [drawer, setDrawer] = useState<JD | null>(null);
  const [viewing, setViewing] = useState<JD | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [templateForm, setTemplateForm] = useState(emptyTemplate);
  const [editingTemplate, setEditingTemplate] = useState<JDTemplate | null>(null);
  const [templateEditForm, setTemplateEditForm] = useState({ ...emptyTemplate, reasonForChange: '' });
  const [templateSignOpen, setTemplateSignOpen] = useState(false);

  // Select option sources.
  const { data: users } = useQuery({ queryKey: ['users', 'all'], queryFn: () => svc.users.list({ pageSize: 1000, includeInactive: true }) });
  const { data: departments } = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }) });
  const { data: roles } = useQuery({ queryKey: ['roles', 'all'], queryFn: () => svc.roles.list({ pageSize: 200 }) });
  const userOptions = ((users?.data ?? []) as { id: string; fullName: string }[]).map((u) => ({ value: u.id, label: u.fullName }));
  // Resolve approver id → name for the "Approved By" column (show name, not the UUID).
  const userName = new Map(((users?.data ?? []) as { id: string; fullName: string }[]).map((u) => [u.id, u.fullName]));
  const departmentOptions = ((departments?.data ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }));
  const roleOptions = ((roles?.data ?? []) as { id: string; roleName: string }[]).map((r) => ({ value: r.id, label: r.roleName }));
  // D-JD1: JD templates are keyed by Functional Role (DesignationMaster).
  const { data: functionalRoles } = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }) });
  const frList = (functionalRoles?.data ?? []) as { id: string; displayName: string }[];
  const functionalRoleOptions = frList.map((d) => ({ value: d.id, label: d.displayName }));
  const frName = new Map(frList.map((d) => [d.id, d.displayName]));
  const deptName = new Map(((departments?.data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));

  const { data, isLoading } = useQuery({
    queryKey: ['jds', { page, search }],
    queryFn: () => svc.jds.list({ page, search: search || undefined }),
  });

  const { data: templates, isLoading: tplLoading } = useQuery({
    queryKey: ['jd-templates'],
    queryFn: () => svc.jds.listTemplates({ pageSize: 200 }),
    enabled: tab === 'templates',
  });

  const { data: signatures } = useQuery({
    queryKey: ['signatures', 'JobDescription', drawer?.id],
    queryFn: () => svc.signatures.list('JobDescription', drawer!.id),
    enabled: !!drawer,
  });

  const createMut = useMutation({
    mutationFn: () => svc.jds.create(form),
    onSuccess: () => {
      toast.success('Job description created');
      qc.invalidateQueries({ queryKey: ['jds'] });
      setCreating(false);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const transitionMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => svc.jds.transition(id, body),
    onSuccess: () => {
      toast.success('Job description updated');
      qc.invalidateQueries({ queryKey: ['jds'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const editMut = useMutation({
    mutationFn: (reason: string) => svc.jds.update(editing!.id, { ...editForm, reasonForChange: reason }),
    onSuccess: () => {
      toast.success('Job description updated');
      qc.invalidateQueries({ queryKey: ['jds'] });
      setEditing(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const signMut = useMutation({
    mutationFn: ({ sig, reason }: { sig: ESignaturePayload; reason: string }) =>
      svc.jds.transition(signTarget!.jd.id, { action: signTarget!.action, signature: sig, reasonForChange: reason }),
    onSuccess: () => {
      toast.success('Decision recorded');
      qc.invalidateQueries({ queryKey: ['jds'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const createTemplateMut = useMutation({
    mutationFn: () =>
      svc.jds.createTemplate({
        functionalRoleId: templateForm.functionalRoleId,
        departmentId: templateForm.departmentId || undefined,
        title: templateForm.title,
        content: templateForm.content,
      }),
    onSuccess: () => {
      toast.success('Template created');
      qc.invalidateQueries({ queryKey: ['jd-templates'] });
      setCreatingTemplate(false);
      setTemplateForm(emptyTemplate);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateTemplateMut = useMutation({
    mutationFn: (sig: ESignaturePayload) =>
      svc.jds.updateTemplate(editingTemplate!.id, {
        functionalRoleId: templateEditForm.functionalRoleId,
        departmentId: templateEditForm.departmentId || undefined,
        title: templateEditForm.title,
        content: templateEditForm.content,
        reasonForChange: templateEditForm.reasonForChange,
        signature: sig,
      }),
    onSuccess: () => {
      toast.success('Template updated');
      qc.invalidateQueries({ queryKey: ['jd-templates'] });
      setEditingTemplate(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const printJD = (jd: JD) => {
    const body = `
      <h1>${escapeHtml(jd.title)}</h1>
      <div class="sub">Status: ${escapeHtml(jd.status.replace(/_/g, ' '))}</div>
      ${printTable(
        ['User', 'Functional Role', 'Approved By', 'Acknowledged'],
        [[
          jd.userFullName ?? '—',
          jd.functionalRoleId ? frName.get(jd.functionalRoleId) ?? '—' : '—',
          jd.approvedByName ?? '—',
          jd.acknowledgedAt ? `Yes · ${formatDate(jd.acknowledgedAt)}` : 'Pending',
        ]],
      )}
      <div class="section">Content</div>
      <div>${DOMPurify.sanitize(jd.content ?? '')}</div>
    `;
    printHtml(jd.title, body, { printedBy: currentUserName });
  };

  const columns: Column<JD>[] = [
    {
      key: 'userFullName',
      header: 'User',
      render: (r) => (
        <span className="font-medium text-slate-800">
          {r.userFullName ?? (r.userId ? userName.get(r.userId) ?? '—' : '—')}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Functional Role / Title',
      render: (r) => (
        <button className="font-medium text-primary hover:underline" onClick={() => setDrawer(r)}>
          {r.functionalRoleId ? frName.get(r.functionalRoleId) ?? r.title : r.title}
        </button>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status}>{r.status.replace(/_/g, ' ')}</Badge> },
    { key: 'approvedBy', header: 'Approved By', render: (r) => r.approvedByName ?? (r.approvedBy ? userName.get(r.approvedBy) ?? r.approvedBy : '—') },
    {
      key: 'acknowledgedAt',
      header: 'Acknowledged',
      render: (r) =>
        r.acknowledgedAt ? (
          <span className="text-green-700">Yes · {formatDate(r.acknowledgedAt)}</span>
        ) : (
          <span className="text-slate-400">Pending</span>
        ),
    },
    {
      key: 'active',
      header: 'Active',
      render: (r) => (r.status === 'APPROVED' || r.status === 'UNDER_REVIEW' ? 'Yes' : 'No'),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
            <Eye className="h-4 w-4" /> View
          </Button>
          {canPrint && (
            <Button size="sm" variant="outline" onClick={() => printJD(r)}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          )}
          {canWrite && r.status === 'DRAFT' && (
            <Button size="sm" variant="outline" onClick={() => transitionMut.mutate({ id: r.id, body: { action: 'SUBMIT_FOR_REVIEW' } })}>
              Submit for review
            </Button>
          )}
          {canWrite && (r.status === 'DRAFT' || r.status === 'REJECTED') && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(r);
                setEditForm({ title: r.title, content: r.content });
              }}
            >
              Edit
            </Button>
          )}
          {canApprove && r.status === 'UNDER_REVIEW' && (
            <>
              <Button size="sm" onClick={() => setSignTarget({ jd: r, action: 'APPROVE' })}>
                Approve
              </Button>
              <Button size="sm" variant="danger" onClick={() => setSignTarget({ jd: r, action: 'REJECT' })}>
                Reject
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const templateColumns: Column<JDTemplate>[] = [
    { key: 'title', header: 'Title', render: (r) => <span className="font-medium text-slate-800">{r.title}</span> },
    { key: 'functionalRole', header: 'Functional Role', render: (r) => (r.functionalRoleId ? frName.get(r.functionalRoleId) ?? '—' : '—') },
    { key: 'departmentName', header: 'Department', render: (r) => (r.departmentId ? deptName.get(r.departmentId) ?? '—' : 'Any') },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) =>
        canWrite ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingTemplate(r);
              setTemplateEditForm({
                functionalRoleId: r.functionalRoleId ?? '',
                departmentId: r.departmentId ?? '',
                title: r.title,
                content: r.content ?? '',
                reasonForChange: '',
              });
            }}
          >
            Edit
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Job Descriptions"
        description="Role-specific JDs with approval workflow"
        actions={
          tab === 'jds'
            ? canWrite && (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> New JD
                </Button>
              )
            : canWrite && (
                <Button onClick={() => setCreatingTemplate(true)}>
                  <Plus className="h-4 w-4" /> New JD Template
                </Button>
              )
        }
      />

      <Tabs
        tabs={[
          { key: 'jds', label: 'Job Descriptions' },
          { key: 'templates', label: 'Templates' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'jds' && (
        <>
          <div className="my-4">
            <Input
              className="max-w-xs"
              placeholder="Search…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <DataTable<JD>
            columns={columns}
            rows={(data?.data ?? []) as unknown as JD[]}
            loading={isLoading}
            page={data?.page}
            pageSize={data?.pageSize}
            total={data?.total}
            onPageChange={setPage}
            emptyText="No job descriptions found."
          />
        </>
      )}

      {tab === 'templates' && (
        <div className="mt-4">
          <DataTable<JDTemplate> columns={templateColumns} rows={(templates?.data ?? []) as unknown as JDTemplate[]} loading={tplLoading} emptyText="No templates yet." />
        </div>
      )}

      {/* Create JD */}
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        className="max-w-2xl"
        title="New Job Description"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={createMut.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !form.userId || !form.departmentId || !form.roleId || !form.title || !form.content}
            >
              {createMut.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        <Field label="User">
          <Select options={userOptions} placeholder="Select user…" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department">
            <Select options={departmentOptions} placeholder="Select…" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select options={roleOptions} placeholder="Select…" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} />
          </Field>
        </div>
        <Field label="Title">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Content">
          <Textarea className="min-h-[160px]" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Responsibilities, qualifications…" />
        </Field>
      </Dialog>

      {/* Edit JD (reason for change) */}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        className="max-w-2xl"
        title="Edit Job Description"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={!editForm.title || !editForm.content} onClick={() => setEditReasonOpen(true)}>
              Continue
            </Button>
          </>
        }
      >
        <Field label="Title">
          <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
        </Field>
        <Field label="Content">
          <Textarea className="min-h-[160px]" value={editForm.content} onChange={(e) => setEditForm({ ...editForm, content: e.target.value })} />
        </Field>
      </Dialog>

      <ReasonForChangeDialog
        open={editReasonOpen}
        onClose={() => setEditReasonOpen(false)}
        onConfirm={async (r) => {
          await editMut.mutateAsync(r);
          setEditReasonOpen(false);
        }}
        title="Edit JD — Reason for Change"
      />

      {/* Create Template */}
      <Dialog
        open={creatingTemplate}
        onClose={() => setCreatingTemplate(false)}
        className="max-w-2xl"
        title="New JD Template"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreatingTemplate(false)} disabled={createTemplateMut.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => createTemplateMut.mutate()}
              disabled={createTemplateMut.isPending || !templateForm.functionalRoleId || !templateForm.title || !templateForm.content}
            >
              {createTemplateMut.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Functional Role" required>
            <Select options={functionalRoleOptions} placeholder="Select…" value={templateForm.functionalRoleId} onChange={(e) => setTemplateForm({ ...templateForm, functionalRoleId: e.target.value })} />
          </Field>
          <Field label="Department (optional)">
            <Select options={[{ value: '', label: 'Any department' }, ...departmentOptions]} placeholder="Any department" value={templateForm.departmentId} onChange={(e) => setTemplateForm({ ...templateForm, departmentId: e.target.value })} />
          </Field>
        </div>
        <Field label="Title">
          <Input value={templateForm.title} onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })} />
        </Field>
        <Field label="Content">
          <Textarea className="min-h-[160px]" value={templateForm.content} onChange={(e) => setTemplateForm({ ...templateForm, content: e.target.value })} />
        </Field>
      </Dialog>

      {/* Edit Template (controlled — reason + e-signature) */}
      <Dialog
        open={!!editingTemplate}
        onClose={() => setEditingTemplate(null)}
        className="max-w-2xl"
        title="Edit JD Template"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingTemplate(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                !templateEditForm.functionalRoleId ||
                !templateEditForm.title ||
                !templateEditForm.content ||
                templateEditForm.reasonForChange.trim().length < 5
              }
              onClick={() => setTemplateSignOpen(true)}
            >
              Continue
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Functional Role" required>
            <Select options={functionalRoleOptions} placeholder="Select…" value={templateEditForm.functionalRoleId} onChange={(e) => setTemplateEditForm({ ...templateEditForm, functionalRoleId: e.target.value })} />
          </Field>
          <Field label="Department (optional)">
            <Select options={[{ value: '', label: 'Any department' }, ...departmentOptions]} placeholder="Any department" value={templateEditForm.departmentId} onChange={(e) => setTemplateEditForm({ ...templateEditForm, departmentId: e.target.value })} />
          </Field>
        </div>
        <Field label="Title">
          <Input value={templateEditForm.title} onChange={(e) => setTemplateEditForm({ ...templateEditForm, title: e.target.value })} />
        </Field>
        <Field label="Content">
          <Textarea className="min-h-[160px]" value={templateEditForm.content} onChange={(e) => setTemplateEditForm({ ...templateEditForm, content: e.target.value })} />
        </Field>
        <Field label="Reason for change" required>
          <Input value={templateEditForm.reasonForChange} onChange={(e) => setTemplateEditForm({ ...templateEditForm, reasonForChange: e.target.value })} placeholder="At least 5 characters" />
        </Field>
      </Dialog>

      <ESignatureModal
        open={templateSignOpen}
        onClose={() => setTemplateSignOpen(false)}
        title="Sign — Edit JD Template"
        defaultMeaning="Approved"
        onConfirm={async (sig) => {
          await updateTemplateMut.mutateAsync(sig);
          setTemplateSignOpen(false);
        }}
      />

      {/* View JD (read-only) */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        className="max-w-2xl"
        title={viewing?.title ?? 'Job Description'}
        footer={
          <>
            {canPrint && viewing && (
              <Button variant="outline" onClick={() => printJD(viewing)}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            )}
            <Button onClick={() => setViewing(null)}>Close</Button>
          </>
        }
      >
        {viewing && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={viewing.status}>{viewing.status.replace(/_/g, ' ')}</Badge>
              <span className="text-slate-500">v{viewing.version}</span>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-slate-700">
              <div><dt className="text-xs text-slate-400">User</dt><dd>{viewing.userFullName ?? (viewing.userId ? userName.get(viewing.userId) ?? '—' : '—')}</dd></div>
              <div><dt className="text-xs text-slate-400">Approved By</dt><dd>{viewing.approvedByName ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-400">Acknowledged</dt><dd>{viewing.acknowledgedAt ? `Yes · ${formatDate(viewing.acknowledgedAt)}` : 'Pending'}</dd></div>
            </dl>
            <div className="prose-sm border-t border-slate-100 pt-3 text-slate-700" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(viewing.content ?? '') }} />
          </div>
        )}
      </Dialog>

      {/* Approve / Reject e-signature */}
      <ESignatureModal
        open={!!signTarget}
        onClose={() => setSignTarget(null)}
        defaultMeaning={signTarget?.action === 'REJECT' ? 'Rejected' : 'Approved'}
        title={signTarget?.action === 'REJECT' ? 'Sign — Reject JD' : 'Sign — Approve JD'}
        onConfirm={async (sig) => { await signMut.mutateAsync({ sig, reason: signTarget!.action === 'APPROVE' ? 'Job description approved' : 'Job description rejected' }); }}
      />

      {/* Detail drawer with signatures */}
      {drawer && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(null)} />
          <div className="relative z-10 h-full w-full max-w-md overflow-y-auto bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-base font-semibold">{drawer.title}</h3>
              <button onClick={() => setDrawer(null)} className="rounded p-1 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="flex items-center gap-2 text-sm">
                <Badge tone={drawer.status}>{drawer.status.replace(/_/g, ' ')}</Badge>
                <span className="text-slate-500">v{drawer.version}</span>
              </div>
              <div className="prose-sm text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(drawer.content ?? '') }} />
              <div>
                <h4 className="mb-2 text-sm font-semibold text-slate-700">Signatures</h4>
                {signatures === undefined ? (
                  <Spinner />
                ) : (signatures as SignatureRecord[]).length ? (
                  <SignatureBlock signatures={signatures as SignatureRecord[]} />
                ) : (
                  <p className="text-sm text-slate-400">No signatures yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
