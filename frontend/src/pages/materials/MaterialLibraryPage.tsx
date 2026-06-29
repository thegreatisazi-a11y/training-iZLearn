import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2, Eye, Upload } from 'lucide-react';
import { ALLOWED_MATERIAL_EXTENSIONS } from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Column } from '@/components/common/DataTable';
import { FileUpload } from '@/components/common/FileUpload';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { InlineFileViewer } from '@/components/common/InlineFileViewer';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { api, apiError } from '@/lib/axios';
import { svc } from '@/services';

interface Material {
  id: string;
  originalFileName: string;
  fileType: string;
  version: number;
  isCurrentVersion: boolean;
  isObsolete: boolean;
}

const FILE_TYPE_OPTIONS = ALLOWED_MATERIAL_EXTENSIONS.map((e) => ({ value: e, label: e.toUpperCase() }));

export default function MaterialLibraryPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('materialManagement', 'write');
  const canBulkUpload = hasPermission('materialManagement', 'create') || canWrite;
  // BUG-10: explicit downloads are limited to material managers (download permission).
  const canDownload = canWrite || hasPermission('courseManagement', 'write');
  const bulkInputRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [fileType, setFileType] = useState('');
  const [filterTopicId, setFilterTopicId] = useState('');
  const [uploadTopicId, setUploadTopicId] = useState('');
  const [deleting, setDeleting] = useState<Material | null>(null);
  const [viewing, setViewing] = useState<Material | null>(null);
  // Bulk operations: multi-select + bulk delete.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = (ids: string[], checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });

  const { data: topics } = useQuery({ queryKey: ['topics', 'all'], queryFn: () => svc.topics.list({ pageSize: 200 }) });
  const topicOptions = ((topics?.data ?? []) as { id: string; title: string }[]).map((t) => ({ value: t.id, label: t.title }));

  const { data, isLoading } = useQuery({
    queryKey: ['materials', { page, search, fileType, filterTopicId }],
    queryFn: () =>
      svc.materials.list({
        page,
        search: search || undefined,
        fileType: fileType || undefined,
        topicId: filterTopicId || undefined,
      }),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => svc.materials.upload(file, uploadTopicId),
    onSuccess: () => {
      toast.success('Material uploaded');
      qc.invalidateQueries({ queryKey: ['materials'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const bulkUploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      // Library-level upload (no topicId): files become reusable library materials.
      const r = await api.post('/materials/bulk', fd);
      return r.data.data as { uploaded: number; failed: number; errors: { fileName: string; error: string }[] };
    },
    onSuccess: (res) => {
      if (res.uploaded > 0) toast.success(`${res.uploaded} file(s) uploaded to the library`);
      if (res.failed > 0) toast.error(`${res.failed} file(s) failed: ${res.errors.map((e) => e.fileName).join(', ')}`);
      qc.invalidateQueries({ queryKey: ['materials'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const onBulkFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) bulkUploadMut.mutate(files);
    e.target.value = ''; // allow re-selecting the same files
  };

  const deleteMut = useMutation({
    mutationFn: (reason: string) => svc.materials.remove(deleting!.id, reason),
    onSuccess: () => {
      toast.success('Material deleted');
      qc.invalidateQueries({ queryKey: ['materials'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Bulk delete: remove every selected material with one shared reason for change.
  const bulkDeleteMut = useMutation({
    mutationFn: async (reason: string) => {
      const ids = [...selected];
      const results = await Promise.allSettled(ids.map((id) => svc.materials.remove(id, reason)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { total: ids.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      if (failed > 0) toast.error(`${total - failed} deleted, ${failed} failed (a material in use by a course can't be deleted).`);
      else toast.success(`${total} material(s) deleted`);
      qc.invalidateQueries({ queryKey: ['materials'] });
      setSelected(new Set());
      setBulkDeleteOpen(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const columns: Column<Material>[] = [
    { key: 'originalFileName', header: 'File', render: (r) => <span className="font-medium text-slate-800">{r.originalFileName}</span> },
    { key: 'fileType', header: 'Type', render: (r) => <span className="uppercase">{r.fileType}</span> },
    { key: 'version', header: 'Version', render: (r) => `v${r.version}` },
    { key: 'isCurrentVersion', header: 'Current', render: (r) => (r.isCurrentVersion ? <Badge tone="APPROVED">Current</Badge> : <Badge tone="WAIVED">No</Badge>) },
    { key: 'isObsolete', header: 'Obsolete', render: (r) => (r.isObsolete ? <Badge tone="REJECTED">Obsolete</Badge> : '—') },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setViewing(r)}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <Eye className="h-4 w-4" /> View
          </button>
          {canDownload && (
            <button
              type="button"
              onClick={() => svc.materials.download(r.id, r.originalFileName).catch((e) => toast.error(apiError(e)))}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Download className="h-4 w-4" /> Download
            </button>
          )}
          {canWrite && (
            <button className="text-red-600 hover:text-red-700" onClick={() => setDeleting(r)} aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Material Library"
        description="Controlled training documents"
        actions={
          canBulkUpload ? (
            <>
              <input
                ref={bulkInputRef}
                type="file"
                multiple
                className="hidden"
                accept={ALLOWED_MATERIAL_EXTENSIONS.map((e) => `.${e}`).join(',')}
                onChange={onBulkFilesSelected}
              />
              <Button onClick={() => bulkInputRef.current?.click()} disabled={bulkUploadMut.isPending}>
                <Upload className="mr-2 h-4 w-4" />
                {bulkUploadMut.isPending ? 'Uploading…' : 'Bulk Upload'}
              </Button>
            </>
          ) : undefined
        }
      />

      {canWrite && (
        <Card className="mb-5">
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px]">
                <Field label="Upload to topic">
                  <Select options={topicOptions} placeholder="Select a topic…" value={uploadTopicId} onChange={(e) => setUploadTopicId(e.target.value)} />
                </Field>
              </div>
              <div className="mb-3">
                {uploadTopicId ? (
                  <FileUpload
                    accept={ALLOWED_MATERIAL_EXTENSIONS.map((e) => `.${e}`).join(',')}
                    onSelect={(f) => uploadMut.mutate(f)}
                    label={uploadMut.isPending ? 'Uploading…' : 'Upload material'}
                  />
                ) : (
                  <p className="text-sm text-slate-400">Select a topic to enable upload.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search by file name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          className="max-w-[160px]"
          options={FILE_TYPE_OPTIONS}
          placeholder="All file types"
          value={fileType}
          onChange={(e) => {
            setFileType(e.target.value);
            setPage(1);
          }}
        />
        <Select
          className="max-w-xs"
          options={topicOptions}
          placeholder="All topics"
          value={filterTopicId}
          onChange={(e) => {
            setFilterTopicId(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {/* Bulk action bar — appears once one or more rows are selected. */}
      {canWrite && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium text-slate-700">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" variant="danger" onClick={() => setBulkDeleteOpen(true)} disabled={bulkDeleteMut.isPending}>
              <Trash2 className="h-4 w-4" /> Delete selected
            </Button>
          </div>
        </div>
      )}

      <DataTable<Material>
        columns={columns}
        rows={(data?.data ?? []) as unknown as Material[]}
        loading={isLoading}
        page={data?.page}
        pageSize={data?.pageSize}
        total={data?.total}
        onPageChange={setPage}
        emptyText="No materials found."
        selectable={canWrite}
        selectedIds={selected}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
      />

      <ReasonForChangeDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={async (r) => { await bulkDeleteMut.mutateAsync(r); }}
        title={`Delete ${selected.size} material(s)`}
      />

      <ReasonForChangeDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={async (r) => { await deleteMut.mutateAsync(r); }} title="Delete Material" />

      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        className="max-w-6xl"
        title={viewing?.originalFileName ?? 'View Material'}
        footer={
          <>
            {viewing && (
              <Button
                variant="outline"
                onClick={() => navigate(`/materials/${viewing.id}/view?name=${encodeURIComponent(viewing.originalFileName)}&type=${viewing.fileType}`)}
              >
                Open full page
              </Button>
            )}
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
          </>
        }
      >
        {viewing && <InlineFileViewer materialId={viewing.id} fileName={viewing.originalFileName} fileType={viewing.fileType} />}
      </Dialog>
    </div>
  );
}
