import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, Printer, Download, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { PERMISSION_CATALOG, PERMISSION_CATEGORIES, type PermModuleDef } from '@izlearn/shared';
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
import { downloadCsv } from '@/lib/csv';
import { svc } from '@/services';

type PermMatrix = Record<string, Record<string, boolean>>;

interface RoleRow {
  id: string;
  roleName: string;
  description?: string;
  isActive: boolean;
  permissions?: PermMatrix;
}

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(PERMISSION_CATEGORIES.map((c) => [c.key, c.label]));

/** A blank matrix containing exactly the catalog's modules + actions, all false. */
function buildEmptyMatrix(): PermMatrix {
  const m: PermMatrix = {};
  for (const def of PERMISSION_CATALOG) {
    m[def.module] = {};
    for (const a of def.actions) m[def.module][a.key] = false;
  }
  return m;
}

/** Project a stored role's permissions onto the catalog (only real actions kept). */
function matrixFromRole(perms?: PermMatrix): PermMatrix {
  const m = buildEmptyMatrix();
  if (!perms) return m;
  for (const def of PERMISSION_CATALOG) {
    const stored = (perms[def.module] ?? {}) as Record<string, boolean>;
    for (const a of def.actions) m[def.module][a.key] = stored[a.key] === true;
  }
  return m;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function grantedCount(matrix: PermMatrix, def: PermModuleDef): number {
  return def.actions.filter((a) => matrix[def.module]?.[a.key]).length;
}

/** A small on/off switch (accessible, dependency-free). */
function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-primary' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

/**
 * Catalog-driven permission editor: modules grouped by category as cards, each
 * showing ONLY its real actions as toggle tiles. Search, expand/collapse, per-module
 * and global select/clear, and a read-only mode.
 */
function PermissionEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: PermMatrix;
  onChange?: (m: PermMatrix) => void;
  readOnly?: boolean;
}) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const set = (next: PermMatrix) => !readOnly && onChange?.(next);
  const toggleAction = (mod: string, key: string) => set({ ...value, [mod]: { ...value[mod], [key]: !value[mod]?.[key] } });
  const setModule = (def: PermModuleDef, on: boolean) => {
    const flags: Record<string, boolean> = {};
    for (const a of def.actions) flags[a.key] = on;
    set({ ...value, [def.module]: flags });
  };
  const setAll = (on: boolean) => {
    const next: PermMatrix = {};
    for (const def of PERMISSION_CATALOG) {
      next[def.module] = {};
      for (const a of def.actions) next[def.module][a.key] = on;
    }
    set(next);
  };

  const term = q.trim().toLowerCase();
  const matches = (def: PermModuleDef) =>
    !term ||
    def.label.toLowerCase().includes(term) ||
    def.module.toLowerCase().includes(term) ||
    def.actions.some((a) => a.label.toLowerCase().includes(term) || a.key.toLowerCase().includes(term));

  const byCategory = useMemo(() => {
    const map = new Map<string, PermModuleDef[]>();
    for (const def of PERMISSION_CATALOG) {
      if (!matches(def)) continue;
      const list = map.get(def.category) ?? [];
      list.push(def);
      map.set(def.category, list);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-slate-300 px-2 py-1.5">
          <Search className="h-4 w-4 text-slate-400" />
          <input className="w-full bg-transparent text-sm outline-none" placeholder="Filter modules / actions…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!readOnly && (
          <>
            <Button size="sm" variant="outline" onClick={() => setAll(true)}>Select All</Button>
            <Button size="sm" variant="outline" onClick={() => setAll(false)}>Clear All</Button>
          </>
        )}
      </div>

      <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
        {PERMISSION_CATEGORIES.filter((c) => byCategory.has(c.key)).map((cat) => {
          const mods = byCategory.get(cat.key)!;
          const isCollapsed = collapsed.has(cat.key);
          return (
            <div key={cat.key}>
              <button
                type="button"
                className="mb-2 flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(cat.key) ? n.delete(cat.key) : n.add(cat.key); return n; })}
              >
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {cat.label}
              </button>
              {!isCollapsed && (
                <div className="grid gap-3 md:grid-cols-2">
                  {mods.map((def) => {
                    const count = grantedCount(value, def);
                    const total = def.actions.length;
                    const allOn = count === total;
                    return (
                      <div key={def.module} className="rounded-lg border border-slate-200 bg-white">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              disabled={readOnly}
                              checked={allOn}
                              ref={(el) => { if (el) el.indeterminate = count > 0 && !allOn; }}
                              onChange={(e) => setModule(def, e.target.checked)}
                            />
                            <span>
                              <span className="block text-sm font-semibold text-slate-800">{def.label}</span>
                              <span className="block font-mono text-[10px] text-slate-400">{def.module}</span>
                            </span>
                          </label>
                          <div className="flex items-center gap-2">
                            <Badge tone={count > 0 ? 'APPROVED' : 'default'}>{count}/{total} granted</Badge>
                            {!readOnly && (
                              <>
                                <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setModule(def, true)}>Select all</button>
                                <button type="button" className="text-xs text-slate-400 hover:text-slate-700" onClick={() => setModule(def, false)}>Clear</button>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="grid gap-2 p-3 sm:grid-cols-2">
                          {def.actions.map((a) => {
                            const on = !!value[def.module]?.[a.key];
                            return (
                              <div
                                key={a.key}
                                className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${on ? 'border-primary/30 bg-primary/5' : 'border-slate-200 bg-slate-50/50'}`}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm text-slate-700">{a.label}</span>
                                  <span className="block font-mono text-[10px] text-slate-400">{a.key}</span>
                                </span>
                                <Toggle on={on} disabled={readOnly} onClick={() => toggleAction(def.module, a.key)} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Build matrix export/print rows from the catalog. */
function matrixRows(matrix: PermMatrix): string[][] {
  const rows: string[][] = [];
  for (const def of PERMISSION_CATALOG) {
    for (const a of def.actions) {
      rows.push([CATEGORY_LABEL[def.category] ?? def.category, def.label, def.module, a.label, a.key, matrix[def.module]?.[a.key] ? 'Yes' : 'No']);
    }
  }
  return rows;
}
const MATRIX_HEADERS = ['Category', 'Module', 'Module Key', 'Action', 'Action Key', 'Granted'];

type StatusFilter = 'active' | 'inactive' | 'all';

export default function RolesPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const me = useAuthStore((s) => s.user);
  const canWrite = hasPermission('roleManagement', 'write');
  const canPrint = hasPermission('roleManagement', 'print');
  const canExport = hasPermission('roleManagement', 'export');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ roleName: '', description: '', permissions: buildEmptyMatrix() });

  const [editRole, setEditRole] = useState<RoleRow | null>(null);
  const [editMatrix, setEditMatrix] = useState<PermMatrix>(buildEmptyMatrix());
  // E1: role identity (name/description) is editable from the same Edit dialog.
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [reason, setReason] = useState('');

  const [viewRole, setViewRole] = useState<RoleRow | null>(null);
  const [toggleTarget, setToggleTarget] = useState<RoleRow | null>(null);
  const [toggleReason, setToggleReason] = useState('');

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
      setCreateForm({ roleName: '', description: '', permissions: buildEmptyMatrix() });
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
        body: { roleName: editName.trim(), description: editDesc.trim() || undefined, permissions: editMatrix, reasonForChange: signState.reason, signature },
      });
    } else {
      await toggleMutation.mutateAsync({ id: signState.id, body: { isActive: signState.isActive, reasonForChange: signState.reason, signature } });
    }
    setSignState(null);
  }

  function openEdit(role: RoleRow) {
    setEditRole(role);
    setEditMatrix(matrixFromRole(role.permissions));
    setEditName(role.roleName);
    setEditDesc(role.description ?? '');
    setReason('');
  }

  const allRows = (data?.data ?? []) as unknown as RoleRow[];
  const rows = statusFilter === 'inactive' ? allRows.filter((r) => !r.isActive) : allRows;
  const editChanged =
    !!editRole &&
    (stableStringify(editMatrix) !== stableStringify(matrixFromRole(editRole.permissions)) ||
      editName.trim() !== editRole.roleName ||
      (editDesc.trim() || '') !== (editRole.description ?? ''));

  function printMatrix(role: RoleRow) {
    const body =
      `<h1>Role Permissions — ${role.roleName}</h1>` +
      `<div class="meta">Status: ${role.isActive ? 'Active' : 'Inactive'} · Printed by ${me?.fullName ?? '—'}</div>` +
      printTable(MATRIX_HEADERS, matrixRows(matrixFromRole(role.permissions)).filter((r) => r[5] === 'Yes'));
    printHtml(`Role Permissions — ${role.roleName}`, body);
  }
  function exportMatrix(role: RoleRow) {
    downloadCsv(`role-${role.roleName}-permissions.csv`, MATRIX_HEADERS, matrixRows(matrixFromRole(role.permissions)));
  }
  function handlePrintList() {
    const body =
      `<h1>Roles &amp; Access Control</h1>` +
      `<div class="meta">Printed by ${me?.fullName ?? '—'} • Filter: ${statusFilter}</div>` +
      printTable(['Role', 'Description', 'Status'], rows.map((r) => [r.roleName, r.description ?? '', r.isActive ? 'Active' : 'Inactive']));
    printHtml('Roles & Access Control', body);
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
              <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Edit</Button>
              <Button size="sm" variant={r.isActive ? 'outline' : 'primary'} onClick={() => { setToggleTarget(r); setToggleReason(''); }}>
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
        title="Roles & Access Control"
        description="Define identity, scope, and per-module permissions. All changes are e-signed and audited."
        actions={
          <div className="flex gap-2">
            {canPrint && <Button variant="outline" onClick={handlePrintList}><Printer className="h-4 w-4" /> Print</Button>}
            {canWrite && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New Role</Button>}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search by name or description…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="iz-input max-w-[10rem]" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}>
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
        className="max-w-5xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button disabled={createMutation.isPending || !createForm.roleName} onClick={() => setSignState({ kind: 'create' })}>
              {createMutation.isPending ? 'Creating…' : 'Create & Sign'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Role Name" required>
            <Input value={createForm.roleName} onChange={(e) => setCreateForm((f) => ({ ...f, roleName: e.target.value }))} />
          </Field>
          <Field label="Description">
            <Input value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Module &amp; Action Permissions</div>
        <PermissionEditor value={createForm.permissions} onChange={(permissions) => setCreateForm((f) => ({ ...f, permissions }))} />
      </Dialog>

      {/* Edit role */}
      <Dialog
        open={!!editRole}
        onClose={() => setEditRole(null)}
        title={`Edit role: ${editRole?.roleName ?? ''}`}
        className="max-w-5xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditRole(null)} disabled={updateMutation.isPending}>Cancel</Button>
            <Button
              disabled={updateMutation.isPending || reason.trim().length < 5 || !editChanged || !editName.trim()}
              onClick={() => editRole && setSignState({ kind: 'edit', id: editRole.id, reason: reason.trim() })}
            >
              {updateMutation.isPending ? 'Saving…' : !editChanged ? 'No changes' : 'Save & Sign'}
            </Button>
          </>
        }
      >
        <div className="mb-3 grid gap-3 md:grid-cols-2">
          <Field label="Role Name" required>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </Field>
          <Field label="Description">
            <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
          </Field>
        </div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Module &amp; Action Permissions</div>
        <PermissionEditor value={editMatrix} onChange={setEditMatrix} />
        <Field label="Reason for change" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why this role is being changed…" />
        </Field>
      </Dialog>

      {/* View role (read-only) */}
      <Dialog
        open={!!viewRole}
        onClose={() => setViewRole(null)}
        title={`Permissions — ${viewRole?.roleName ?? ''}`}
        className="max-w-5xl"
        footer={
          <div className="flex gap-2">
            {canPrint && viewRole && <Button variant="outline" onClick={() => printMatrix(viewRole)}><Printer className="h-4 w-4" /> Print</Button>}
            {canExport && viewRole && <Button variant="outline" onClick={() => exportMatrix(viewRole)}><Download className="h-4 w-4" /> Export</Button>}
            <Button variant="outline" onClick={() => setViewRole(null)}>Close</Button>
          </div>
        }
      >
        {viewRole?.description && <p className="mb-3 text-sm text-slate-600">{viewRole.description}</p>}
        <PermissionEditor value={matrixFromRole(viewRole?.permissions)} readOnly />
      </Dialog>

      {/* Activate / deactivate role */}
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

      {/* Electronic signature for role create / permission edit / status change */}
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
