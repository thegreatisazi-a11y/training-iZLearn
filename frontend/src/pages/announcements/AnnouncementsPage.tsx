import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/spinner';
import { EmptyState } from '@/components/common/EmptyState';
import { MultiSelect } from '@/components/common/MultiSelect';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { formatDate, toDateInput } from '@/lib/format';
import { svc } from '@/services';

interface Announcement {
  id: string;
  title: string;
  content: string;
  targetRoles?: string[];
  expiresAt?: string;
  isActive: boolean;
}

const EMPTY_FORM = { title: '', content: '', targetRoles: [] as string[], expiresAt: '' };

export default function AnnouncementsPage() {
  const qc = useQueryClient();
  const canManage = useAuthStore((s) => s.hasPermission)('announcements', 'write');

  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [viewing, setViewing] = useState<Announcement | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [reasonRow, setReasonRow] = useState<Announcement | null>(null);
  const [deactivateRow, setDeactivateRow] = useState<Announcement | null>(null);

  const feed = useQuery({ queryKey: ['announcements', 'feed'], queryFn: () => svc.announcements.feed() });

  // Managers see active AND inactive announcements (so deactivated ones can be reactivated).
  const params = { page, pageSize: 50, includeInactive: true };
  const manage = useQuery({
    queryKey: ['announcements', params],
    queryFn: () => svc.announcements.list(params),
    enabled: canManage,
  });
  const roles = useQuery({ queryKey: ['roles', 'all'], queryFn: () => svc.roles.list({ pageSize: 200 }), enabled: canManage });

  const createMutation = useMutation({
    mutationFn: (body: unknown) => svc.announcements.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Announcement created.');
      closeDialog();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.announcements.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Announcement updated.');
      setReasonRow(null);
      closeDialog();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const removeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => svc.announcements.remove(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Announcement deactivated.');
      setDeactivateRow(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Restore: reactivate a deactivated announcement.
  const activateMutation = useMutation({
    mutationFn: (id: string) => svc.announcements.update(id, { isActive: true, reasonForChange: 'Reactivated' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Announcement reactivated.');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(a: Announcement) {
    setEditing(a);
    setForm({ title: a.title, content: a.content, targetRoles: a.targetRoles ?? [], expiresAt: toDateInput(a.expiresAt) });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function submitDialog() {
    const payload = {
      title: form.title,
      content: form.content,
      targetRoles: form.targetRoles,
      expiresAt: form.expiresAt || undefined,
    };
    if (editing) {
      setReasonRow(editing);
    } else {
      createMutation.mutate(payload);
    }
  }

  const columns: Column<Announcement>[] = [
    { key: 'title', header: 'Title' },
    { key: 'expiresAt', header: 'Expires', render: (r) => formatDate(r.expiresAt) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
            View
          </Button>
          <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
            Edit
          </Button>
          {r.isActive ? (
            <Button size="sm" variant="danger" onClick={() => setDeactivateRow(r)}>
              Deactivate
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={activateMutation.isPending} onClick={() => activateMutation.mutate(r.id)}>
              Activate
            </Button>
          )}
        </div>
      ),
    },
  ];

  const feedItems: Announcement[] = (feed.data ?? []) as unknown as Announcement[];

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Organisation announcements and your personal feed."
        actions={
          canManage && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> New Announcement
            </Button>
          )
        }
      />

      {canManage && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Manage</h2>
          <DataTable
            columns={columns}
            rows={(manage.data?.data ?? []) as unknown as Announcement[]}
            loading={manage.isLoading}
            page={manage.data?.page ?? page}
            pageSize={manage.data?.pageSize ?? 50}
            total={manage.data?.total ?? 0}
            onPageChange={setPage}
            emptyText="No announcements yet."
          />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">My Feed</h2>
        {feed.isLoading ? (
          <PageLoader />
        ) : feedItems.length === 0 ? (
          <EmptyState message="No announcements for you right now." />
        ) : (
          <div className="space-y-3">
            {feedItems.map((a) => (
              <Card key={a.id}>
                <CardContent>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-800">{a.title}</div>
                    {a.expiresAt && <span className="text-xs text-slate-400">Expires {formatDate(a.expiresAt)}</span>}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{a.content}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* View announcement (read-only) */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.title ?? 'Announcement'}
        className="max-w-2xl"
        footer={<Button variant="outline" onClick={() => setViewing(null)}>Close</Button>}
      >
        <div className="mb-2 flex items-center gap-3 text-xs text-slate-400">
          <Badge tone={viewing?.isActive ? 'APPROVED' : 'default'}>{viewing?.isActive ? 'Active' : 'Inactive'}</Badge>
          {viewing?.expiresAt && <span>Expires {formatDate(viewing.expiresAt)}</span>}
        </div>
        <div className="whitespace-pre-wrap text-sm text-slate-700">{viewing?.content}</div>
      </Dialog>

      {/* Create / Edit dialog */}
      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? 'Edit Announcement' : 'New Announcement'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={closeDialog} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button disabled={createMutation.isPending || !form.title || !form.content} onClick={submitDialog}>
              {editing ? 'Save…' : createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="Content" required>
          <Textarea
            className="min-h-[160px]"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="Write your announcement in plain English… line breaks are preserved."
          />
        </Field>
        <Field label="Target Roles (none = all)">
          <MultiSelect
            options={((roles.data?.data ?? []) as unknown as { id: string; roleName: string }[]).map((r) => ({ value: r.id, label: r.roleName }))}
            value={form.targetRoles}
            onChange={(vals) => setForm((f) => ({ ...f, targetRoles: vals }))}
            placeholder="Search roles… (leave empty = all)"
            emptyText="No roles"
          />
        </Field>
        <Field label="Expires At">
          <Input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
        </Field>
      </Dialog>

      <ReasonForChangeDialog
        open={!!reasonRow}
        onClose={() => setReasonRow(null)}
        onConfirm={async (reasonForChange) => {
          if (!reasonRow) return;
          await updateMutation.mutateAsync({
            id: reasonRow.id,
            body: {
              title: form.title,
              content: form.content,
              targetRoles: form.targetRoles,
              expiresAt: form.expiresAt || undefined,
              reasonForChange,
            },
          });
        }}
      />

      <ReasonForChangeDialog
        open={!!deactivateRow}
        onClose={() => setDeactivateRow(null)}
        title="Deactivate Announcement"
        onConfirm={async (reason) => {
          if (!deactivateRow) return;
          await removeMutation.mutateAsync({ id: deactivateRow.id, reason });
        }}
      />
    </div>
  );
}
