import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Upload, ClipboardList, Printer, Download } from 'lucide-react';
import { userType as userTypeEnum } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { MultiSelect } from '@/components/common/MultiSelect';
import { SearchableSelect, type SearchOption } from '@/components/common/SearchableSelect';
import { Button } from '@/components/ui/button';
import { Input, Field, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { api, apiError } from '@/lib/axios';
import { svc, downloadBlob } from '@/services';
import { printHtml, printTable } from '@/lib/print';

interface UserRow {
  id: string;
  fullName: string;
  employeeId: string;
  windowsUsername: string;
  userType: string;
  email?: string | null;
  departmentId?: string;
  locationId?: string;
  departmentName?: string | null;
  locationName?: string | null;
  roleNames?: string[];
  supervisorId?: string | null;
  designationId?: string | null;
  designationIds?: string[];
  functionalRoleNames?: string[];
  isActive: boolean;
}

const EMPTY_EDIT_FORM = {
  fullName: '',
  email: '',
  departmentId: '',
  locationId: '',
  supervisorId: '',
  designationId: '',
  designationIds: [] as string[],
  userType: 'INTERNAL',
};

type ActionKind = 'activate' | 'deactivate' | 'resetPassword';

const ACTION_LABEL: Record<ActionKind, string> = {
  activate: 'Activate',
  deactivate: 'Deactivate',
  resetPassword: 'Reset Password',
};

const ACTION_MEANING: Record<ActionKind, string> = {
  activate: 'Performed',
  deactivate: 'Performed',
  resetPassword: 'Performed',
};

const USER_TYPE_OPTIONS = userTypeEnum.options.map((v) => ({ value: v, label: v }));

/** D1/D8: derive the auto-username preview (first.last, lowercase) shown live in the field. */
function genUsername(fullName: string): string {
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean).map((p) => p.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  if (!parts.length) return '';
  return parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0];
}

const EMPTY_FORM = {
  userType: 'INTERNAL',
  fullName: '',
  employeeId: '',
  windowsUsername: '',
  email: '',
  departmentId: '',
  locationId: '',
  supervisorId: '',
  designationId: '',
  designationIds: [] as string[],
  roleIds: [] as string[],
  remarks: '',
};

type StatusFilter = 'active' | 'inactive' | 'all';

interface Lifecycle {
  releaseStage: string;
  releasedAt?: string | null;
  jd: { title: string; acknowledged: boolean } | null;
  jdAcknowledged: boolean;
  cvCompleted: boolean;
  tni: { total: number; approved: number; pending: number };
  training: { total: number; completed: number; complete: boolean };
  eligibleForRelease: boolean;
}

/**
 * CR-15/16: user onboarding lifecycle — JD acknowledgement, CV, TNI, training
 * completion, and the release stage (advanced by an e-signed action).
 */
