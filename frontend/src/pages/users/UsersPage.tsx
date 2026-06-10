import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Upload, ClipboardList } from 'lucide-react';
import { userType as userTypeEnum } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { Button } from '@/components/ui/button';
import { Input, Field, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { svc } from '@/services';

interface UserRow {
  id: string;
  fullName: string;
  employeeId: string;
  windowsUsername: string;
  userType: string;
  email?: string | null;
  departmentId?: string;
  locationId?: string;
  supervisorId?: string | null;
  designationId?: string | null;
  isActive: boolean;
}

const EMPTY_EDIT_FORM = {
  fullName: '',
  email: '',
  departmentId: '',
  locationId: '',
  supervisorId: '',
  designationId: '',
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
  roleIds: [] as string[],
  remarks: '',
};

export default function UsersPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('userManagement', 'write');
  const canApprove = hasPermission('userManagement', 'approve');
  const canAct = canWrite || canApprove;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const [esign, setEsign] = useState<{ open: boolean; action: ActionKind; user?: UserRow; reason: string }>({
    open: false,
    action: 'activate',
    reason: '',
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [resetPwdDialog, setResetPwdDialog] = useState<{ username: string; tempPassword: string } | null>(null);

  // Phase 3: edit details (write) + change roles (approve, e-signed)
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editReasonOpen, setEditReasonOpen] = useState(false);
  const [rolesUser, setRolesUser] = useState<UserRow | null>(null);
  const [rolesSelected, setRolesSelected] = useState<string[]>([]);
  const [rolesEsignOpen, setRolesEsignOpen] = useState(false);

  const params = { page, pageSize: 50, search: search || undefined, includeInactive };
  const { data, isLoading } = useQuery({ queryKey: ['users', params], queryFn: () => svc.users.list(params) });

  const departments = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }) });
  const locations = useQuery({ queryKey: ['locations', 'all'], queryFn: () => svc.locations.list({ pageSize: 200 }) });
  const roles = useQuery({ queryKey: ['roles', 'all'], queryFn: () => svc.roles.list({ pageSize: 200 }) });
  const allUsers = useQuery({ queryKey: ['users', 'supervisors'], queryFn: () => svc.users.list({ pageSize: 500, includeInactive: false }) });
  const designations = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }) });

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
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.users.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User details updated.');
      setEditReasonOpen(false);
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
      key: 'status',
      header: 'Status',
      render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canAct ? (
          <div className="flex flex-wrap gap-1">
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
            {r.isActive ? (
              <Button size="sm" variant="outline" onClick={() => openAction('deactivate', r)}>
                Deactivate
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => openAction('activate', r)}>
                Activate
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => openAction('resetPassword', r)}>
              Reset Password
            </Button>
          </div>
        ) : (
          '—'
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
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => {
              setIncludeInactive(e.target.checked);
              setPage(1);
            }}
          />
          Include Inactive
        </label>
      </div>

      <DataTable
        columns={columns}
        rows={(data?.data ?? []) as unknown as UserRow[]}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
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

      {/* Phase 3: Edit user details (userManagement:write, reason-for-change) */}
      <Dialog
        open={!!editUser}
        onClose={() => setEditUser(null)}
        title={`Edit User — ${editUser?.fullName ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditUser(null)}>
              Cancel
            </Button>
            <Button disabled={!editForm.fullName || !editForm.departmentId || !editForm.locationId} onClick={() => setEditReasonOpen(true)}>
              Save…
            </Button>
          </>
        }
      >
        <Field label="Full Name">
          <Input value={editForm.fullName} onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))} />
        </Field>
        <Field label="Email">
          <Input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="User Type">
          <Select options={USER_TYPE_OPTIONS} value={editForm.userType} onChange={(e) => setEditForm((f) => ({ ...f, userType: e.target.value }))} />
        </Field>
        <Field label="Department">
          <Select
            placeholder="Select department…"
            options={((departments.data?.data ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }))}
            value={editForm.departmentId}
            onChange={(e) => setEditForm((f) => ({ ...f, departmentId: e.target.value }))}
          />
        </Field>
        <Field label="Location">
          <Select
            placeholder="Select location…"
            options={((locations.data?.data ?? []) as { id: string; name: string }[]).map((l) => ({ value: l.id, label: l.name }))}
            value={editForm.locationId}
            onChange={(e) => setEditForm((f) => ({ ...f, locationId: e.target.value }))}
          />
        </Field>
        <Field label="Supervisor">
          <Select
            placeholder="Select supervisor…"
            options={[
              { value: '', label: '— None —' },
              ...((allUsers.data?.data ?? []) as { id: string; fullName: string; employeeId: string }[])
                .filter((u) => u.id !== editUser?.id)
                .map((u) => ({ value: u.id, label: `${u.fullName} (${u.employeeId})` })),
            ]}
            value={editForm.supervisorId}
            onChange={(e) => setEditForm((f) => ({ ...f, supervisorId: e.target.value }))}
          />
        </Field>
        <Field label="Designation">
          <Select
            placeholder="Select designation…"
            options={[{ value: '', label: '— None —' }, ...((designations.data?.data ?? []) as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }))]}
            value={editForm.designationId}
            onChange={(e) => setEditForm((f) => ({ ...f, designationId: e.target.value }))}
          />
        </Field>
      </Dialog>

      <ReasonForChangeDialog
        open={editReasonOpen}
        onClose={() => setEditReasonOpen(false)}
        onConfirm={async (reasonForChange) => {
          if (!editUser) return;
          await updateUserMutation.mutateAsync({
            id: editUser.id,
            body: {
              fullName: editForm.fullName,
              email: editForm.email || undefined,
              departmentId: editForm.departmentId,
              locationId: editForm.locationId,
              supervisorId: editForm.supervisorId || undefined,
              designationId: editForm.designationId || undefined,
              userType: editForm.userType,
              reasonForChange,
            },
          });
        }}
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
                  windowsUsername: form.windowsUsername,
                  email: form.email || undefined,
                  departmentId: form.departmentId,
                  locationId: form.locationId,
                  supervisorId: form.supervisorId || undefined,
                  designationId: form.designationId || undefined,
                  roleIds: form.roleIds,
                  remarks: form.remarks || undefined,
                })
              }
              disabled={
                createMutation.isPending ||
                !form.fullName ||
                !form.employeeId ||
                !form.windowsUsername ||
                !form.departmentId ||
                !form.locationId ||
                form.roleIds.length === 0
              }
            >
              {createMutation.isPending ? 'Submitting…' : 'Submit Request'}
            </Button>
          </>
        }
      >
        <Field label="User Type">
          <Select options={USER_TYPE_OPTIONS} value={form.userType} onChange={(e) => setForm((f) => ({ ...f, userType: e.target.value }))} />
        </Field>
        <Field label="Full Name">
          <Input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
        </Field>
        <Field label="Employee ID">
          <Input value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
        </Field>
        <Field label="Windows Username">
          <Input value={form.windowsUsername} onChange={(e) => setForm((f) => ({ ...f, windowsUsername: e.target.value }))} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="Department">
          <Select
            placeholder="Select department…"
            options={((departments.data?.data ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }))}
            value={form.departmentId}
            onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
          />
        </Field>
        <Field label="Location">
          <Select
            placeholder="Select location…"
            options={((locations.data?.data ?? []) as { id: string; name: string }[]).map((l) => ({ value: l.id, label: l.name }))}
            value={form.locationId}
            onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
          />
        </Field>
        <Field label="Supervisor (optional — for training notifications)">
          <Select
            placeholder="Select supervisor…"
            options={[{ value: '', label: '— None —' }, ...((allUsers.data?.data ?? []) as { id: string; fullName: string; employeeId: string }[]).map((u) => ({ value: u.id, label: `${u.fullName} (${u.employeeId})` }))]}
            value={form.supervisorId}
            onChange={(e) => setForm((f) => ({ ...f, supervisorId: e.target.value }))}
          />
        </Field>
        <Field label="Designation">
          <Select
            placeholder="Select designation…"
            options={[{ value: '', label: '— None —' }, ...((designations.data?.data ?? []) as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }))]}
            value={form.designationId}
            onChange={(e) => setForm((f) => ({ ...f, designationId: e.target.value }))}
          />
        </Field>
        <Field label="Roles">
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
              Share these credentials with the user securely. The temporary password cannot be retrieved again.
            </p>
            <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-4 font-mono text-sm">
              <div className="mb-1">
                <span className="text-slate-500">Username: </span>
                <strong>{resetPwdDialog.username}</strong>
              </div>
              <div>
                <span className="text-slate-500">Temp Password: </span>
                <strong>{resetPwdDialog.tempPassword}</strong>
              </div>
            </div>
            <p className="mb-4 text-xs text-amber-600">
              The user will be required to change this password on their next login.
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
