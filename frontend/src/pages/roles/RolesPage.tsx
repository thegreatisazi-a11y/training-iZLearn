import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, Printer } from 'lucide-react';
import { PERMISSION_MODULES, PERMISSION_VERBS, type PermissionVerb } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Field, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { printHtml, printTable } from '@/lib/print';
import { svc } from '@/services';

const ACTIONS = PERMISSION_VERBS;

type PermFlags = Record<PermissionVerb, boolean>;
type PermMatrix = Record<string, PermFlags>;

function blankFlags(): PermFlags {
  return { view: false, create: false, edit: false, archive: false, revise: false, assign: false, review: false, approve: false, print: false, export: false };
}

/** Pretty module label: camelCase → "Title Case". */
function moduleLabel(mod: string): string {
  return mod.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

interface RoleRow {
  id: string;
  roleName: string;
  description?: string;
  isActive: boolean;
  permissions?: PermMatrix;
}

function emptyMatrix(): PermMatrix {
  const m: PermMatrix = {};
  for (const mod of PERMISSION_MODULES) m[mod] = blankFlags();
  return m;
}

function normalise(permissions?: PermMatrix): PermMatrix {
  const base = emptyMatrix();
  if (!permissions) return base;
  for (const mod of PERMISSION_MODULES) {
    base[mod] = { ...base[mod], ...permissions[mod] };
  }
  return base;
}

/**
 * Permission matrix editor with one-click select-all (CR-2): a master toggle,
 * per-column (verb) header toggles and a per-row (module) toggle. Pass
 * `readOnly` to render it as a non-editable View (CR-3).
 */
function PermissionMatrixEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: PermMatrix;
  onChange?: (m: PermMatrix) => void;
  readOnly?: boolean;
}) {
  function set(next: PermMatrix) {
    if (!readOnly) onChange?.(next);
  }
  function toggle(mod: string, action: PermissionVerb) {
    set({ ...value, [mod]: { ...value[mod], [action]: !value[mod][action] } });
  }
  function toggleRow(mod: string, on: boolean) {
    const flags = { ...value[mod] };
    for (const a of ACTIONS) flags[a] = on;
    set({ ...value, [mod]: flags });
  }
  function toggleColumn(action: PermissionVerb, on: boolean) {
    const next: PermMatrix = {};
    for (const mod of PERMISSION_MODULES) next[mod] = { ...value[mod], [action]: on };
    set(next);
  }
  function toggleAll(on: boolean) {
    const next: PermMatrix = {};
    for (const mod of PERMISSION_MODULES) {
      const flags = { ...value[mod] };
      for (const a of ACTIONS) flags[a] = on;
      next[mod] = flags;
    }
    set(next);
  }

  const allOn = PERMISSION_MODULES.every((m) => ACTIONS.every((a) => value[m][a]));
  const columnOn = (a: PermissionVerb) => PERMISSION_MODULES.every((m) => value[m][a]);
  const rowOn = (m: string) => ACTIONS.every((a) => value[m][a]);

  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">
              <label className="flex items-center gap-2">
                <input type="checkbox" disabled={readOnly} checked={allOn} onChange={(e) => toggleAll(e.target.checked)} />
                <span>Module</span>
              </label>
            </th>
            {ACTIONS.map((a) => (
              <th key={a} className="px-3 py-2 text-center font-medium capitalize">
                <label className="flex flex-col items-center gap-1">
                  <span>{a}</span>
                  <input type="checkbox" disabled={readOnly} checked={columnOn(a)} onChange={(e) => toggleColumn(a, e.target.checked)} />
                </label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {PERMISSION_MODULES.map((mod) => (
            <tr key={mod} className="hover:bg-slate-50">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" disabled={readOnly} checked={rowOn(mod)} onChange={(e) => toggleRow(mod, e.target.checked)} />
                  <span>{moduleLabel(mod)}</span>
                </label>
              </td>
              {ACTIONS.map((a) => (
                <td key={a} className="px-3 py-2 text-center">
                  <input type="checkbox" disabled={readOnly} checked={value[mod][a]} onChange={() => toggle(mod, a)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type StatusFilter = 'active' | 'inactive' | 'all';

export default function RolesPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const me = useAuthStore((s) => s.user);
  const canWrite = hasPermission('roleManagement', 'write');
  const canPrint = hasPermission('roleManagement', 'print');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ roleName: '', description: '', permissions: emptyMatrix() });

  const [editRole, setEditRole] = useState<RoleRow | null>(null);
  const [editMatrix, setEditMatrix] = useState<PermMatrix>(emptyMatrix());
  const [reason, setReason] = useState('');

  const [viewRole, setViewRole] = useState<RoleRow | null>(null);
  const [toggleTarget, setToggleTarget] = useState<RoleRow | null>(null);
  const [toggleReason, setToggleReason] = useState('');

  // CR-6: every role create / permission edit / status change is e-signed.
  type SignState =
    | { kind: 'create' }
    | { kind: 'edit'; id: string; reason: string }
    | { kind: 'toggle'; id: string; isActive: boolean; reason: string };
  const [signState, setSignState] = useState<SignState | null>(null);

  const params = { page, pageSize: 50, search: search || undefined, includeInactive: statusFilter !== 'active' };
  const { data, isLoading } = useQuery({ queryKey: ['roles', params], queryFn: () => svc.roles.list(params) });

  const createMutation = useMutation({
    mutationFn: (body: unknown) => svc.roles.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role created.');
      setCreateOpen(false);
      setCreateForm({ roleName: '', description: '', permissions: emptyMatrix() });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.roles.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role updated.');
      setEditRole(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.roles.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role status updated.');
      setToggleReason('');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  /** CR-6: dispatch the signed write for whichever role action is pending. */
  async function onSign(sig: ESignaturePayload) {
    const { reason: sigReason, ...signature } = sig;
    if (!signState) return;
    if (signState.kind === 'create') {
      await createMutation.mutateAsync({
        roleName: createForm.roleName,
        description: createForm.description || undefined,
        permissions: createForm.permissions,
        reasonForChange: (sigReason ?? '').trim(),
        signature,
      });
    } else if (signState.kind === 'edit') {
      await updateMutation.mutateAsync({
        id: signState.id,
        body: { permissions: editMatrix, reasonForChange: signState.reason, signature },
      });
    } else {
      await toggleMutation.mutateAsync({
        id: signState.id,
        body: { isActive: signState.isActive, reasonForChange: signState.reason, signature },
      });
    }
    setSignState(null);
  }

  function openEdit(role: RoleRow) {
    setEditRole(role);
    setEditMatrix(normalise(role.permissions));
    setReason('');
  }

  const allRows = (data?.data ?? []) as unknown as RoleRow[];
  // CR-5: explicit Active / Inactive / All filter (the API returns active-or-all; an
  // "Inactive only" view is derived client-side from the all-inclusive result).
  const rows = statusFilter === 'inactive' ? allRows.filter((r) => !r.isActive) : allRows;

  function handlePrint() {
    const body =
      `<h1>Roles &amp; Permissions</h1>` +
      `<div class="meta">Printed by ${me?.fullName ?? '—'} • Filter: ${statusFilter}</div>` +
      printTable(
        ['Role', 'Description', 'Status'],
        rows.map((r) => [r.roleName, r.description ?? '', r.isActive ? 'Active' : 'Inactive']),
      );
    printHtml('Roles & Permissions', body);
  }

  const columns: Column<RoleRow>[] = [
    { key: 'roleName', header: 'Role' },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setViewRole(r)}>
            <Eye className="h-4 w-4" /> View
          </Button>
          {canWrite && (
            <>
              <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                Edit Permissions
              </Button>
              <Button
                size="sm"
                variant={r.isActive ? 'outline' : 'primary'}
                onClick={() => {
                  setToggleTarget(r);
                  setToggleReason('');
                }}
              >
                {r.isActive ? 'Set Inactive' : 'Set Active'}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Roles"
        description="Define roles and their permission matrix."
        actions={
          <div className="flex gap-2">
            {canPrint && (
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            )}
            {canWrite && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> New Role
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search by name or description…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="iz-input max-w-[10rem]"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as StatusFilter);
            setPage(1);
          }}
        >
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="all">All</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={statusFilter === 'inactive' ? rows.length : data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No roles found."
      />

      {/* Create role */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Role"
        className="max-w-3xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              disabled={createMutation.isPending || !createForm.roleName}
              onClick={() => setSignState({ kind: 'create' })}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Role'}
            </Button>
          </>
        }
      >
        <Field label="Role Name" required>
          <Input value={createForm.roleName} onChange={(e) => setCreateForm((f) => ({ ...f, roleName: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Textarea value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <Field label="Permissions">
          <PermissionMatrixEditor value={createForm.permissions} onChange={(permissions) => setCreateForm((f) => ({ ...f, permissions }))} />
        </Field>
      </Dialog>

      {/* Edit role */}
      <Dialog
        open={!!editRole}
        onClose={() => setEditRole(null)}
        title={`Edit Permissions — ${editRole?.roleName ?? ''}`}
        className="max-w-3xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditRole(null)} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              disabled={updateMutation.isPending || reason.trim().length < 5}
              onClick={() => editRole && setSignState({ kind: 'edit', id: editRole.id, reason: reason.trim() })}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save & Sign'}
            </Button>
          </>
        }
      >
        <Field label="Permissions">
          <PermissionMatrixEditor value={editMatrix} onChange={setEditMatrix} />
        </Field>
        <Field label="Reason for change" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why these permissions are being changed…" />
        </Field>
      </Dialog>

      {/* View role (read-only) — CR-3 */}
      <Dialog
        open={!!viewRole}
        onClose={() => setViewRole(null)}
        title={`Permissions — ${viewRole?.roleName ?? ''}`}
        className="max-w-3xl"
        footer={
          <Button variant="outline" onClick={() => setViewRole(null)}>
            Close
          </Button>
        }
      >
        {viewRole?.description && <p className="mb-3 text-sm text-slate-600">{viewRole.description}</p>}
        <PermissionMatrixEditor value={normalise(viewRole?.permissions)} readOnly />
      </Dialog>

      {/* Activate / deactivate role (CR-1) */}
      <ConfirmDialog
        open={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        title={toggleTarget?.isActive ? 'Set role inactive?' : 'Set role active?'}
        confirmLabel={toggleTarget?.isActive ? 'Set Inactive' : 'Set Active'}
        disabled={toggleReason.trim().length < 5}
        onConfirm={async () => {
          if (toggleTarget) {
            setSignState({ kind: 'toggle', id: toggleTarget.id, isActive: !toggleTarget.isActive, reason: toggleReason.trim() });
            setToggleTarget(null);
          }
        }}
      >
        <p className="text-sm text-slate-600">
          {toggleTarget?.isActive
            ? 'Making this role inactive removes its permissions from everyone holding only this role. Users left with no active role will be blocked from logging in.'
            : 'Reactivating this role restores its permissions to its holders.'}
        </p>
        <Field label="Reason for change" required>
          <Textarea value={toggleReason} onChange={(e) => setToggleReason(e.target.value)} placeholder="Reason for the status change…" />
        </Field>
      </ConfirmDialog>

      {/* CR-6: electronic signature for role create / permission edit / status change */}
      <ESignatureModal
        open={!!signState}
        onClose={() => setSignState(null)}
        title="Sign to apply role change"
        defaultMeaning="Approved"
        requireReason={signState?.kind === 'create'}
        onConfirm={onSign}
      />
    </div>
  );
}