function LifecycleDialog({ user, canApprove, onClose }: { user: { id: string; fullName: string }; canApprove: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [signStage, setSignStage] = useState<'READY_FOR_RELEASE' | 'RELEASED' | 'ONBOARDING' | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['user-lifecycle', user.id], queryFn: () => svc.users.lifecycle(user.id) as unknown as Promise<Lifecycle> });

  const releaseMut = useMutation({
    mutationFn: (sig: ESignaturePayload) => {
      const { reason, ...signature } = sig;
      return svc.users.setReleaseStage(user.id, { stage: signStage, reasonForChange: (reason ?? '').trim(), signature });
    },
    onSuccess: () => {
      toast.success('Release stage updated.');
      qc.invalidateQueries({ queryKey: ['user-lifecycle', user.id] });
      setSignStage(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const Row = ({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) => (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={ok ? 'font-medium text-green-700' : 'text-amber-700'}>{detail ?? (ok ? 'Complete' : 'Pending')}</span>
    </div>
  );

  return (
    <Dialog open onClose={onClose} title={`Lifecycle — ${user.fullName}`} footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      {isLoading || !data ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-slate-500">Release stage</span>
            <Badge tone={data.releaseStage === 'RELEASED' ? 'COMPLETED' : data.releaseStage === 'READY_FOR_RELEASE' ? 'APPROVED' : 'PENDING'}>
              {data.releaseStage.replace(/_/g, ' ')}
            </Badge>
          </div>
          <Row label="Job Description acknowledged" ok={data.jdAcknowledged} detail={data.jd ? undefined : 'No JD assigned'} />
          <Row label="CV completed" ok={data.cvCompleted} />
          <Row label="TNI" ok={data.tni.pending === 0} detail={`${data.tni.approved} approved · ${data.tni.pending} pending`} />
          <Row label="Training" ok={data.training.complete} detail={`${data.training.completed}/${data.training.total} complete`} />
          {canApprove && (
            <div className="mt-4 flex flex-wrap gap-2">
              {data.releaseStage !== 'READY_FOR_RELEASE' && (
                <Button size="sm" variant="outline" disabled={!data.eligibleForRelease} onClick={() => setSignStage('READY_FOR_RELEASE')} title={data.eligibleForRelease ? '' : 'JD acknowledgement and all training must be complete'}>
                  Mark ready for release
                </Button>
              )}
              {data.releaseStage !== 'RELEASED' && (
                <Button size="sm" disabled={!data.eligibleForRelease} onClick={() => setSignStage('RELEASED')}>
                  Release user
                </Button>
              )}
              {data.releaseStage !== 'ONBOARDING' && (
                <Button size="sm" variant="outline" onClick={() => setSignStage('ONBOARDING')}>
                  Back to onboarding
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <ESignatureModal
        open={!!signStage}
        onClose={() => setSignStage(null)}
        title="Sign — change release stage"
        defaultMeaning="Approved"
        requireReason
        onConfirm={async (sig) => { await releaseMut.mutateAsync(sig); }}
      />
    </Dialog>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('userManagement', 'write');
  const canApprove = hasPermission('userManagement', 'approve');
  const canPrint = hasPermission('userManagement', 'print');
  const canExport = hasPermission('userManagement', 'export');
  const canAssignJd = hasPermission('jobDescription', 'assign'); // D-JD1: assign Functional Role + JD
  const canAct = canWrite || canApprove;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // CR-12: Active / Inactive / All filter (drives the API includeInactive flag).
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [exporting, setExporting] = useState(false);

  const [esign, setEsign] = useState<{ open: boolean; action: ActionKind; user?: UserRow; reason: string }>({
    open: false,
    action: 'activate',
    reason: '',
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [resetPwdDialog, setResetPwdDialog] = useState<{ username: string; tempPassword: string } | null>(null);

  // CR-12: read-only View dialog
  const [viewUser, setViewUser] = useState<UserRow | null>(null);
  const [lifecycleUser, setLifecycleUser] = useState<UserRow | null>(null);

  // Phase 3: edit details (write, e-signed per CR-14) + change roles (approve, e-signed)
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editEsignOpen, setEditEsignOpen] = useState(false);
  const [rolesUser, setRolesUser] = useState<UserRow | null>(null);
  const [rolesSelected, setRolesSelected] = useState<string[]>([]);
  const [rolesEsignOpen, setRolesEsignOpen] = useState(false);
  // D-JD1 / CR-50: assign a Functional Role → auto-assigns the approved JD.
  const [frUser, setFrUser] = useState<UserRow | null>(null);
  const [frSelected, setFrSelected] = useState('');
  const [frEsignOpen, setFrEsignOpen] = useState(false);

  const includeInactive = statusFilter !== 'active';
  const params = { page, pageSize: 50, search: search || undefined, includeInactive };
  const { data, isLoading } = useQuery({ queryKey: ['users', params], queryFn: () => svc.users.list(params) });

  // CR-12: the "Inactive only" view is the inactive subset of an includeInactive query.
  const rawRows = (data?.data ?? []) as unknown as UserRow[];
  const rows = statusFilter === 'inactive' ? rawRows.filter((r) => !r.isActive) : rawRows;

  // CR-13: mandatory-field gating for the create/edit forms.
  // D8: username is auto-generated server-side (not required here). D9: email mandatory.
  const createFormValid =
    !!form.fullName && !!form.employeeId && !!form.email && !!form.departmentId && !!form.locationId && form.roleIds.length > 0;
  const editFormValid = !!editForm.fullName && !!editForm.departmentId && !!editForm.locationId;

  const departments = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }) });
  const locations = useQuery({ queryKey: ['locations', 'all'], queryFn: () => svc.locations.list({ pageSize: 200 }) });
  const roles = useQuery({ queryKey: ['roles', 'all'], queryFn: () => svc.roles.list({ pageSize: 200 }) });
  // D2: Reporting Manager picker shows ACTIVE users only (no include-inactive option).
  const allUsers = useQuery({
    queryKey: ['users', 'supervisors'],
    queryFn: () => svc.users.list({ pageSize: 500, includeInactive: false }),
  });
  const designations = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }) });

  // Reporting Manager options = active users, rich label (name · ID · dept · roles), self excluded.
  type SupRow = { id: string; fullName: string; employeeId: string; departmentName?: string | null; functionalRoleNames?: string[]; isActive?: boolean };
  const supervisorOptions = (excludeId?: string): SearchOption[] =>
    ((allUsers.data?.data ?? []) as SupRow[])
      .filter((u) => u.id !== excludeId && u.isActive !== false)
      .map((u) => ({
        value: u.id,
        label: `${u.fullName} (${u.employeeId})`,
        sublabel:
          [
            u.departmentName,
            u.functionalRoleNames?.length ? u.functionalRoleNames.join(', ') : null,
            u.isActive === false ? 'Inactive' : 'Active',
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
      }));

  const actionMutation = useMutation({
    mutationFn: ({ action, id, body }: { action: ActionKind; id: string; body: unknown }) => svc.users[action](id, body),
    onSuccess: (res, v) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      const d = res as { windowsUsername?: string; tempPassword?: string } | undefined;
      if (v.action === 'resetPassword' && d?.tempPassword) {
        setResetPwdDialog({ username: d.windowsUsername ?? esign.user?.windowsUsername ?? '', tempPassword: d.tempPassword });
      } else {
        toast.success(`${ACTION_LABEL[v.action]} completed.`);
      }
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const createMutation = useMutation({
    mutationFn: (body: unknown) => svc.users.createRequest(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user-requests'] });
      toast.success('User request submitted for approval.');
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setUsernameTouched(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.users.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User details updated.');
      setEditEsignOpen(false);
      setEditUser(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const changeRolesMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.users.changeRoles(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Roles updated.');
      setRolesEsignOpen(false);
      setRolesUser(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const assignFrMutation = useMutation({
    mutationFn: (body: unknown) => svc.jds.assignFunctionalRole(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Functional role assigned and Job Description created.');
      setFrEsignOpen(false);
      setFrUser(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function openAction(action: ActionKind, user: UserRow) {
    setEsign({ open: true, action, user, reason: '' });
  }

  function openEditUser(row: UserRow) {
    setEditUser(row);
    setEditForm({
      fullName: row.fullName ?? '',
      email: row.email ?? '',
      departmentId: row.departmentId ?? '',
      locationId: row.locationId ?? '',
      supervisorId: row.supervisorId ?? '',
      designationId: row.designationId ?? '',
      designationIds: row.designationIds ?? (row.designationId ? [row.designationId] : []),
      userType: row.userType ?? 'INTERNAL',
    });
  }

  async function openChangeRoles(row: UserRow) {
    setRolesUser(row);
    setRolesSelected([]);
    try {
      const full = (await svc.users.get(row.id)) as { roleIds?: string[] };
      setRolesSelected(full.roleIds ?? []);
    } catch {
      /* leave empty if detail fetch fails */
    }
  }

  // CR-12: print the currently-displayed users list (client-side, no server dependency).
  function handlePrint() {
    const body =
      `<h1>Users</h1>` +
      `<div class="sub">${rows.length} record(s)${search ? ` · search: "${search}"` : ''} · ${
        statusFilter === 'all' ? 'All' : statusFilter === 'inactive' ? 'Inactive' : 'Active'
      }</div>` +
      printTable(
        ['Employee ID', 'Full Name', 'Username', 'Email', 'Department', 'Location', 'Roles', 'Status'],
        rows.map((r) => [
          r.employeeId,
          r.fullName,
          r.windowsUsername,
          r.email ?? '',
          r.departmentName ?? '',
          r.locationName ?? '',
          (r.roleNames ?? []).join(', '),
          r.isActive ? 'Active' : 'Inactive',
        ]),
      );
    printHtml('Users', body);
  }

  // CR-12: download the filtered users list from the export endpoint (authenticated blob).
  async function handleExport(format: 'xlsx' | 'csv') {
    setExporting(true);
    try {
      const res = await api.get('/users/export', {
        params: { format, search: search || undefined, includeInactive },
        responseType: 'blob',
      });
      downloadBlob(res.data as Blob, `users.${format}`);
      toast.success('Users exported.');
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setExporting(false);
    }
  }

  async function confirmAction(signature: ESignaturePayload) {
    if (!esign.user) return;
    const reason = (signature.reason ?? '').trim();
    if (reason.length < 5) {
      throw new Error('A reason of at least 5 characters is required.');
    }
    const { reason: _r, ...sig } = signature;
    await actionMutation.mutateAsync({
      action: esign.action,
      id: esign.user.id,
      body: { reasonForChange: reason, signature: sig },
    });
  }

  const columns: Column<UserRow>[] = [
    { key: 'fullName', header: 'Full Name' },
    { key: 'employeeId', header: 'Employee ID' },
    { key: 'windowsUsername', header: 'Username' },
    { key: 'userType', header: 'Type' },
    {
      key: 'roles',
      header: 'Roles',
      render: (r) => (r.roleNames && r.roleNames.length ? r.roleNames.join(', ') : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => setViewUser(r)}>
            View
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLifecycleUser(r)}>
            Lifecycle
          </Button>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={() => openEditUser(r)}>
              Edit
            </Button>
          )}
          {canApprove && (
            <Button size="sm" variant="outline" onClick={() => openChangeRoles(r)}>
              Change Roles
            </Button>
          )}
          {canAssignJd && (
            <Button size="sm" variant="outline" onClick={() => { setFrUser(r); setFrSelected(r.designationId ?? ''); }}>
              Functional Role
            </Button>
          )}
          {canAct &&
            (r.isActive ? (
              <Button size="sm" variant="outline" onClick={() => openAction('deactivate', r)}>
                Deactivate
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => openAction('activate', r)}>
                Activate
              </Button>
            ))}
          {canAct && (
            <Button size="sm" variant="outline" onClick={() => openAction('resetPassword', r)}>
              Reset Password
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage user accounts, requests and bulk onboarding."
        actions={
          <>
            <Link to="/users/requests">
              <Button variant="outline">
                <ClipboardList className="h-4 w-4" /> Requests
              </Button>
            </Link>
            <Link to="/users/bulk">
              <Button variant="outline">
                <Upload className="h-4 w-4" /> Bulk Upload
              </Button>
            </Link>
            {canPrint && (
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            )}
            {canExport && (
              <>
                <Button variant="outline" disabled={exporting} onClick={() => handleExport('xlsx')}>
                  <Download className="h-4 w-4" /> Excel
                </Button>
                <Button variant="outline" disabled={exporting} onClick={() => handleExport('csv')}>
                  <Download className="h-4 w-4" /> CSV
                </Button>
              </>
            )}
            {canWrite && (
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus className="h-4 w-4" /> New User Request
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search users…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          className="w-40"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as StatusFilter);
            setPage(1);
          }}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={statusFilter === 'inactive' ? rows.length : data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No users found."
      />

      <ESignatureModal
        open={esign.open}
        onClose={() => setEsign((s) => ({ ...s, open: false }))}
        onConfirm={confirmAction}
        title={`${ACTION_LABEL[esign.action]} — ${esign.user?.fullName ?? ''}`}
        defaultMeaning={ACTION_MEANING[esign.action]}
        requireReason
      />

      {/* CR-12 read-only View dialog */}
      {lifecycleUser && (
        <LifecycleDialog user={lifecycleUser} canApprove={canApprove} onClose={() => setLifecycleUser(null)} />
      )}

      <Dialog
        open={!!viewUser}
        onClose={() => setViewUser(null)}
        title={`User Details — ${viewUser?.fullName ?? ''}`}
        footer={
          <Button variant="outline" onClick={() => setViewUser(null)}>
            Close
          </Button>
        }
      >
        {viewUser && (
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium text-slate-500">Full Name</dt>
            <dd className="col-span-2">{viewUser.fullName}</dd>
            <dt className="font-medium text-slate-500">Employee ID</dt>
            <dd className="col-span-2">{viewUser.employeeId}</dd>
            <dt className="font-medium text-slate-500">Username</dt>
            <dd className="col-span-2">{viewUser.windowsUsername}</dd>
            <dt className="font-medium text-slate-500">Email</dt>
            <dd className="col-span-2">{viewUser.email || '—'}</dd>
            <dt className="font-medium text-slate-500">User Type</dt>
            <dd className="col-span-2">{viewUser.userType}</dd>
            <dt className="font-medium text-slate-500">Department</dt>
            <dd className="col-span-2">{viewUser.departmentName || '—'}</dd>
            <dt className="font-medium text-slate-500">Location</dt>
            <dd className="col-span-2">{viewUser.locationName || '—'}</dd>
            <dt className="font-medium text-slate-500">Functional Role(s)</dt>
            <dd className="col-span-2">{viewUser.functionalRoleNames && viewUser.functionalRoleNames.length ? viewUser.functionalRoleNames.join(', ') : '—'}</dd>
            <dt className="font-medium text-slate-500">Reporting Manager</dt>
            <dd className="col-span-2">
              {(() => {
                const sup = ((allUsers.data?.data ?? []) as { id: string; fullName: string; employeeId: string }[]).find((u) => u.id === viewUser.supervisorId);
                return sup ? `${sup.fullName} (${sup.employeeId})` : '—';
              })()}
            </dd>
            <dt className="font-medium text-slate-500">Roles</dt>
            <dd className="col-span-2">{viewUser.roleNames && viewUser.roleNames.length ? viewUser.roleNames.join(', ') : '—'}</dd>
            <dt className="font-medium text-slate-500">Status</dt>
            <dd className="col-span-2">
              <Badge tone={viewUser.isActive ? 'APPROVED' : 'default'}>{viewUser.isActive ? 'Active' : 'Inactive'}</Badge>
            </dd>
          </dl>
        )}
      </Dialog>

      {/* CR-13/CR-14: Edit user details (userManagement:write, e-signed) */}
      <Dialog
        open={!!editUser}
        onClose={() => setEditUser(null)}
        title={`Edit User — ${editUser?.fullName ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditUser(null)}>
              Cancel
            </Button>
            <Button disabled={!editFormValid} onClick={() => setEditEsignOpen(true)}>
              Sign &amp; Save…
            </Button>
          </>
        }
      >
        <Field label="Full Name" required error={!editForm.fullName ? 'Full name is required.' : undefined}>
          <Input value={editForm.fullName} onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))} />
        </Field>
        <Field label="Email">
          <Input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="User Type" required>
          <Select options={USER_TYPE_OPTIONS} value={editForm.userType} onChange={(e) => setEditForm((f) => ({ ...f, userType: e.target.value }))} />
        </Field>
        <Field label="Department" required error={!editForm.departmentId ? 'Department is required.' : undefined}>
          <Select
            placeholder="Select department…"
            options={((departments.data?.data ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }))}
            value={editForm.departmentId}
            onChange={(e) => setEditForm((f) => ({ ...f, departmentId: e.target.value }))}
          />
        </Field>
        <Field label="Location" required error={!editForm.locationId ? 'Location is required.' : undefined}>
          <Select
            placeholder="Select location…"
            options={((locations.data?.data ?? []) as { id: string; name: string }[]).map((l) => ({ value: l.id, label: l.name }))}
            value={editForm.locationId}
            onChange={(e) => setEditForm((f) => ({ ...f, locationId: e.target.value }))}
          />
        </Field>
        <Field label="Reporting Manager">
          <SearchableSelect
            placeholder="Select reporting manager…"
            options={supervisorOptions(editUser?.id)}
            value={editForm.supervisorId}
            onChange={(supervisorId) => setEditForm((f) => ({ ...f, supervisorId }))}
            emptyText="No matching users"
          />
        </Field>
        <Field label="Functional Role(s)">
          <MultiSelect
            options={((designations.data?.data ?? []) as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }))}
            value={editForm.designationIds}
            onChange={(designationIds) => setEditForm((f) => ({ ...f, designationIds }))}
            placeholder="Search functional roles…"
          />
        </Field>
      </Dialog>

      {/* CR-14: editing a user requires a two-component e-signature (reason collected here too). */}
      <ESignatureModal
        open={editEsignOpen}
        onClose={() => setEditEsignOpen(false)}
        onConfirm={async (signature) => {
          if (!editUser) return;
          const reason = (signature.reason ?? '').trim();
          if (reason.length < 5) throw new Error('A reason of at least 5 characters is required.');
          const { reason: _r, ...sig } = signature;
          await updateUserMutation.mutateAsync({
            id: editUser.id,
            body: {
              fullName: editForm.fullName,
              email: editForm.email || undefined,
              departmentId: editForm.departmentId,
              locationId: editForm.locationId,
              supervisorId: editForm.supervisorId || undefined,
              designationIds: editForm.designationIds,
              userType: editForm.userType,
              reasonForChange: reason,
              signature: sig,
            },
          });
        }}
        title={`Edit User — ${editUser?.fullName ?? ''}`}
        defaultMeaning="Approved"
        requireReason
      />

      {/* Phase 3: Change roles (userManagement:approve, e-signed) */}
      <Dialog
        open={!!rolesUser}
        onClose={() => setRolesUser(null)}
        title={`Change Roles — ${rolesUser?.fullName ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setRolesUser(null)}>
              Cancel
            </Button>
            <Button disabled={rolesSelected.length === 0} onClick={() => setRolesEsignOpen(true)}>
              Sign &amp; Save…
            </Button>
          </>
        }
      >
        <Field label="Roles (select one or more)">
          <select
            multiple
            className="iz-input h-40"
            value={rolesSelected}
            onChange={(e) => setRolesSelected(Array.from(e.target.selectedOptions, (o) => o.value))}
          >
            {((roles.data?.data ?? []) as { id: string; roleName: string }[]).map((r) => (
              <option key={r.id} value={r.id}>
                {r.roleName}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-slate-500">A role change is a controlled action and requires your electronic signature.</p>
      </Dialog>

      <ESignatureModal
        open={rolesEsignOpen}
        onClose={() => setRolesEsignOpen(false)}
        onConfirm={async (signature) => {
          if (!rolesUser) return;
          const reason = (signature.reason ?? '').trim();
          if (reason.length < 5) throw new Error('A reason of at least 5 characters is required.');
          const { reason: _r, ...sig } = signature;
          await changeRolesMutation.mutateAsync({
            id: rolesUser.id,
            body: { roleIds: rolesSelected, reasonForChange: reason, signature: sig },
          });
        }}
        title={`Change Roles — ${rolesUser?.fullName ?? ''}`}
        defaultMeaning="Approved"
        requireReason
      />

      {/* D-JD1 / CR-50: assign Functional Role → auto-assign approved JD (e-signed). */}
      <Dialog
        open={!!frUser}
        onClose={() => setFrUser(null)}
        title={`Functional Role & JD — ${frUser?.fullName ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setFrUser(null)}>Cancel</Button>
            <Button disabled={!frSelected} onClick={() => setFrEsignOpen(true)}>Assign &amp; Sign…</Button>
          </>
        }
      >
        <Field label="Functional Role" required>
          <Select
            placeholder="Select functional role…"
            options={((designations.data?.data ?? []) as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }))}
            value={frSelected}
            onChange={(e) => setFrSelected(e.target.value)}
          />
        </Field>
        <p className="text-xs text-slate-500">
          Assigning a functional role auto-assigns the approved Job Description template for that role and notifies the user to acknowledge it. If no template exists yet, the role is set but no JD is created.
        </p>
      </Dialog>

      <ESignatureModal
        open={frEsignOpen}
        onClose={() => setFrEsignOpen(false)}
        onConfirm={async (signature) => {
          if (!frUser) return;
          const { reason: _r, ...sig } = signature;
          await assignFrMutation.mutateAsync({ userId: frUser.id, functionalRoleId: frSelected, signature: sig });
        }}
        title={`Assign Functional Role — ${frUser?.fullName ?? ''}`}
        defaultMeaning="Approved"
      />

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New User Request"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  userType: form.userType,
                  fullName: form.fullName,
                  employeeId: form.employeeId,
                  windowsUsername: form.windowsUsername || undefined,
                  email: form.email,
                  departmentId: form.departmentId,
                  locationId: form.locationId,
                  supervisorId: form.supervisorId || undefined,
                  designationIds: form.designationIds,
                  roleIds: form.roleIds,
                  remarks: form.remarks || undefined,
                })
              }
              disabled={createMutation.isPending || !createFormValid}
            >
              {createMutation.isPending ? 'Submitting…' : 'Submit Request'}
            </Button>
          </>
        }
      >
        <Field label="User Type" required>
          <Select options={USER_TYPE_OPTIONS} value={form.userType} onChange={(e) => setForm((f) => ({ ...f, userType: e.target.value }))} />
        </Field>
        <Field label="Full Name" required error={!form.fullName ? 'Full name is required.' : undefined}>
          <Input
            value={form.fullName}
            onChange={(e) => {
              const fullName = e.target.value;
              // D1: auto-fill the username field live from the name until the user edits it.
              setForm((f) => ({ ...f, fullName, ...(usernameTouched ? {} : { windowsUsername: genUsername(fullName) }) }));
            }}
          />
        </Field>
        <Field label="Employee ID" required error={!form.employeeId ? 'Employee ID is required.' : undefined}>
          <Input value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
        </Field>
        <Field label="Username (auto-generated, editable)" hint="Filled from the full name (first.last). Edit to override; a number is added automatically if it already exists.">
          <Input value={form.windowsUsername} onChange={(e) => { setUsernameTouched(true); setForm((f) => ({ ...f, windowsUsername: e.target.value })); }} />
        </Field>
        <Field label="Email" required error={!form.email ? 'Email is required (the temporary password is emailed here).' : undefined}>
          <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="Department" required error={!form.departmentId ? 'Department is required.' : undefined}>
          <Select
            placeholder="Select department…"
            options={((departments.data?.data ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }))}
            value={form.departmentId}
            onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
          />
        </Field>
        <Field label="Location" required error={!form.locationId ? 'Location is required.' : undefined}>
          <Select
            placeholder="Select location…"
            options={((locations.data?.data ?? []) as { id: string; name: string }[]).map((l) => ({ value: l.id, label: l.name }))}
            value={form.locationId}
            onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
          />
        </Field>
        <Field label="Reporting Manager">
          <SearchableSelect
            placeholder="Select reporting manager…"
            options={supervisorOptions()}
            value={form.supervisorId}
            onChange={(supervisorId) => setForm((f) => ({ ...f, supervisorId }))}
            emptyText="No matching users"
          />
        </Field>
        <Field label="Functional Role(s)">
          <MultiSelect
            options={((designations.data?.data ?? []) as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }))}
            value={form.designationIds}
            onChange={(designationIds) => setForm((f) => ({ ...f, designationIds }))}
            placeholder="Search functional roles…"
          />
        </Field>
        <Field label="Roles" required error={form.roleIds.length === 0 ? 'At least one role is required.' : undefined}>
          <select
            multiple
            className="iz-input h-32"
            value={form.roleIds}
            onChange={(e) => setForm((f) => ({ ...f, roleIds: Array.from(e.target.selectedOptions, (o) => o.value) }))}
          >
            {((roles.data?.data ?? []) as { id: string; roleName: string }[]).map((r) => (
              <option key={r.id} value={r.id}>
                {r.roleName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Remarks">
          <Textarea value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
        </Field>
      </Dialog>

      {resetPwdDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-lg font-semibold">Password Reset Successfully</h2>
            <p className="mb-4 text-sm text-slate-500">
              Both the login password and the electronic-signature password have been reset to the same temporary value.
              Share these credentials with the user securely. The temporary password cannot be retrieved again.
            </p>
            <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-4 font-mono text-sm">
              <div className="mb-1">
                <span className="text-slate-500">Username: </span>
                <strong>{resetPwdDialog.username}</strong>
              </div>
              <div>
                <span className="text-slate-500">Temp Password (login &amp; signature): </span>
                <strong>{resetPwdDialog.tempPassword}</strong>
              </div>
            </div>
            <p className="mb-4 text-xs text-amber-600">
              The user will be required to change their login password on their next login. They should also set a new
              electronic-signature password from their profile.
            </p>
            <button
              className="w-full rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              onClick={() => { setResetPwdDialog(null); toast.success('Reset Password completed.'); }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
