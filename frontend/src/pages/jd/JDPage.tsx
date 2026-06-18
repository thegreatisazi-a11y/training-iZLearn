import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Eye, Printer } from 'lucide-react';
import DOMPurify from 'dompurify';
import { printHtml, printTable, escapeHtml } from '@/lib/print';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Column } from '@/components/common/DataTable';
import { ESignatureModal, ESignaturePayload } from '@/components/common/ESignatureModal';
import { SearchableSelect, type SearchOption } from '@/components/common/SearchableSelect';
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
  departmentId?: string | null;
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

// I4: assignment is now template-driven — pick a template (by title), then edit the copy.
const emptyAssign = { userId: '', templateId: '', departmentId: '', title: '', content: '' };

export default function JDPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canWrite = useAuthStore((s) => s.hasPermission)('jobDescription', 'write');
  const canApprove = useAuthStore((s) => s.hasPermission)('jobDescription', 'approve');
  const canPrint = useAuthStore((s) => s.hasPermission)('jobDescription', 'print');
  const currentUserName = useAuthStore((s) => s.user?.fullName);

  const [tab, setTab] = useState('jds');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // I3: the JD list defaults to Active; inactive (obsolete) JDs are shown only via the filter.
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [creating, setCreating] = useState(false);
  const [assignForm, setAssignForm] = useState(emptyAssign);
  const [assignSignOpen, setAssignSignOpen] = useState(false);
  const [editing, setEditing] = useState<JD | null>(null);
  const [editForm, setEditForm] = useState({ title: '', content: '', departmentId: '', functionalRoleId: '' });
  const [editSignOpen, setEditSignOpen] = useState(false);
  const [signTarget, setSignTarget] = useState<{ jd: JD; action: 'APPROVE' | 'REJECT' | 'OBSOLETE' } | null>(null);
  const [drawer, setDrawer] = useState<JD | null>(null);
  const [viewing, setViewing] = useState<JD | null>(null);

  // Select option sources.
  const { data: users } = useQuery({ queryKey: ['users', 'all'], queryFn: () => svc.users.list({ pageSize: 1000, includeInactive: true }) });
  const { data: departments } = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }) });
  const userOptions = ((users?.data ?? []) as { id: string; fullName: string }[]).map((u) => ({ value: u.id, label: u.fullName }));
  // Resolve approver id → name for the "Approved By" column (show name, not the UUID).
  const userName = new Map(((users?.data ?? []) as { id: string; fullName: string }[]).map((u) => [u.id, u.fullName]));
  const departmentOptions = ((departments?.data ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }));
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
    enabled: tab === 'templates' || creating,
  });
  const templateList = (templates?.data ?? []) as unknown as JDTemplate[];
  // I4: searchable template picker — selecting a Title pre-fills (editable) Dept/Title/Content.
  const templateOptions: SearchOption[] = templateList.map((t) => ({
    value: t.id,
    label: t.title,
    sublabel: [t.functionalRoleId ? frName.get(t.functionalRoleId) : null, t.departmentId ? deptName.get(t.departmentId) : 'Any department'].filter(Boolean).join(' · ') || undefined,
  }));
  function selectAssignTemplate(templateId: string) {
    const tpl = templateList.find((t) => t.id === templateId);
    setAssignForm((f) => ({
      ...f,
      templateId,
      title: tpl?.title ?? '',
      content: tpl?.content ?? '',
      departmentId: tpl?.departmentId ?? '',
    }));
  }

  const { data: signatures } = useQuery({
    queryKey: ['signatures', 'JobDescription', drawer?.id],
    queryFn: () => svc.signatures.list('JobDescription', drawer!.id),
    enabled: !!drawer,
  });

  const assignMut = useMutation({
    mutationFn: (sig: ESignaturePayload) =>
      svc.jds.assignFromTemplate({
        userId: assignForm.userId,
        templateId: assignForm.templateId,
        title: assignForm.title,
        content: assignForm.content,
        departmentId: assignForm.departmentId || undefined,
        signature: sig,
      }),
    onSuccess: () => {
      toast.success('JD assigned');
      qc.invalidateQueries({ queryKey: ['jds'] });
      setCreating(false);
      setAssignForm(emptyAssign);
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
    mutationFn: (signature: ESignaturePayload) => {
      const { reason, ...sig } = signature;
      return svc.jds.update(editing!.id, {
        title: editForm.title,
        content: editForm.content,
        departmentId: editForm.departmentId || undefined,
        functionalRoleId: editForm.functionalRoleId || undefined,
        reasonForChange: (reason ?? '').trim(),
        signature: sig,
      });
    },
    onSuccess: () => {
      toast.success('Job description updated');
      qc.invalidateQueries({ queryKey: ['jds'] });
      setEditing(null);
      setEditSignOpen(false);
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

  // A JD is "active" once it is approved/under review and not obsoleted.
  const isJdActive = (r: JD) => r.status === 'APPROVED' || r.status === 'UNDER_REVIEW';

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
      render: (r) => (isJdActive(r) ? <Badge tone="APPROVED">Active</Badge> : <Badge tone="WAIVED">Inactive</Badge>),
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
          {/* I2: Edit is available on draft/rejected and on assigned (APPROVED) JDs — controlled. */}
          {canWrite && (r.status === 'DRAFT' || r.status === 'REJECTED' || r.status === 'APPROVED') && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(r);
                setEditForm({
                  title: r.title,
                  content: r.content,
                  departmentId: r.departmentId ?? '',
                  functionalRoleId: r.functionalRoleId ?? '',
                });
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
          {/* I1: deactivating a JD requires an electronic signature. */}
          {canWrite && isJdActive(r) && (
            <Button size="sm" variant="danger" onClick={() => setSignTarget({ jd: r, action: 'OBSOLETE' })}>
              Deactivate
            </Button>
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
          <Button size="sm" variant="outline" onClick={() => navigate(`/job-descriptions/templates/${r.id}`)}>
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
                  <Plus className="h-4 w-4" /> Assign JD
                </Button>
              )
            : canWrite && (
                <Button onClick={() => navigate('/job-descriptions/templates/new')}>
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
          <div className="my-4 flex flex-wrap items-center gap-3">
            <Input
              className="max-w-xs"
              placeholder="Search…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <Select
              className="max-w-[180px]"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'all', label: 'All' },
              ]}
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as 'all' | 'active' | 'inactive')}
            />
          </div>
          <DataTable<JD>
            columns={columns}
            rows={((data?.data ?? []) as unknown as JD[]).filter((r) =>
              activeFilter === 'all' ? true : activeFilter === 'active' ? isJdActive(r) : !isJdActive(r),
            )}
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

      {/* Assign JD (I4/I5): pick a template by title → edit the copy → assign directly (e-signed). */}
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        className="max-w-2xl"
        title="Assign JD"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={assignMut.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => setAssignSignOpen(true)}
              disabled={assignMut.isPending || !assignForm.userId || !assignForm.templateId || !assignForm.title || !assignForm.content}
            >
              {assignMut.isPending ? 'Saving…' : 'Assign & Sign…'}
            </Button>
          </>
        }
      >
        <Field label="User" required>
          <Select options={userOptions} placeholder="Select user…" value={assignForm.userId} onChange={(e) => setAssignForm({ ...assignForm, userId: e.target.value })} />
        </Field>
        <Field label="JD Template (by title)" required>
          <SearchableSelect
            placeholder="Search a JD template title…"
            options={templateOptions}
            value={assignForm.templateId}
            onChange={selectAssignTemplate}
            emptyText="No templates found"
          />
        </Field>
        <p className="mb-2 text-xs text-slate-500">
          Selecting a template fills in the Department, Title and Content below. You can edit them for this assignment — your edits do not change the template. The JD is assigned directly (approved) and the user is notified to acknowledge.
        </p>
        <Field label="Department">
          <Select options={[{ value: '', label: 'Use template / user department' }, ...departmentOptions]} value={assignForm.departmentId} onChange={(e) => setAssignForm({ ...assignForm, departmentId: e.target.value })} />
        </Field>
        <Field label="Title" required>
          <Input value={assignForm.title} onChange={(e) => setAssignForm({ ...assignForm, title: e.target.value })} />
        </Field>
        <Field label="Content" required>
          <Textarea className="min-h-[160px]" value={assignForm.content} onChange={(e) => setAssignForm({ ...assignForm, content: e.target.value })} placeholder="Responsibilities, qualifications…" />
        </Field>
      </Dialog>

      <ESignatureModal
        open={assignSignOpen}
        onClose={() => setAssignSignOpen(false)}
        title="Sign — Assign Job Description"
        defaultMeaning="Approved"
        onConfirm={async (sig) => {
          await assignMut.mutateAsync(sig);
          setAssignSignOpen(false);
        }}
      />

      {/* Edit JD — full assigned details; e-signed (approval before change). */}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        className="max-w-2xl"
        title={`Edit Job Description${editing?.userFullName ? ` — ${editing.userFullName}` : ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={!editForm.title || !editForm.content} onClick={() => setEditSignOpen(true)}>
              Save &amp; Sign…
            </Button>
          </>
        }
      >
        {editing?.acknowledgedAt && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This JD was already acknowledged. Saving a change will clear the acknowledgement so the user must acknowledge the updated version again.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department">
            <Select options={[{ value: '', label: 'Any department' }, ...departmentOptions]} value={editForm.departmentId} onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })} />
          </Field>
          <Field label="Functional Role">
            <Select options={[{ value: '', label: 'None' }, ...functionalRoleOptions]} value={editForm.functionalRoleId} onChange={(e) => setEditForm({ ...editForm, functionalRoleId: e.target.value })} />
          </Field>
        </div>
        <Field label="Title">
          <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
        </Field>
        <Field label="Content">
          <Textarea className="min-h-[200px]" value={editForm.content} onChange={(e) => setEditForm({ ...editForm, content: e.target.value })} />
        </Field>
      </Dialog>

      <ESignatureModal
        open={editSignOpen}
        onClose={() => setEditSignOpen(false)}
        title="Sign — Edit Job Description"
        defaultMeaning="Approved"
        requireReason
        onConfirm={async (sig) => { await editMut.mutateAsync(sig); }}
      />

      {/* I6: JD templates are created/edited on a full-page designer route (RichTextEditor + Word/Excel import). */}

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
              <div><dt className="text-xs text-slate-400">Functional Role</dt><dd>{viewing.functionalRoleId ? frName.get(viewing.functionalRoleId) ?? '—' : '—'}</dd></div>
              <div><dt className="text-xs text-slate-400">Department</dt><dd>{viewing.departmentId ? deptName.get(viewing.departmentId) ?? '—' : 'Any'}</dd></div>
              <div><dt className="text-xs text-slate-400">Approved By</dt><dd>{viewing.approvedByName ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-400">Acknowledged</dt><dd>{viewing.acknowledgedAt ? `Yes · ${formatDate(viewing.acknowledgedAt)}` : 'Pending'}</dd></div>
            </dl>
            <div className="prose-sm border-t border-slate-100 pt-3 text-slate-700" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(viewing.content ?? '') }} />
          </div>
        )}
      </Dialog>

      {/* Approve / Reject / Deactivate e-signature */}
      <ESignatureModal
        open={!!signTarget}
        onClose={() => setSignTarget(null)}
        defaultMeaning={signTarget?.action === 'REJECT' ? 'Rejected' : 'Approved'}
        title={
          signTarget?.action === 'REJECT'
            ? 'Sign — Reject JD'
            : signTarget?.action === 'OBSOLETE'
            ? 'Sign — Deactivate JD'
            : 'Sign — Approve JD'
        }
        onConfirm={async (sig) => {
          const reason =
            signTarget!.action === 'APPROVE'
              ? 'Job description approved'
              : signTarget!.action === 'REJECT'
              ? 'Job description rejected'
              : 'Job description deactivated';
          await signMut.mutateAsync({ sig, reason });
        }}
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
