import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Building2, Shield, Users, BadgeCheck, Pencil, Send, Archive, RotateCcw, Download, Printer } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Field } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { printHtml, printTable, escapeHtml } from '@/lib/print';
import { downloadCsv } from '@/lib/csv';
import { svc } from '@/services';
import { BundleForm, EMPTY_BUNDLE_FORM, bundlePayload, type BundleFormValue } from './BundleForm';

interface BundleTopic {
  id: string;
  topicCode: string;
  topicNumber?: string | null;
  title: string;
  currentVersion: number;
  status: string;
  trainingType: string;
}

interface BundleDetail {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  topicIds: string[];
  departmentIds: string[];
  designationIds: string[];
  userIds: string[];
  dueDate?: string | null;
  topics: BundleTopic[];
  departments: { id: string; name: string }[];
  roles: { id: string; roleName: string }[];
  designations: { id: string; displayName: string }[];
  users: { id: string; fullName: string; employeeId: string }[];
  resolvedUserCount: number;
  counts: { total: number; pending: number; inProgress: number; completed: number; overdue: number; blocked: number; waived: number };
}

const STATUS_TONE: Record<string, 'APPROVED' | 'PENDING' | 'WAIVED'> = { PUBLISHED: 'APPROVED', DRAFT: 'PENDING', UNDER_REVIEW: 'PENDING', ARCHIVED: 'WAIVED' };

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent>
        <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function BundleDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.hasPermission);
  const canEdit = can('bundleManagement', 'edit');
  const canArchive = can('bundleManagement', 'archive');
  const canAssign = can('bundleManagement', 'assign');
  const canExport = can('bundleManagement', 'export');
  const canPrint = can('bundleManagement', 'print');

  const { data, isLoading } = useQuery({ queryKey: ['bundle-detail', id], queryFn: () => svc.bundles.detail(id), enabled: !!id });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<BundleFormValue>(EMPTY_BUNDLE_FORM);
  const [editReasonOpen, setEditReasonOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDueDate, setAssignDueDate] = useState('');
  const [assignSignOpen, setAssignSignOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bundle-detail', id] });
    qc.invalidateQueries({ queryKey: ['bundles'] });
  };

  const updateMut = useMutation({
    mutationFn: (body: unknown) => svc.bundles.update(id, body),
    onSuccess: () => { invalidate(); toast.success('Bundle updated.'); setEditReasonOpen(false); setEditOpen(false); },
    onError: (e) => toast.error(apiError(e)),
  });

  const archiveMut = useMutation({
    mutationFn: ({ isActive, reasonForChange }: { isActive: boolean; reasonForChange: string }) => svc.bundles.setActive(id, isActive, reasonForChange),
    onSuccess: (_d, vars) => { invalidate(); toast.success(vars.isActive ? 'Bundle restored.' : 'Bundle archived.'); setArchiveOpen(false); },
    onError: (e) => toast.error(apiError(e)),
  });

  const assignMut = useMutation({
    mutationFn: (signature: ESignaturePayload) => {
      const { reason, ...sig } = signature;
      return svc.bundles.assign(id, { dueDate: assignDueDate || undefined, reasonForChange: (reason ?? '').trim(), signature: sig });
    },
    onSuccess: (res) => {
      const count = (res as { count?: number })?.count ?? 0;
      toast.success(`Bundle assigned — ${count} assignment(s) created.`);
      invalidate();
      setAssignSignOpen(false);
      setAssignOpen(false);
      setAssignDueDate('');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading || !data) return <PageLoader />;
  const b = data as unknown as BundleDetail;

  function openEdit() {
    setEditForm({
      name: b.name,
      description: b.description ?? '',
      topicIds: b.topicIds ?? [],
      departmentIds: b.departmentIds ?? [],
      designationIds: b.designationIds ?? [],
      userIds: b.userIds ?? [],
      dueDate: b.dueDate ? String(b.dueDate).slice(0, 10) : '',
      isActive: b.isActive,
    });
    setEditOpen(true);
  }

  function exportCsv() {
    downloadCsv(
      `bundle-${b.name}.csv`,
      ['Topic No.', 'Topic', 'Type', 'Version', 'Status'],
      b.topics.map((t) => [t.topicNumber || t.topicCode, t.title, t.trainingType, `v${t.currentVersion}`, t.status]),
    );
  }

  function printDetail() {
    const body =
      `<h1>${escapeHtml(b.name)}</h1><div class="sub">${escapeHtml(b.description ?? 'Training bundle')} · ${b.isActive ? 'Active' : 'Inactive'}</div>` +
      `<div class="section">Topics (${b.topics.length})</div>` +
      printTable(['Topic No.', 'Topic', 'Type', 'Version', 'Status'], b.topics.map((t) => [t.topicNumber || t.topicCode, t.title, t.trainingType, `v${t.currentVersion}`, t.status])) +
      `<div class="section">Targets</div>` +
      printTable(
        ['Departments', 'Functional Roles', 'Roles', 'Resolved users'],
        [[b.departments.map((d) => d.name).join(', ') || '—', b.designations.map((d) => d.displayName).join(', ') || '—', b.roles.map((r) => r.roleName).join(', ') || '—', b.resolvedUserCount]],
      );
    printHtml(`Bundle — ${b.name}`, body);
  }

  const topicColumns: Column<BundleTopic>[] = [
    { key: 'num', header: 'Topic No.', render: (r) => <span className="font-mono text-xs">{r.topicNumber || r.topicCode}</span> },
    { key: 'title', header: 'Topic', render: (r) => <button className="text-primary hover:underline" onClick={() => navigate(`/topics/${r.id}`)}>{r.title}</button> },
    { key: 'trainingType', header: 'Type', render: (r) => r.trainingType.replace(/_/g, ' ') },
    { key: 'currentVersion', header: 'Version', render: (r) => `v${r.currentVersion}` },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'default'}>{r.status}</Badge> },
  ];

  return (
    <div>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => navigate('/bundles')}>
        <ArrowLeft className="h-4 w-4" /> Back to bundles
      </button>

      <PageHeader
        title={b.name}
        description={b.description || 'Training bundle'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={b.isActive ? 'APPROVED' : 'WAIVED'}>{b.isActive ? 'Active' : 'Inactive'}</Badge>
            {canEdit && <Button variant="outline" onClick={openEdit}><Pencil className="h-4 w-4" /> Edit</Button>}
            {canAssign && <Button variant="outline" onClick={() => { setAssignDueDate(''); setAssignOpen(true); }}><Send className="h-4 w-4" /> Assign</Button>}
            {canArchive && (b.isActive
              ? <Button variant="outline" onClick={() => setArchiveOpen(true)}><Archive className="h-4 w-4" /> Archive</Button>
              : <Button variant="outline" onClick={() => setArchiveOpen(true)}><RotateCcw className="h-4 w-4" /> Restore</Button>)}
            {canExport && <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> Export</Button>}
            {canPrint && <Button variant="outline" onClick={printDetail}><Printer className="h-4 w-4" /> Print</Button>}
          </div>
        }
      />

      <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Assignment Status</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Total" value={b.counts.total} tone="text-slate-800" />
        <Stat label="Pending" value={b.counts.pending} tone="text-amber-600" />
        <Stat label="In Progress" value={b.counts.inProgress} tone="text-blue-600" />
        <Stat label="Completed" value={b.counts.completed} tone="text-green-600" />
        <Stat label="Overdue" value={b.counts.overdue} tone="text-red-600" />
        <Stat label="Blocked" value={b.counts.blocked} tone="text-red-600" />
      </div>

      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase text-slate-500"><BookOpen className="h-4 w-4" /> Topics ({b.topics.length})</h2>
      <div className="mb-6">
        <DataTable columns={topicColumns} rows={b.topics} emptyText="No topics in this bundle." />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Building2 className="h-4 w-4" /> Departments ({b.departments.length})</div>
            <ul className="space-y-1 text-sm text-slate-600">
              {b.departments.map((d) => <li key={d.id}>{d.name}</li>)}
              {b.departments.length === 0 && <li className="text-slate-400">—</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><BadgeCheck className="h-4 w-4" /> Functional Roles ({b.designations.length})</div>
            <ul className="space-y-1 text-sm text-slate-600">
              {b.designations.map((d) => <li key={d.id}>{d.displayName}</li>)}
              {b.designations.length === 0 && <li className="text-slate-400">—</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Shield className="h-4 w-4" /> Roles ({b.roles.length})</div>
            <ul className="space-y-1 text-sm text-slate-600">
              {b.roles.map((r) => <li key={r.id}>{r.roleName}</li>)}
              {b.roles.length === 0 && <li className="text-slate-400">—</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Users className="h-4 w-4" /> Resolved Users ({b.resolvedUserCount})</div>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-slate-600">
              {b.users.map((u) => <li key={u.id}>{u.fullName} <span className="text-slate-400">({u.employeeId})</span></li>)}
              {b.users.length === 0 && <li className="text-slate-400">—</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Edit */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        className="max-w-2xl"
        title={`Edit Bundle — ${b.name}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button disabled={!editForm.name || editForm.topicIds.length === 0} onClick={() => setEditReasonOpen(true)}>Save…</Button>
          </>
        }
      >
        <BundleForm value={editForm} onChange={setEditForm} showStatus />
      </Dialog>

      <ReasonForChangeDialog
        open={editReasonOpen}
        onClose={() => setEditReasonOpen(false)}
        onConfirm={async (reasonForChange) => { await updateMut.mutateAsync({ ...bundlePayload(editForm), isActive: editForm.isActive, reasonForChange }); }}
      />

      {/* Archive / Restore */}
      <ReasonForChangeDialog
        open={archiveOpen}
        title={b.isActive ? 'Reason for Archiving' : 'Reason for Restoring'}
        onClose={() => setArchiveOpen(false)}
        onConfirm={async (reasonForChange) => { await archiveMut.mutateAsync({ isActive: !b.isActive, reasonForChange }); }}
      />

      {/* Assign */}
      <Dialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title={`Assign Bundle — ${b.name}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={() => setAssignSignOpen(true)}>Continue to sign</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          This creates one training assignment for every user in the bundle's target departments, functional roles and named users, for each published topic. Already-assigned users are skipped. Assigning training requires your electronic signature.
        </p>
        <Field label="Due date (optional)">
          <Input type="date" value={assignDueDate} onChange={(e) => setAssignDueDate(e.target.value)} />
        </Field>
      </Dialog>

      <ESignatureModal
        open={assignSignOpen}
        onClose={() => setAssignSignOpen(false)}
        onConfirm={async (sig) => { await assignMut.mutateAsync(sig); }}
        title={`Assign Bundle — ${b.name} (e-signature required)`}
        requireReason
      />
    </div>
  );
}
