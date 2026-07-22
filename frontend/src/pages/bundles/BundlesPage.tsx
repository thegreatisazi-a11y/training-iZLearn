import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Pencil, Archive, RotateCcw, Printer } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ExportMenu } from '@/components/common/ExportMenu';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { printHtml, printTable, escapeHtml } from '@/lib/print';
import { svc } from '@/services';
import { BundleForm, EMPTY_BUNDLE_FORM, bundlePayload, type BundleFormValue } from './BundleForm';

interface BundleRow {
  id: string;
  name: string;
  description?: string;
  topicIds: string[];
  departmentIds: string[];
  roleIds: string[];
  designationIds: string[];
  userIds: string[];
  dueDate?: string | null;
  isActive: boolean;
}

export default function BundlesPage() {
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.hasPermission);
  const canCreate = can('bundleManagement', 'create');
  const canEdit = can('bundleManagement', 'edit');
  const canArchive = can('bundleManagement', 'archive');
  const canAssign = can('bundleManagement', 'assign');
  const canExport = can('bundleManagement', 'export');
  const canPrint = can('bundleManagement', 'print');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<BundleFormValue>(EMPTY_BUNDLE_FORM);
  const [edit, setEdit] = useState<BundleRow | null>(null);
  const [editForm, setEditForm] = useState<BundleFormValue>(EMPTY_BUNDLE_FORM);
  const [editReasonOpen, setEditReasonOpen] = useState(false);
  const [archiveRow, setArchiveRow] = useState<{ row: BundleRow; nextActive: boolean } | null>(null);
  const [assignRow, setAssignRow] = useState<BundleRow | null>(null);
  const [assignDueDate, setAssignDueDate] = useState('');
  const [assignSignOpen, setAssignSignOpen] = useState(false);

  const params = { page, pageSize: 50, search: search || undefined, includeInactive };
  const { data, isLoading } = useQuery({ queryKey: ['bundles', params], queryFn: () => svc.bundles.list(params) });

  const createMut = useMutation({
    mutationFn: () => svc.bundles.create(bundlePayload(form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bundles'] });
      toast.success('Bundle created.');
      setCreateOpen(false);
      setForm(EMPTY_BUNDLE_FORM);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.bundles.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bundles'] });
      toast.success('Bundle updated.');
      setEditReasonOpen(false);
      setEdit(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const archiveMut = useMutation({
    mutationFn: ({ id, isActive, reasonForChange }: { id: string; isActive: boolean; reasonForChange: string }) =>
      svc.bundles.setActive(id, isActive, reasonForChange),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['bundles'] });
      toast.success(vars.isActive ? 'Bundle restored.' : 'Bundle archived.');
      setArchiveRow(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const assignMut = useMutation({
    mutationFn: (signature: ESignaturePayload) => {
      const { reason, ...sig } = signature;
      return svc.bundles.assign(assignRow!.id, { dueDate: assignDueDate || undefined, reasonForChange: (reason ?? '').trim(), signature: sig });
    },
    onSuccess: (res) => {
      const count = (res as { count?: number })?.count ?? 0;
      toast.success(`Bundle assigned — ${count} assignment(s) created.`);
      setAssignSignOpen(false);
      setAssignRow(null);
      setAssignDueDate('');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function openEdit(row: BundleRow) {
    setEdit(row);
    setEditForm({
      name: row.name,
      description: row.description ?? '',
      topicIds: row.topicIds ?? [],
      departmentIds: row.departmentIds ?? [],
      designationIds: row.designationIds ?? [],
      userIds: row.userIds ?? [],
      dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : '',
      isActive: row.isActive,
    });
  }

  const rows = (data?.data ?? []) as unknown as BundleRow[];

  function printList() {
    const body =
      `<h1>Bundles</h1><div class="sub">${rows.length} bundle(s) · printed from izLearn</div>` +
      printTable(
        ['Name', 'Topics', 'Targets', 'Status'],
        rows.map((r) => [
          r.name,
          r.topicIds?.length ?? 0,
          `${r.departmentIds?.length ?? 0} dept · ${r.designationIds?.length ?? 0} desig · ${r.userIds?.length ?? 0} user`,
          r.isActive ? 'Active' : 'Inactive',
        ]),
      );
    printHtml('Bundles', body);
  }

  function printOne(r: BundleRow) {
    printHtml(
      `Bundle — ${r.name}`,
      `<h1>${escapeHtml(r.name)}</h1><div class="sub">${escapeHtml(r.description ?? 'Training bundle')}</div>` +
        printTable(
          ['Field', 'Value'],
          [
            ['Topics', r.topicIds?.length ?? 0],
            ['Departments', r.departmentIds?.length ?? 0],
            ['Functional Roles', r.designationIds?.length ?? 0],
            ['Users', r.userIds?.length ?? 0],
            ['Due date', r.dueDate ? String(r.dueDate).slice(0, 10) : '—'],
            ['Status', r.isActive ? 'Active' : 'Inactive'],
          ],
        ),
    );
  }

  const columns: Column<BundleRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <Link to={`/bundles/${r.id}`} className="font-medium text-primary hover:underline">{r.name}</Link> },
    { key: 'topics', header: 'Topics', render: (r) => (r.topicIds?.length ?? 0) },
    { key: 'targets', header: 'Targets', render: (r) => `${r.departmentIds?.length ?? 0} dept · ${r.designationIds?.length ?? 0} desig · ${r.userIds?.length ?? 0} user` },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'WAIVED'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
          {canAssign && (
            <Button size="sm" variant="outline" onClick={() => { setAssignRow(r); setAssignDueDate(''); }}>
              <Send className="h-3.5 w-3.5" /> Assign
            </Button>
          )}
          {canArchive && (r.isActive ? (
            <Button size="sm" variant="outline" onClick={() => setArchiveRow({ row: r, nextActive: false })}><Archive className="h-3.5 w-3.5" /> Archive</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setArchiveRow({ row: r, nextActive: true })}><RotateCcw className="h-3.5 w-3.5" /> Restore</Button>
          ))}
          {canPrint && <Button size="sm" variant="outline" onClick={() => printOne(r)}><Printer className="h-3.5 w-3.5" /> Print</Button>}
          {!canEdit && !canAssign && !canArchive && !canPrint && '—'}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Bundles"
        description="Group training topics and assign them to departments, designations and users together."
        actions={
          <div className="flex flex-wrap gap-2">
            {(canExport || canPrint) && (
              <ExportMenu
                formats={[...(canExport ? (['csv'] as const) : []), ...(canPrint ? (['print'] as const) : [])]}
                onSelect={(f) =>
                  f === 'csv' ? svc.bundles.exportCsv({ search: search || undefined }).catch((e) => toast.error(apiError(e))) : printList()
                }
              />
            )}
            {canCreate && (
              <Button onClick={() => { setForm(EMPTY_BUNDLE_FORM); setCreateOpen(true); }}>
                <Plus className="h-4 w-4" /> New Bundle
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search bundles…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeInactive} onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }} />
          Include Inactive (archived)
        </label>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No bundles found."
      />

      {/* Create */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        className="max-w-2xl"
        title="New Bundle"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMut.isPending}>Cancel</Button>
            <Button disabled={createMut.isPending || !form.name || form.topicIds.length === 0} onClick={() => createMut.mutate()}>
              {createMut.isPending ? 'Saving…' : 'Create'}
            </Button>
          </>
        }
      >
        <BundleForm value={form} onChange={setForm} />
      </Dialog>

      {/* Edit */}
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        className="max-w-2xl"
        title={`Edit Bundle — ${edit?.name ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button disabled={!editForm.name || editForm.topicIds.length === 0} onClick={() => setEditReasonOpen(true)}>Save…</Button>
          </>
        }
      >
        <BundleForm value={editForm} onChange={setEditForm} showStatus />
      </Dialog>

      <ReasonForChangeDialog
        open={editReasonOpen}
        onClose={() => setEditReasonOpen(false)}
        onConfirm={async (reasonForChange) => {
          if (!edit) return;
          await updateMut.mutateAsync({ id: edit.id, body: { ...bundlePayload(editForm), isActive: editForm.isActive, reasonForChange } });
        }}
      />

      {/* Archive / Restore */}
      <ReasonForChangeDialog
        open={!!archiveRow}
        title={archiveRow?.nextActive ? 'Reason for Restoring' : 'Reason for Archiving'}
        onClose={() => setArchiveRow(null)}
        onConfirm={async (reasonForChange) => {
          if (!archiveRow) return;
          await archiveMut.mutateAsync({ id: archiveRow.row.id, isActive: archiveRow.nextActive, reasonForChange });
        }}
      />

      {/* Assign */}
      <Dialog
        open={!!assignRow}
        onClose={() => setAssignRow(null)}
        title={`Assign Bundle — ${assignRow?.name ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAssignRow(null)}>Cancel</Button>
            <Button onClick={() => setAssignSignOpen(true)}>Continue to sign</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          This creates one training assignment for every user in the bundle's target departments, designations and named users, for each published topic in the bundle. Users already assigned are skipped. Assigning training is a controlled action and requires your electronic signature.
        </p>
        <Field label="Due date (optional)">
          <Input type="date" value={assignDueDate} onChange={(e) => setAssignDueDate(e.target.value)} />
        </Field>
      </Dialog>

      <ESignatureModal
        open={assignSignOpen}
        onClose={() => setAssignSignOpen(false)}
        onConfirm={async (sig) => { await assignMut.mutateAsync(sig); }}
        title={`Assign Bundle — ${assignRow?.name ?? ''} (e-signature required)`}
        requireReason
      />
    </div>
  );
}
