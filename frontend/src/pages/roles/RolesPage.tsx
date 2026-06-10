import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { PERMISSION_MODULES, PERMISSION_VERBS, type PermissionVerb } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Field, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
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

function PermissionMatrixEditor({ value, onChange }: { value: PermMatrix; onChange: (m: PermMatrix) => void }) {
  function toggle(mod: string, action: PermissionVerb) {
    onChange({ ...value, [mod]: { ...value[mod], [action]: !value[mod][action] } });
  }
  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Module</th>
            {ACTIONS.map((a) => (
              <th key={a} className="px-3 py-2 text-center font-medium capitalize">
                {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {PERMISSION_MODULES.map((mod) => (
            <tr key={mod} className="hover:bg-slate-50">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{moduleLabel(mod)}</td>
              {ACTIONS.map((a) => (
                <td key={a} className="px-3 py-2 text-center">
                  <input type="checkbox" checked={value[mod][a]} onChange={() => toggle(mod, a)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RolesPage() {
  const qc = useQueryClient();
  const canWrite = useAuthStore((s) => s.hasPermission)('roleManagement', 'write');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ roleName: '', description: '', permissions: emptyMatrix() });

  const [editRole, setEditRole] = useState<RoleRow | null>(null);
  const [editMatrix, setEditMatrix] = useState<PermMatrix>(emptyMatrix());
  const [reason, setReason] = useState('');

  const params = { page, pageSize: 50, search: search || undefined, includeInactive };
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

  function openEdit(role: RoleRow) {
    setEditRole(role);
    setEditMatrix(normalise(role.permissions));
    setReason('');
  }

  const columns: Column<RoleRow>[] = [
    { key: 'roleName', header: 'Role' },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canWrite ? (
          <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
            Edit Permissions
          </Button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Roles"
        description="Define roles and their permission matrix."
        actions={
          canWrite && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New Role
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search roles…"
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
        rows={(data?.data ?? []) as unknown as RoleRow[]}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
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
              onClick={() =>
                createMutation.mutate({
                  roleName: createForm.roleName,
                  description: createForm.description || undefined,
                  permissions: createForm.permissions,
                })
              }
            >
              {createMutation.isPending ? 'Creating…' : 'Create Role'}
            </Button>
          </>
        }
      >
        <Field label="Role Name">
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
              onClick={() =>
                editRole &&
                updateMutation.mutate({ id: editRole.id, body: { permissions: editMatrix, reasonForChange: reason.trim() } })
              }
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <Field label="Permissions">
          <PermissionMatrixEditor value={editMatrix} onChange={setEditMatrix} />
        </Field>
        <Field label="Reason for change (required)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why these permissions are being changed…" />
        </Field>
      </Dialog>
    </div>
  );
}
