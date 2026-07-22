import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { Tabs } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { svc } from '@/services';

interface MasterRow {
  id: string;
  name: string;
  description?: string;
  locationId?: string;
  locationName?: string;
  isActive: boolean;
}

interface TypeRow {
  id: string;
  code: string;
  displayName: string;
  description?: string;
  isBuiltIn?: boolean;
  isActive: boolean;
}

const TABS = [
  { key: 'locations', label: 'Locations' },
  { key: 'departments', label: 'Departments' },
  { key: 'designations', label: 'Functional Roles' },
  { key: 'training-types', label: 'Training Types' },
  { key: 'document-types', label: 'Document Types' },
];

/** Active/Inactive toggle shown per row. Deactivating is the soft-delete replacement (CR-44). */
function StatusToggleButton({ isActive, onClick }: { isActive: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      {isActive ? 'Deactivate' : 'Activate'}
    </Button>
  );
}

/** CR Section 3: per-tab client-side search + status filter. */
type StatusFilter = 'active' | 'inactive' | 'all';

const STATUS_FILTER_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

/** "Active" => server returns active only; "Inactive"/"All" => server includes inactive rows. */
function statusWantsInactive(status: StatusFilter): boolean {
  return status !== 'active';
}

/** Filter the currently loaded rows by free-text (displayName/code/name) and status. */
function filterMasterRows<T extends { isActive: boolean; displayName?: string; code?: string; name?: string; description?: string }>(
  rows: T[],
  search: string,
  status: StatusFilter,
): T[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (status === 'active' && !r.isActive) return false;
    if (status === 'inactive' && r.isActive) return false;
    if (!q) return true;
    // Search across all visible text columns of the master row (name/code + description).
    return [r.displayName, r.code, r.name, r.description].some((v) => (v ?? '').toLowerCase().includes(q));
  });
}

