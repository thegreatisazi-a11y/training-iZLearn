import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Star, FileText, Trash2 } from 'lucide-react';
import {
  certificateType as certTypeEnum,
  renderCertificateTemplateHtml,
  SAMPLE_CERT_DATA,
  CERT_PLACEHOLDERS,
  FONT_FAMILIES,
  type CertificateTemplateInput,
} from '@izlearn/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Field, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { svc } from '@/services';

interface TemplateRow {
  id: string;
  templateName: string;
  certificateType: string;
  isActive: boolean;
  isDefault?: boolean;
  orientation: string;
  pageSize: string;
}

const CERT_TYPES = certTypeEnum.options.map((v) => ({ value: v, label: v }));
const FONT_OPTIONS = FONT_FAMILIES.map((f) => ({ value: f, label: f }));
const ORIENTATION_OPTIONS = [
  { value: 'LANDSCAPE', label: 'Landscape' },
  { value: 'PORTRAIT', label: 'Portrait' },
];
const PAGE_SIZE_OPTIONS = [
  { value: 'A4', label: 'A4' },
  { value: 'LETTER', label: 'Letter' },
];

const EMPTY_FORM: CertificateTemplateInput = {
  templateName: '',
  certificateType: 'TRAINING',
  isActive: true,
  orientation: 'LANDSCAPE',
  pageSize: 'A4',
  primaryColor: '#0f766e',
  secondaryColor: '#334155',
  fontFamily: 'Georgia',
  headerText: 'Certificate of Training Completion',
  subHeaderText: 'This is to certify that',
  bodyText: '',
  footerText: 'Certificate No: {{certificateNumber}}',
  signatory1Name: '',
  signatory1Title: '',
  signatory2Name: '',
  signatory2Title: '',
  showBorder: true,
  borderColor: '#0f766e',
  borderWidth: 6,
  watermarkText: '',
  showWatermark: true,
};

function LivePreview({ form }: { form: Partial<CertificateTemplateInput> }) {
  const html = renderCertificateTemplateHtml(form, SAMPLE_CERT_DATA);
  return (
    <iframe
      srcDoc={html}
      className="w-full rounded border border-slate-200"
      style={{ height: form.orientation === 'PORTRAIT' ? '560px' : '420px' }}
      title="Certificate preview"
    />
  );
}

