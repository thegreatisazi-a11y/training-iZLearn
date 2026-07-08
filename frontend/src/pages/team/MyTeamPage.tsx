import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, UserPlus, KeyRound, Pencil, UserX } from 'lucide-react';
import { userType as userTypeEnum } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { MultiSelect } from '@/components/common/MultiSelect';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { printHtml, printTable } from '@/lib/print';
import { svc } from '@/services';

interface TeamMember {
  id: string;
  fullName: string;
  employeeId: string;
  isActive: boolean;
  departmentName?: string | null;
  functionalRoleNames?: string[];
  training: { total: number; completed: number; pending: number; overdue: number };
  assessmentsPassed?: number;
  jdAcknowledged: boolean;
  cvCompleted: boolean;
  certificates: number;
  tniPending: number;
}

const USER_TYPE_OPTIONS = userTypeEnum.options.map((v) => ({ value: v, label: v }));

const EMPTY_ADD = {
  userType: 'INTERNAL',
  fullName: '',
  employeeId: '',
  email: '',
  departmentId: '',
  locationId: '',
  designationIds: [] as string[],
  roleIds: [] as string[],
};

/**
 * #4: Add a member directly under the logged-in supervisor. The new member's
 * supervisorId is forced to the supervisor (they can't pick someone else), so the
 * created user is linked under them in the reporting hierarchy. Goes through the normal
 * user-creation request → approval workflow; on approval the supervisor link is applied.
 */
function AddTeamMemberDialog({ open, onClose, supervisorId }: { open: boolean; onClose: () => void; supervisorId: string }) {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [form, setForm] = useState({ ...EMPTY_ADD, departmentId: me?.departmentId ?? '', locationId: me?.locationId ?? '' });
  const [error, setError] = useState('');

  const departments = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }), enabled: open });
  const locations = useQuery({ queryKey: ['locations', 'all'], queryFn: () => svc.locations.list({ pageSize: 200 }), enabled: open });
  const roles = useQuery({ queryKey: ['roles', 'all'], queryFn: () => svc.roles.list({ pageSize: 200 }), enabled: open });
  const designations = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }), enabled: open });
  const deptOpts = ((departments.data?.data ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }));
  const locOpts = ((locations.data?.data ?? []) as { id: string; name: string }[]).map((l) => ({ value: l.id, label: l.name }));
  const roleOpts = ((roles.data?.data ?? []) as { id: string; roleName: string }[]).map((r) => ({ value: r.id, label: r.roleName }));
  const desigOpts = ((designations.data?.data ?? []) as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }));

  const valid = !!form.fullName && !!form.employeeId && !!form.email && !!form.departmentId && !!form.locationId && form.roleIds.length > 0;

  const mutation = useMutation({
    mutationFn: () =>
      // Item D: My Team's add uses its own endpoint (gated on team:create), independent
      // of the Users module's create permission.
      svc.users.createTeamMember({
        userType: form.userType,
        fullName: form.fullName,
        employeeId: form.employeeId,
        email: form.email,
        departmentId: form.departmentId,
        locationId: form.locationId,
        // #4: the new member is linked directly under this supervisor.
        supervisorId,
        designationIds: form.designationIds,
        roleIds: form.roleIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-team'] });
      qc.invalidateQueries({ queryKey: ['user-requests'] });
      toast.success('Member request submitted — they will be linked under you once approved.');
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add Team Member"
      className="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button disabled={mutation.isPending || !valid} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Submitting…' : 'Submit Request'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-slate-500">The new member will be added <strong>directly under you</strong> (your direct report). A username is generated automatically and the request is sent for approval.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="User Type" required>
          <Select options={USER_TYPE_OPTIONS} value={form.userType} onChange={(e) => setForm((f) => ({ ...f, userType: e.target.value }))} />
        </Field>
        <Field label="Employee ID" required>
          <Input value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
        </Field>
      </div>
      <Field label="Full Name" required>
        <Input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
      </Field>
      <Field label="Email" required>
        <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department" required>
          <Select options={deptOpts} placeholder="Select department…" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))} />
        </Field>
        <Field label="Location" required>
          <Select options={locOpts} placeholder="Select location…" value={form.locationId} onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))} />
        </Field>
      </div>
      <Field label="Functional Role(s)">
        <MultiSelect options={desigOpts} value={form.designationIds} onChange={(designationIds) => setForm((f) => ({ ...f, designationIds }))} placeholder="Search functional roles…" />
      </Field>
      <Field label="Roles" required>
        <MultiSelect options={roleOpts} value={form.roleIds} onChange={(roleIds) => setForm((f) => ({ ...f, roleIds }))} placeholder="Search roles…" />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