/** Search input + status Select + "X of Y" count, rendered above each tab's DataTable. */
function MasterToolbar({
  search,
  onSearch,
  status,
  onStatus,
  shown,
  total,
  action,
}: {
  search: string;
  onSearch: (v: string) => void;
  status: StatusFilter;
  onStatus: (v: StatusFilter) => void;
  shown: number;
  total: number;
  /** Right-aligned action (e.g. the "Add …" button), kept on the same row as the search. */
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Input className="w-64" placeholder="Search by name or code…" value={search} onChange={(e) => onSearch(e.target.value)} />
      <Select className="w-40" options={STATUS_FILTER_OPTIONS} value={status} onChange={(e) => onStatus(e.target.value as StatusFilter)} />
      <span className="text-sm text-slate-500">
        {shown} of {total}
      </span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function LocationsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [edit, setEdit] = useState<MasterRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: MasterRow } | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');

  const params = { page, pageSize: 50, includeInactive: statusWantsInactive(status) };
  const { data, isLoading } = useQuery({ queryKey: ['locations', params], queryFn: () => svc.locations.list(params) });
  const allRows = (data?.data ?? []) as unknown as MasterRow[];
  const rows = filterMasterRows(allRows, search, status);

  const createMutation = useMutation({
    mutationFn: (body: unknown) => svc.locations.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      toast.success('Location created.');
      setCreateOpen(false);
      setForm({ name: '', description: '' });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.locations.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      toast.success('Location updated.');
      setReasonAction(null);
      setEdit(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function openEdit(row: MasterRow) {
    setEdit(row);
    setEditForm({ name: row.name, description: row.description ?? '' });
  }

  const columns: Column<MasterRow>[] = [
    { key: 'name', header: 'Name' },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canWrite ? (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
              Edit
            </Button>
            <StatusToggleButton isActive={r.isActive} onClick={() => setReasonAction({ type: 'toggle', row: r })} />
          </div>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        status={status}
        onStatus={setStatus}
        shown={rows.length}
        total={allRows.length}
        action={canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Location
          </Button>
        )}
      />
      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No locations found."
      />

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Location"
        onSubmit={() => { if (!createMutation.isPending && form.name) createMutation.mutate({ name: form.name, description: form.description || undefined }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !form.name}>
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </Dialog>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Edit Location — ${edit?.name ?? ''}`}
        onSubmit={() => { if (editForm.name && edit) setReasonAction({ type: 'edit', row: edit }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!editForm.name}>
              Save…
            </Button>
          </>
        }
      >
        <Field label="Name" required>
          <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </Dialog>

      <ReasonForChangeDialog
        open={!!reasonAction}
        title={reasonAction?.type === 'toggle' ? (reasonAction.row.isActive ? 'Reason for Deactivation' : 'Reason for Activation') : 'Reason for Change'}
        onClose={() => setReasonAction(null)}
        onConfirm={async (reasonForChange) => {
          if (!reasonAction) return;
          if (reasonAction.type === 'toggle') {
            const r = reasonAction.row;
            await updateMutation.mutateAsync({
              id: r.id,
              body: { name: r.name, description: r.description || undefined, isActive: !r.isActive, reasonForChange },
            });
          } else {
            await updateMutation.mutateAsync({
              id: reasonAction.row.id,
              body: { name: editForm.name, description: editForm.description || undefined, isActive: reasonAction.row.isActive, reasonForChange },
            });
          }
        }}
      />
    </>
  );
}

function DepartmentsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', locationId: '' });
  const [edit, setEdit] = useState<MasterRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', locationId: '' });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: MasterRow } | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');

  const params = { page, pageSize: 50, includeInactive: statusWantsInactive(status) };
  const { data, isLoading } = useQuery({ queryKey: ['departments', params], queryFn: () => svc.departments.list(params) });
  const allRows = (data?.data ?? []) as unknown as MasterRow[];
  const rows = filterMasterRows(allRows, search, status);
  const locations = useQuery({ queryKey: ['locations', 'all'], queryFn: () => svc.locations.list({ pageSize: 200 }) });
  const locationList = (locations.data?.data ?? []) as unknown as { id: string; name: string }[];
  const locationOptions = locationList.map((l) => ({ value: l.id, label: l.name }));
  const locationName = (id?: string) => locationList.find((l) => l.id === id)?.name ?? '—';

  const createMutation = useMutation({
    mutationFn: (body: unknown) => svc.departments.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department created.');
      setCreateOpen(false);
      setForm({ name: '', locationId: '' });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.departments.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department updated.');
      setReasonAction(null);
      setEdit(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function openEdit(row: MasterRow) {
    setEdit(row);
    setEditForm({ name: row.name, locationId: row.locationId ?? '' });
  }

  const columns: Column<MasterRow>[] = [
    { key: 'name', header: 'Name' },
    { key: 'locationName', header: 'Location', render: (r) => locationName(r.locationId) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canWrite ? (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
              Edit
            </Button>
            <StatusToggleButton isActive={r.isActive} onClick={() => setReasonAction({ type: 'toggle', row: r })} />
          </div>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        status={status}
        onStatus={setStatus}
        shown={rows.length}
        total={allRows.length}
        action={canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Department
          </Button>
        )}
      />
      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No departments found."
      />

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Department"
        onSubmit={() => { if (!createMutation.isPending && form.name && form.locationId) createMutation.mutate({ name: form.name, locationId: form.locationId }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !form.name || !form.locationId}>
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Location" required>
          <Select placeholder="Select location…" options={locationOptions} value={form.locationId} onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))} />
        </Field>
      </Dialog>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Edit Department — ${edit?.name ?? ''}`}
        onSubmit={() => { if (editForm.name && editForm.locationId && edit) setReasonAction({ type: 'edit', row: edit }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!editForm.name || !editForm.locationId}>
              Save…
            </Button>
          </>
        }
      >
        <Field label="Name" required>
          <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Location" required>
          <Select placeholder="Select location…" options={locationOptions} value={editForm.locationId} onChange={(e) => setEditForm((f) => ({ ...f, locationId: e.target.value }))} />
        </Field>
      </Dialog>

      <ReasonForChangeDialog
        open={!!reasonAction}
        title={reasonAction?.type === 'toggle' ? (reasonAction.row.isActive ? 'Reason for Deactivation' : 'Reason for Activation') : 'Reason for Change'}
        onClose={() => setReasonAction(null)}
        onConfirm={async (reasonForChange) => {
          if (!reasonAction) return;
          if (reasonAction.type === 'toggle') {
            const r = reasonAction.row;
            await updateMutation.mutateAsync({
              id: r.id,
              body: { name: r.name, locationId: r.locationId, isActive: !r.isActive, reasonForChange },
            });
          } else {
            await updateMutation.mutateAsync({
              id: reasonAction.row.id,
              body: { name: editForm.name, locationId: editForm.locationId, isActive: reasonAction.row.isActive, reasonForChange },
            });
          }
        }}
      />
    </>
  );
}

function TrainingTypesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: '', displayName: '', description: '' });
  const [edit, setEdit] = useState<TypeRow | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', description: '', isActive: true });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: TypeRow } | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');

  const params = { page, pageSize: 50, includeInactive: statusWantsInactive(status) };
  const { data, isLoading } = useQuery({ queryKey: ['training-types', params], queryFn: () => svc.master.listTrainingTypes(params) });
  const allRows = (data?.data ?? []) as unknown as TypeRow[];
  const rows = filterMasterRows(allRows, search, status);

  const createMutation = useMutation({
    mutationFn: (body: unknown) => svc.master.createTrainingType(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['training-types'] });
      toast.success('Training type created.');
      setCreateOpen(false);
      setForm({ code: '', displayName: '', description: '' });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.master.updateTrainingType(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['training-types'] });
      toast.success('Training type updated.');
      setReasonAction(null);
      setEdit(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function openEdit(row: TypeRow) {
    setEdit(row);
    setEditForm({ displayName: row.displayName, description: row.description ?? '', isActive: row.isActive });
  }

  const columns: Column<TypeRow>[] = [
    { key: 'displayName', header: 'Display Name' },
    { key: 'description', header: 'Description', render: (r) => r.description || '—' },
    { key: 'isBuiltIn', header: 'Built-in', render: (r) => r.isBuiltIn ? <Badge tone="APPROVED">Yes</Badge> : '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canWrite ? (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Edit</Button>
            <StatusToggleButton isActive={r.isActive} onClick={() => setReasonAction({ type: 'toggle', row: r })} />
          </div>
        ) : '—',
    },
  ];

  return (
    <>
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        status={status}
        onStatus={setStatus}
        shown={rows.length}
        total={allRows.length}
        action={canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Training Type
          </Button>
        )}
      />
      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No training types found."
      />

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Training Type"
        onSubmit={() => { if (!createMutation.isPending && form.displayName) createMutation.mutate({ code: form.displayName.trim().toUpperCase().replace(/\s+/g, '_'), displayName: form.displayName, description: form.description || undefined }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || !form.displayName}>
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        {/* CR-M2: code is auto-generated from the display name; no manual entry. */}
        <Field label="Display Name" required>
          <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </Dialog>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Edit Training Type — ${edit?.displayName ?? ''}`}
        onSubmit={() => { if (editForm.displayName && edit) setReasonAction({ type: 'edit', row: edit }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button type="submit" disabled={!editForm.displayName}>
              Save…
            </Button>
          </>
        }
      >
        <Field label="Display Name" required>
          <Input value={editForm.displayName} onChange={(e) => setEditForm((f) => ({ ...f, displayName: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </Dialog>

      <ReasonForChangeDialog
        open={!!reasonAction}
        title={reasonAction?.type === 'toggle' ? (reasonAction.row.isActive ? 'Reason for Deactivation' : 'Reason for Activation') : 'Reason for Change'}
        onClose={() => setReasonAction(null)}
        onConfirm={async (reasonForChange) => {
          if (!reasonAction) return;
          if (reasonAction.type === 'toggle') {
            const r = reasonAction.row;
            await updateMutation.mutateAsync({
              id: r.id,
              body: { displayName: r.displayName, description: r.description || undefined, isActive: !r.isActive, reasonForChange },
            });
          } else {
            await updateMutation.mutateAsync({
              id: reasonAction.row.id,
              body: { displayName: editForm.displayName, description: editForm.description || undefined, isActive: editForm.isActive, reasonForChange },
            });
          }
        }}
      />
    </>
  );
}

function DocumentTypesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: '', displayName: '', description: '' });
  const [edit, setEdit] = useState<TypeRow | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', description: '', isActive: true });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: TypeRow } | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');

  const params = { page, pageSize: 50, includeInactive: statusWantsInactive(status) };
  const { data, isLoading } = useQuery({ queryKey: ['document-types', params], queryFn: () => svc.master.listDocumentTypes(params) });
  const allRows = (data?.data ?? []) as unknown as TypeRow[];
  const rows = filterMasterRows(allRows, search, status);

  const createMutation = useMutation({
    mutationFn: (body: unknown) => svc.master.createDocumentType(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-types'] });
      toast.success('Document type created.');
      setCreateOpen(false);
      setForm({ code: '', displayName: '', description: '' });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.master.updateDocumentType(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-types'] });
      toast.success('Document type updated.');
      setReasonAction(null);
      setEdit(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function openEdit(row: TypeRow) {
    setEdit(row);
    setEditForm({ displayName: row.displayName, description: row.description ?? '', isActive: row.isActive });
  }

  const columns: Column<TypeRow>[] = [
    { key: 'displayName', header: 'Display Name' },
    { key: 'description', header: 'Description', render: (r) => r.description || '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canWrite ? (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Edit</Button>
            <StatusToggleButton isActive={r.isActive} onClick={() => setReasonAction({ type: 'toggle', row: r })} />
          </div>
        ) : '—',
    },
  ];

  return (
    <>
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        status={status}
        onStatus={setStatus}
        shown={rows.length}
        total={allRows.length}
        action={canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Document Type
          </Button>
        )}
      />
      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No document types found."
      />

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Document Type"
        onSubmit={() => { if (!createMutation.isPending && form.displayName) createMutation.mutate({ code: form.displayName.trim().toUpperCase().replace(/\s+/g, '_'), displayName: form.displayName, description: form.description || undefined }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || !form.displayName}>
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        {/* CR-M2: code is auto-generated from the display name; no manual entry. */}
        <Field label="Display Name" required>
          <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </Dialog>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Edit Document Type — ${edit?.displayName ?? ''}`}
        onSubmit={() => { if (editForm.displayName && edit) setReasonAction({ type: 'edit', row: edit }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button type="submit" disabled={!editForm.displayName}>
              Save…
            </Button>
          </>
        }
      >
        <Field label="Display Name" required>
          <Input value={editForm.displayName} onChange={(e) => setEditForm((f) => ({ ...f, displayName: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </Dialog>

      <ReasonForChangeDialog
        open={!!reasonAction}
        title={reasonAction?.type === 'toggle' ? (reasonAction.row.isActive ? 'Reason for Deactivation' : 'Reason for Activation') : 'Reason for Change'}
        onClose={() => setReasonAction(null)}
        onConfirm={async (reasonForChange) => {
          if (!reasonAction) return;
          if (reasonAction.type === 'toggle') {
            const r = reasonAction.row;
            await updateMutation.mutateAsync({
              id: r.id,
              body: { displayName: r.displayName, description: r.description || undefined, isActive: !r.isActive, reasonForChange },
            });
          } else {
            await updateMutation.mutateAsync({
              id: reasonAction.row.id,
              body: { displayName: editForm.displayName, description: editForm.description || undefined, isActive: editForm.isActive, reasonForChange },
            });
          }
        }}
      />
    </>
  );
}

function DesignationsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: '', displayName: '', description: '' });
  const [edit, setEdit] = useState<TypeRow | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', description: '', isActive: true });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: TypeRow } | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');

  const params = { page, pageSize: 50, includeInactive: statusWantsInactive(status) };
  const { data, isLoading } = useQuery({ queryKey: ['designations', params], queryFn: () => svc.master.listDesignations(params) });
  const allRows = (data?.data ?? []) as unknown as TypeRow[];
  const rows = filterMasterRows(allRows, search, status);

  const createMutation = useMutation({
    mutationFn: (body: unknown) => svc.master.createDesignation(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['designations'] });
      toast.success('Functional Role created.');
      setCreateOpen(false);
      setForm({ code: '', displayName: '', description: '' });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.master.updateDesignation(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['designations'] });
      toast.success('Functional Role updated.');
      setReasonAction(null);
      setEdit(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function openEdit(row: TypeRow) {
    setEdit(row);
    setEditForm({ displayName: row.displayName, description: row.description ?? '', isActive: row.isActive });
  }

  const columns: Column<TypeRow>[] = [
    { key: 'displayName', header: 'Display Name' },
    { key: 'description', header: 'Description', render: (r) => r.description || '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canWrite ? (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Edit</Button>
            <StatusToggleButton isActive={r.isActive} onClick={() => setReasonAction({ type: 'toggle', row: r })} />
          </div>
        ) : '—',
    },
  ];

  return (
    <>
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        status={status}
        onStatus={setStatus}
        shown={rows.length}
        total={allRows.length}
        action={canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Functional Role
          </Button>
        )}
      />
      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No functional roles found."
      />

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Functional Role"
        onSubmit={() => { if (!createMutation.isPending && form.displayName) createMutation.mutate({ code: form.displayName.trim().toUpperCase().replace(/\s+/g, '_'), displayName: form.displayName, description: form.description || undefined }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || !form.displayName}>
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        {/* CR-M2: code is auto-generated from the display name; no manual entry. */}
        <Field label="Display Name" required>
          <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </Dialog>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Edit Functional Role — ${edit?.displayName ?? ''}`}
        onSubmit={() => { if (editForm.displayName && edit) setReasonAction({ type: 'edit', row: edit }); }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button type="submit" disabled={!editForm.displayName}>
              Save…
            </Button>
          </>
        }
      >
        <Field label="Display Name" required>
          <Input value={editForm.displayName} onChange={(e) => setEditForm((f) => ({ ...f, displayName: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </Dialog>

      <ReasonForChangeDialog
        open={!!reasonAction}
        title={reasonAction?.type === 'toggle' ? (reasonAction.row.isActive ? 'Reason for Deactivation' : 'Reason for Activation') : 'Reason for Change'}
        onClose={() => setReasonAction(null)}
        onConfirm={async (reasonForChange) => {
          if (!reasonAction) return;
          if (reasonAction.type === 'toggle') {
            const r = reasonAction.row;
            await updateMutation.mutateAsync({
              id: r.id,
              body: { displayName: r.displayName, description: r.description || undefined, isActive: !r.isActive, reasonForChange },
            });
          } else {
            await updateMutation.mutateAsync({
              id: reasonAction.row.id,
              body: { displayName: editForm.displayName, description: editForm.description || undefined, isActive: editForm.isActive, reasonForChange },
            });
          }
        }}
      />
    </>
  );
}

export default function MastersPage() {
  const canWrite = useAuthStore((s) => s.hasPermission)('masterSetup', 'write');
  const [tab, setTab] = useState('locations');

  return (
    <div>
      <PageHeader title="Master Setup" description="Manage locations, departments, functional roles, training types, and document types." />

      <div className="mb-4">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
      </div>

      <div className="mt-4">
        {tab === 'locations' && <LocationsTab canWrite={canWrite} />}
        {tab === 'departments' && <DepartmentsTab canWrite={canWrite} />}
        {tab === 'designations' && <DesignationsTab canWrite={canWrite} />}
        {tab === 'training-types' && <TrainingTypesTab canWrite={canWrite} />}
        {tab === 'document-types' && <DocumentTypesTab canWrite={canWrite} />}
      </div>
    </div>
  );
}