function PlaceholderBar({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded bg-slate-50 p-2 text-xs">
      {CERT_PLACEHOLDERS.map((p) => (
        <button
          key={p.token}
          type="button"
          onClick={() => onInsert(p.token)}
          className="rounded bg-white px-2 py-1 border border-slate-200 hover:bg-teal-50 hover:border-teal-400 text-slate-600"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function TemplateForm({
  form,
  onChange,
}: {
  form: CertificateTemplateInput;
  onChange: (f: CertificateTemplateInput) => void;
}) {
  function set<K extends keyof CertificateTemplateInput>(key: K, val: CertificateTemplateInput[K]) {
    onChange({ ...form, [key]: val });
  }

  function insertInto(field: keyof CertificateTemplateInput, token: string) {
    const cur = (form[field] as string) ?? '';
    set(field, (cur + token) as CertificateTemplateInput[typeof field]);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Template Name" required>
          <Input value={form.templateName} onChange={(e) => set('templateName', e.target.value)} />
        </Field>
        <Field label="Certificate Type">
          <Select
            options={CERT_TYPES}
            value={form.certificateType}
            onChange={(e) => set('certificateType', e.target.value as CertificateTemplateInput['certificateType'])}
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Field label="Orientation">
          <Select
            options={ORIENTATION_OPTIONS}
            value={form.orientation}
            onChange={(e) => set('orientation', e.target.value as CertificateTemplateInput['orientation'])}
          />
        </Field>
        <Field label="Page Size">
          <Select
            options={PAGE_SIZE_OPTIONS}
            value={form.pageSize}
            onChange={(e) => set('pageSize', e.target.value as CertificateTemplateInput['pageSize'])}
          />
        </Field>
        <Field label="Font Family">
          <Select
            options={FONT_OPTIONS}
            value={form.fontFamily}
            onChange={(e) => set('fontFamily', e.target.value as CertificateTemplateInput['fontFamily'])}
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Field label="Primary Color">
          <div className="flex gap-2 items-center">
            <input type="color" value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} className="h-9 w-12 rounded border border-slate-200 p-1" />
            <Input value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} className="font-mono" />
          </div>
        </Field>
        <Field label="Secondary Color">
          <div className="flex gap-2 items-center">
            <input type="color" value={form.secondaryColor} onChange={(e) => set('secondaryColor', e.target.value)} className="h-9 w-12 rounded border border-slate-200 p-1" />
            <Input value={form.secondaryColor} onChange={(e) => set('secondaryColor', e.target.value)} className="font-mono" />
          </div>
        </Field>
        <Field label="Border Color">
          <div className="flex gap-2 items-center">
            <input type="color" value={form.borderColor} onChange={(e) => set('borderColor', e.target.value)} className="h-9 w-12 rounded border border-slate-200 p-1" />
            <Input value={form.borderColor} onChange={(e) => set('borderColor', e.target.value)} className="font-mono" />
          </div>
        </Field>
      </div>

      <Field label="Header Text">
        <PlaceholderBar onInsert={(t) => insertInto('headerText', t)} />
        <Input className="mt-1" value={form.headerText} onChange={(e) => set('headerText', e.target.value)} />
      </Field>

      <Field label="Sub-header Text">
        <PlaceholderBar onInsert={(t) => insertInto('subHeaderText', t)} />
        <Input className="mt-1" value={form.subHeaderText} onChange={(e) => set('subHeaderText', e.target.value)} />
      </Field>

      <Field label="Body Text">
        <PlaceholderBar onInsert={(t) => insertInto('bodyText', t)} />
        <Textarea className="mt-1" rows={3} value={form.bodyText} onChange={(e) => set('bodyText', e.target.value)} />
      </Field>

      <Field label="Footer Text">
        <PlaceholderBar onInsert={(t) => insertInto('footerText', t)} />
        <Input className="mt-1" value={form.footerText} onChange={(e) => set('footerText', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Signatory 1 Name">
          <Input value={form.signatory1Name ?? ''} onChange={(e) => set('signatory1Name', e.target.value)} />
        </Field>
        <Field label="Signatory 1 Title">
          <Input value={form.signatory1Title ?? ''} onChange={(e) => set('signatory1Title', e.target.value)} />
        </Field>
        <Field label="Signatory 2 Name">
          <Input value={form.signatory2Name ?? ''} onChange={(e) => set('signatory2Name', e.target.value)} />
        </Field>
        <Field label="Signatory 2 Title">
          <Input value={form.signatory2Title ?? ''} onChange={(e) => set('signatory2Title', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Watermark Text (optional)">
          <Input placeholder="Leave blank to use org name" value={form.watermarkText ?? ''} onChange={(e) => set('watermarkText', e.target.value)} />
        </Field>
        <Field label="Border Width (px)">
          <Input type="number" min={0} max={40} value={form.borderWidth ?? 6} onChange={(e) => set('borderWidth', Number(e.target.value))} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.showBorder} onChange={(e) => set('showBorder', e.target.checked)} />
          Show Border
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.showWatermark} onChange={(e) => set('showWatermark', e.target.checked)} />
          Show Watermark
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          Active
        </label>
      </div>

      <Field label="Live Preview">
        <LivePreview form={form} />
      </Field>
    </div>
  );
}

export default function CertificateTemplatesPage() {
  const qc = useQueryClient();
  // Certificate Templates is its own permission module now (split from Certificates).
  const canWrite = useAuthStore((s) => s.hasPermission)('certificateTemplates', 'edit');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CertificateTemplateInput>({ ...EMPTY_FORM });

  const [editTemplate, setEditTemplate] = useState<TemplateRow | null>(null);
  const [editForm, setEditForm] = useState<CertificateTemplateInput>({ ...EMPTY_FORM });

  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['certificateTemplates'],
    queryFn: () => svc.certificateTemplates.list({ includeInactive: true }),
  });

  const createMutation = useMutation({
    mutationFn: (body: CertificateTemplateInput) => svc.certificateTemplates.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['certificateTemplates'] });
      toast.success('Template created.');
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_FORM });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CertificateTemplateInput }) =>
      svc.certificateTemplates.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['certificateTemplates'] });
      toast.success('Template updated.');
      setEditTemplate(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => svc.certificateTemplates.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['certificateTemplates'] });
      toast.success('Template deleted.');
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => svc.certificateTemplates.duplicate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['certificateTemplates'] });
      toast.success('Template duplicated.');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => svc.certificateTemplates.setDefault(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['certificateTemplates'] });
      toast.success('Default template updated.');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  async function openEdit(row: TemplateRow) {
    try {
      const full = await svc.certificateTemplates.get(row.id);
      setEditForm({ ...EMPTY_FORM, ...(full as CertificateTemplateInput) });
      setEditTemplate(row);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  const rows = (data ?? []) as unknown as TemplateRow[];

  const columns: Column<TemplateRow>[] = [
    {
      key: 'templateName',
      header: 'Name',
      render: (r) => (
        <span className="font-medium text-slate-800">
          {r.templateName}
          {r.isDefault && <Star className="inline ml-1 h-3 w-3 text-amber-500 fill-amber-500" />}
        </span>
      ),
    },
    { key: 'certificateType', header: 'Type' },
    { key: 'orientation', header: 'Orientation' },
    { key: 'pageSize', header: 'Size' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge tone={r.isActive ? 'APPROVED' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        canWrite ? (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
              Edit
            </Button>
            <Button size="sm" variant="outline" title="Preview PDF" onClick={() => svc.certificateTemplates.previewPdf(r.id)}>
              <FileText className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" title="Duplicate" onClick={() => duplicateMutation.mutate(r.id)}>
              <Copy className="h-4 w-4" />
            </Button>
            {!r.isDefault && (
              <Button size="sm" variant="outline" title="Set as default" onClick={() => setDefaultMutation.mutate(r.id)}>
                <Star className="h-4 w-4" />
              </Button>
            )}
            <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" title="Delete" onClick={() => setDeleteTarget(r)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => svc.certificateTemplates.previewPdf(r.id)}>
            <FileText className="h-4 w-4" /> Preview
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Certificate Templates"
        description="Design and manage certificate templates used for issuing training certificates."
        actions={
          canWrite && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New Template
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyText="No certificate templates found. Create one to get started."
      />

      {/* Create */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Certificate Template"
        className="max-w-4xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              disabled={createMutation.isPending || !createForm.templateName}
              onClick={() => createMutation.mutate(createForm)}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Template'}
            </Button>
          </>
        }
      >
        <TemplateForm form={createForm} onChange={setCreateForm} />
      </Dialog>

      {/* Edit */}
      <Dialog
        open={!!editTemplate}
        onClose={() => setEditTemplate(null)}
        title={`Edit Template — ${editTemplate?.templateName ?? ''}`}
        className="max-w-4xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditTemplate(null)} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              disabled={updateMutation.isPending || !editForm.templateName}
              onClick={() => editTemplate && updateMutation.mutate({ id: editTemplate.id, body: editForm })}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <TemplateForm form={editForm} onChange={setEditForm} />
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`Delete Template — ${deleteTarget?.templateName ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Are you sure you want to delete <strong>{deleteTarget?.templateName}</strong>? This cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