/**
 * S5: edit a team member from My Team. Fields pre-fill from the user's record; saving is
 * a controlled change — an e-signature (+ reason) is collected and the server enforces
 * the hierarchy (supervisors may only edit their direct reports).
 */
function EditTeamMemberDialog({ member, onClose }: { member: TeamMember | null; onClose: () => void }) {
  const qc = useQueryClient();
  const open = !!member;
  const [form, setForm] = useState({ fullName: '', email: '', departmentId: '', locationId: '', designationIds: [] as string[], userType: 'INTERNAL' });
  const [signOpen, setSignOpen] = useState(false);

  const detail = useQuery({ queryKey: ['user-detail', member?.id], queryFn: () => svc.users.get(member!.id), enabled: open });
  const departments = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }), enabled: open });
  const locations = useQuery({ queryKey: ['locations', 'all'], queryFn: () => svc.locations.list({ pageSize: 200 }), enabled: open });
  const designations = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }), enabled: open });
  const deptOpts = ((departments.data?.data ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }));
  const locOpts = ((locations.data?.data ?? []) as { id: string; name: string }[]).map((l) => ({ value: l.id, label: l.name }));
  const desigOpts = ((designations.data?.data ?? []) as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }));

  useEffect(() => {
    const u = detail.data as Record<string, unknown> | undefined;
    if (!u) return;
    setForm({
      fullName: String(u.fullName ?? ''),
      email: String(u.email ?? ''),
      departmentId: String(u.departmentId ?? ''),
      locationId: String(u.locationId ?? ''),
      designationIds: Array.isArray(u.designationIds) ? (u.designationIds as string[]) : u.designationId ? [String(u.designationId)] : [],
      userType: String(u.userType ?? 'INTERNAL'),
    });
  }, [detail.data]);

  const mutation = useMutation({
    mutationFn: (sig: ESignaturePayload) => {
      const { reason, ...signature } = sig;
      return svc.users.updateTeamMember(member!.id, { ...form, reasonForChange: (reason ?? '').trim() || 'Team member updated', signature });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-team'] });
      toast.success('Team member updated.');
      setSignOpen(false);
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = !!form.fullName && !!form.email && !!form.departmentId && !!form.locationId;
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={`Edit — ${member?.fullName ?? ''}`}
        className="max-w-xl"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!valid} onClick={() => setSignOpen(true)}>Save changes…</Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-slate-500">Editing is a controlled change — you'll sign with your signature password to confirm.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full Name" required><Input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} /></Field>
          <Field label="User Type" required><Select options={USER_TYPE_OPTIONS} value={form.userType} onChange={(e) => setForm((f) => ({ ...f, userType: e.target.value }))} /></Field>
        </div>
        <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department" required><Select options={deptOpts} placeholder="Select department…" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))} /></Field>
          <Field label="Location" required><Select options={locOpts} placeholder="Select location…" value={form.locationId} onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))} /></Field>
        </div>
        <Field label="Functional Role(s)">
          <MultiSelect options={desigOpts} value={form.designationIds} onChange={(designationIds) => setForm((f) => ({ ...f, designationIds }))} placeholder="Search functional roles…" />
        </Field>
      </Dialog>
      <ESignatureModal open={signOpen} onClose={() => setSignOpen(false)} title={`Sign to update ${member?.fullName ?? ''}`} onConfirm={async (sig) => { await mutation.mutateAsync(sig); }} />
    </>
  );
}

