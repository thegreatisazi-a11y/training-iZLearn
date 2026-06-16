import { useState } from 'react';
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

function LocationsTab({ canWrite, includeInactive }: { canWrite: boolean; includeInactive: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [edit, setEdit] = useState<MasterRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: MasterRow } | null>(null);

  const params = { page, pageSize: 50, includeInactive };
  const { data, isLoading } = useQuery({ queryKey: ['locations', params], queryFn: () => svc.locations.list(params) });

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
      {canWrite && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Location
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={(data?.data ?? []) as unknown as MasterRow[]}
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
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button disabled={createMutation.isPending || !form.name} onClick={() => createMutation.mutate({ name: form.name, description: form.description || undefined })}>
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
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button disabled={!editForm.name} onClick={() => edit && setReasonAction({ type: 'edit', row: edit })}>
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

function DepartmentsTab({ canWrite, includeInactive }: { canWrite: boolean; includeInactive: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', locationId: '' });
  const [edit, setEdit] = useState<MasterRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', locationId: '' });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: MasterRow } | null>(null);

  const params = { page, pageSize: 50, includeInactive };
  const { data, isLoading } = useQuery({ queryKey: ['departments', params], queryFn: () => svc.departments.list(params) });
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
      {canWrite && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Department
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={(data?.data ?? []) as unknown as MasterRow[]}
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
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button disabled={createMutation.isPending || !form.name || !form.locationId} onClick={() => createMutation.mutate({ name: form.name, locationId: form.locationId })}>
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
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button disabled={!editForm.name || !editForm.locationId} onClick={() => edit && setReasonAction({ type: 'edit', row: edit })}>
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

function TrainingTypesTab({ canWrite, includeInactive }: { canWrite: boolean; includeInactive: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: '', displayName: '', description: '' });
  const [edit, setEdit] = useState<TypeRow | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', description: '', isActive: true });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: TypeRow } | null>(null);

  const params = { page, pageSize: 50, includeInactive };
  const { data, isLoading } = useQuery({ queryKey: ['training-types', params], queryFn: () => svc.master.listTrainingTypes(params) });

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
    { key: 'code', header: 'Code' },
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
      {canWrite && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Training Type
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={(data?.data ?? []) as unknown as TypeRow[]}
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
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button
              disabled={createMutation.isPending || !form.code || !form.displayName}
              onClick={() => createMutation.mutate({ code: form.code, displayName: form.displayName, description: form.description || undefined })}
            >
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        <Field label="Code (unique, e.g. SIMULATION)" required>
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, '_') }))} placeholder="SIMULATION" />
        </Field>
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
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button
              disabled={!editForm.displayName}
              onClick={() => edit && setReasonAction({ type: 'edit', row: edit })}
            >
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

function DocumentTypesTab({ canWrite, includeInactive }: { canWrite: boolean; includeInactive: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: '', displayName: '', description: '' });
  const [edit, setEdit] = useState<TypeRow | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', description: '', isActive: true });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: TypeRow } | null>(null);

  const params = { page, pageSize: 50, includeInactive };
  const { data, isLoading } = useQuery({ queryKey: ['document-types', params], queryFn: () => svc.master.listDocumentTypes(params) });

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
    { key: 'code', header: 'Code' },
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
      {canWrite && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Document Type
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={(data?.data ?? []) as unknown as TypeRow[]}
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
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button
              disabled={createMutation.isPending || !form.code || !form.displayName}
              onClick={() => createMutation.mutate({ code: form.code, displayName: form.displayName, description: form.description || undefined })}
            >
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        <Field label="Code (unique, e.g. TRAINING_RECORD)" required>
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, '_') }))} placeholder="TRAINING_RECORD" />
        </Field>
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
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button
              disabled={!editForm.displayName}
              onClick={() => edit && setReasonAction({ type: 'edit', row: edit })}
            >
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

function DesignationsTab({ canWrite, includeInactive }: { canWrite: boolean; includeInactive: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: '', displayName: '', description: '' });
  const [edit, setEdit] = useState<TypeRow | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', description: '', isActive: true });
  // Both editing and toggling active status require a reason for change (21 CFR Part 11).
  const [reasonAction, setReasonAction] = useState<{ type: 'edit' | 'toggle'; row: TypeRow } | null>(null);

  const params = { page, pageSize: 50, includeInactive };
  const { data, isLoading } = useQuery({ queryKey: ['designations', params], queryFn: () => svc.master.listDesignations(params) });

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
    { key: 'code', header: 'Code' },
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
      {canWrite && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Functional Role
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={(data?.data ?? []) as unknown as TypeRow[]}
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
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button
              disabled={createMutation.isPending || !form.code || !form.displayName}
              onClick={() => createMutation.mutate({ code: form.code, displayName: form.displayName, description: form.description || undefined })}
            >
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        <Field label="Code (unique, e.g. SR_MANAGER)" required>
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, '_') }))} placeholder="SR_MANAGER" />
        </Field>
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
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button disabled={!editForm.displayName} onClick={() => edit && setReasonAction({ type: 'edit', row: edit })}>
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
  const [includeInactive, setIncludeInactive] = useState(false);

  return (
    <div>
      <PageHeader title="Master Setup" description="Manage locations, departments, functional roles, training types, and document types." />

      <div className="mb-4 flex items-center justify-between">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Include Inactive
        </label>
      </div>

      <div className="mt-4">
        {tab === 'locations' && <LocationsTab canWrite={canWrite} includeInactive={includeInactive} />}
        {tab === 'departments' && <DepartmentsTab canWrite={canWrite} includeInactive={includeInactive} />}
        {tab === 'designations' && <DesignationsTab canWrite={canWrite} includeInactive={includeInactive} />}
        {tab === 'training-types' && <TrainingTypesTab canWrite={canWrite} includeInactive={includeInactive} />}
        {tab === 'document-types' && <DocumentTypesTab canWrite={canWrite} includeInactive={includeInactive} />}
      </div>
    </div>
  );
}