/**
 * Supervisor team view: the logged-in user's IMMEDIATE direct reports only. Click a
 * member to open their detail page. Supervisors can add a member (linked under them)
 * and reset a direct report's password.
 */
export default function MyTeamPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.hasPermission);
  const me = useAuthStore((s) => s.user);
  const canPrint = can('team', 'print');
  // Item D: "Add Team Member" has its OWN permission (team:create), independent of the
  // Users module. Read EXACTLY from the matrix so the derived `write`/legacy fallback
  // doesn't implicitly re-enable it.
  const teamPerms = (useAuthStore((s) => s.user?.permissions) as Record<string, Record<string, boolean>> | undefined)?.team ?? {};
  const canAddMember = teamPerms.create === true;
  // S5: edit / deactivate a team member — each its own permission (hierarchy-enforced server-side).
  const canEditMember = teamPerms.edit === true;
  const canDeactivateMember = teamPerms.deactivate === true;
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TeamMember | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<TeamMember | null>(null);
  // #5: reset a direct report's password (e-signed); shows the temporary password once.
  const [resetTarget, setResetTarget] = useState<TeamMember | null>(null);
  const [resetResult, setResetResult] = useState<{ username: string; tempPassword: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-team', search],
    queryFn: () => svc.users.team({ pageSize: 200, search: search || undefined }),
  });

  const rows = (data?.data ?? []) as unknown as TeamMember[];

  const resetMutation = useMutation({
    mutationFn: (sig: ESignaturePayload) => {
      const { reason, ...signature } = sig;
      return svc.users.resetPassword(resetTarget!.id, { reasonForChange: (reason ?? '').trim(), signature }) as Promise<{
        windowsUsername?: string;
        tempPassword?: string;
      }>;
    },
    onSuccess: (r) => {
      setResetResult({ username: r.windowsUsername ?? resetTarget?.employeeId ?? '', tempPassword: r.tempPassword ?? '' });
      setResetTarget(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // S5: deactivate a team member (e-signed; server enforces the hierarchy).
  const deactivateMutation = useMutation({
    mutationFn: (sig: ESignaturePayload) => {
      const { reason, ...signature } = sig;
      return svc.users.deactivateTeamMember(deactivateTarget!.id, { reasonForChange: (reason ?? '').trim() || 'Team member deactivated', signature });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-team'] });
      toast.success('Team member deactivated.');
      setDeactivateTarget(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function handlePrint() {
    const body =
      `<h1>My Team</h1>` +
      `<div class="sub">${rows.length} team member(s)</div>` +
      printTable(
        ['Name', 'Employee ID', 'Functional Role(s)', 'Training (done/total)', 'Assessments passed', 'JD Ack', 'CV', 'Certificates', 'TNI pending'],
        rows.map((r) => [
          r.fullName,
          r.employeeId,
          (r.functionalRoleNames ?? []).join(', '),
          `${r.training.completed}/${r.training.total}`,
          r.assessmentsPassed ?? 0,
          r.jdAcknowledged ? 'Yes' : 'Pending',
          r.cvCompleted ? 'Yes' : 'No',
          r.certificates,
          r.tniPending,
        ]),
      );
    printHtml('My Team', body);
  }

  const columns: Column<TeamMember>[] = [
    {
      key: 'name',
      header: 'Team Member',
      render: (r) => (
        <button className="text-left hover:underline" onClick={() => navigate(`/team/${r.id}`)}>
          <div className="font-medium text-primary">{r.fullName} {!r.isActive && <span className="text-xs text-slate-400">(inactive)</span>}</div>
          <div className="text-xs text-slate-500">{r.employeeId}{r.departmentName ? ` · ${r.departmentName}` : ''}</div>
        </button>
      ),
    },
    { key: 'fr', header: 'Functional Role(s)', render: (r) => (r.functionalRoleNames?.length ? r.functionalRoleNames.join(', ') : '—') },
    {
      key: 'training',
      header: 'Training',
      render: (r) => (
        <div className="flex flex-wrap gap-1 text-xs">
          <Badge tone="COMPLETED">{r.training.completed} done</Badge>
          {r.training.pending > 0 && <Badge tone="PENDING">{r.training.pending} pending</Badge>}
          {r.training.overdue > 0 && <Badge tone="REJECTED">{r.training.overdue} overdue</Badge>}
          {r.training.total === 0 && <span className="text-slate-400">none</span>}
        </div>
      ),
    },
    { key: 'assessments', header: 'Assessments', render: (r) => <span className="text-sm">{r.assessmentsPassed ?? 0} passed</span> },
    { key: 'jd', header: 'JD Ack', render: (r) => (r.jdAcknowledged ? <Badge tone="COMPLETED">Yes</Badge> : <Badge tone="PENDING">Pending</Badge>) },
    { key: 'cv', header: 'CV', render: (r) => (r.cvCompleted ? '✓' : '—') },
    { key: 'certs', header: 'Certificates', render: (r) => r.certificates },
    { key: 'tni', header: 'TNI Pending', render: (r) => (r.tniPending > 0 ? r.tniPending : '—') },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/team/${r.id}`)}>
            Details <ChevronRight className="h-4 w-4" />
          </Button>
          {/* S5: edit / deactivate (gated on team:edit / team:deactivate). */}
          {canEditMember && (
            <Button size="sm" variant="outline" onClick={() => setEditTarget(r)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
          {canDeactivateMember && r.isActive && (
            <Button size="sm" variant="outline" onClick={() => setDeactivateTarget(r)}>
              <UserX className="h-4 w-4" /> Deactivate
            </Button>
          )}
          {/* #5: reset a DIRECT report's password. */}
          <Button size="sm" variant="outline" onClick={() => setResetTarget(r)}>
            <KeyRound className="h-4 w-4" /> Reset Password
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="My Team"
        description="Your direct reportees — their training, JD, CV and certificate status."
        actions={
          <div className="flex gap-2">
            {canAddMember && me && (
              <Button onClick={() => setAddOpen(true)}>
                <UserPlus className="h-4 w-4" /> Add Team Member
              </Button>
            )}
            {canPrint && <Button variant="outline" onClick={handlePrint}>Print</Button>}
          </div>
        }
      />
      <div className="mb-4">
        <Input className="max-w-xs" placeholder="Search name or employee ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <DataTable columns={columns} rows={rows} loading={isLoading} emptyText="You have no direct reportees yet." />

      {me && <AddTeamMemberDialog open={addOpen} onClose={() => setAddOpen(false)} supervisorId={me.id} />}

      {/* S5: edit / deactivate a team member. */}
      <EditTeamMemberDialog member={editTarget} onClose={() => setEditTarget(null)} />
      <ESignatureModal
        open={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        title={`Deactivate — ${deactivateTarget?.fullName ?? ''}`}
        onConfirm={async (sig) => { await deactivateMutation.mutateAsync(sig); }}
      />

      {/* #5: e-signature to reset the selected direct report's password. */}
      <ESignatureModal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        onConfirm={async (sig) => { await resetMutation.mutateAsync(sig); }}
        title={`Reset Password — ${resetTarget?.fullName ?? ''}`}
        defaultMeaning="Performed"
        requireReason
      />

      {/* Temporary-password result (shown once). */}
      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-lg font-semibold">Password Reset Successfully</h2>
            <p className="mb-4 text-sm text-slate-500">
              Both the login and electronic-signature passwords were reset to the same temporary value. Share it securely — it cannot be retrieved again.
            </p>
            <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-4 font-mono text-sm">
              <div className="mb-1"><span className="text-slate-500">Username: </span><strong>{resetResult.username}</strong></div>
              <div><span className="text-slate-500">Temp Password: </span><strong>{resetResult.tempPassword}</strong></div>
            </div>
            <p className="mb-4 text-xs text-amber-600">The member must change their login password at next login.</p>
            <button
              className="w-full rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              onClick={() => { setResetResult(null); toast.success('Password reset completed.'); }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
