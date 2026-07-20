import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileUp, Sheet } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/spinner';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { RichTextEditor, importWordToHtml, importExcelToHtml } from '@/components/common/RichTextEditor';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';

interface JDTemplate {
  id: string;
  title: string;
  content?: string;
  functionalRoleId?: string | null;
  departmentId?: string | null;
}

/**
 * I6: full-page JD template designer (the app menu stays visible). A "Word-like"
 * rich-text editor plus Word (.docx) and Excel (.xlsx) import. Creating is e-sign-free;
 * editing an existing template is a controlled change (reason + electronic signature).
 */
export default function JDTemplateEditorPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState({ functionalRoleId: '', departmentId: '', title: '', content: '' });
  const [reason, setReason] = useState('');
  const [signOpen, setSignOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const { data: functionalRoles } = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }) });
  const { data: departments } = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }) });
  const functionalRoleOptions = ((functionalRoles?.data ?? []) as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }));
  const departmentOptions = ((departments?.data ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }));

  // Edit mode: load the template BY ID (L-J9 — not from a 200-row list cache that would
  // silently show a blank form beyond 200 templates).
  const { data: tpl, isLoading } = useQuery({
    queryKey: ['jd-template', id],
    queryFn: () => svc.jds.getTemplate(id as string) as unknown as Promise<JDTemplate>,
    enabled: isEdit && !!id,
  });
  useEffect(() => {
    if (!isEdit || !tpl) return;
    setForm({
      functionalRoleId: tpl.functionalRoleId ?? '',
      departmentId: tpl.departmentId ?? '',
      title: tpl.title,
      content: tpl.content ?? '',
    });
  }, [isEdit, tpl]);

  const createMut = useMutation({
    mutationFn: () =>
      svc.jds.createTemplate({
        functionalRoleId: form.functionalRoleId,
        departmentId: form.departmentId || undefined,
        title: form.title,
        content: form.content,
      }),
    onSuccess: () => {
      toast.success('Template created');
      qc.invalidateQueries({ queryKey: ['jd-templates'] });
      navigate('/job-descriptions');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateMut = useMutation({
    mutationFn: (sig: ESignaturePayload) =>
      svc.jds.updateTemplate(id as string, {
        functionalRoleId: form.functionalRoleId,
        departmentId: form.departmentId || undefined,
        title: form.title,
        content: form.content,
        reasonForChange: reason.trim(),
        signature: sig,
      }) as unknown as Promise<{ propagatedCount?: number }>,
    onSuccess: (res) => {
      const n = res?.propagatedCount ?? 0;
      toast.success(
        n > 0
          ? `Template updated — a new version was sent to ${n} employee${n === 1 ? '' : 's'} to acknowledge.`
          : 'Template updated.',
      );
      qc.invalidateQueries({ queryKey: ['jd-templates'] });
      // L-J8: the fan-out publishes new JD versions, so refresh the admin JD list too.
      qc.invalidateQueries({ queryKey: ['jds'] });
      navigate('/job-descriptions');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  async function handleImport(kind: 'word' | 'excel', file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      const html = kind === 'word' ? await importWordToHtml(file) : await importExcelToHtml(file);
      // Append imported content so multiple files can be combined; editable afterwards.
      setForm((f) => ({ ...f, content: (f.content || '') + html }));
      toast.success(`${kind === 'word' ? 'Word' : 'Excel'} content imported — edit as needed.`);
    } catch (e) {
      toast.error(`Could not import the file: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  }

  const valid = !!form.functionalRoleId && !!form.title.trim() && !!form.content.trim();

  if (isEdit && isLoading) return <PageLoader />;

  return (
    <div>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => navigate('/job-descriptions')}>
        <ArrowLeft className="h-4 w-4" /> Back to Job Descriptions
      </button>

      <PageHeader
        title={isEdit ? 'Edit JD Template' : 'New JD Template'}
        description="Design the Job Description layout. Import from Word/Excel or build it with the editor."
        actions={
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <FileUp className="h-4 w-4" /> Import Word
              <input type="file" accept=".docx" className="hidden" disabled={importing} onChange={(e) => handleImport('word', e.target.files?.[0])} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <Sheet className="h-4 w-4" /> Import Excel
              <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importing} onChange={(e) => handleImport('excel', e.target.files?.[0])} />
            </label>
            <Button variant="outline" onClick={() => navigate('/job-descriptions')}>Cancel</Button>
            {isEdit ? (
              <Button disabled={!valid || reason.trim().length < 5} onClick={() => setSignOpen(true)}>Save &amp; Sign…</Button>
            ) : (
              <Button disabled={!valid || createMut.isPending} onClick={() => createMut.mutate()}>{createMut.isPending ? 'Saving…' : 'Create Template'}</Button>
            )}
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Functional Role" required>
              <Select options={functionalRoleOptions} placeholder="Select…" value={form.functionalRoleId} onChange={(e) => setForm({ ...form, functionalRoleId: e.target.value })} />
            </Field>
            <Field label="Department (optional)">
              <Select options={[{ value: '', label: 'Any department' }, ...departmentOptions]} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} />
            </Field>
          </div>
          <Field label="Title" required>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Content" required>
            <RichTextEditor value={form.content} onChange={(content) => setForm((f) => ({ ...f, content }))} />
          </Field>
          {isEdit && (
            <>
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Saving will publish a new version of this master JD to every employee currently assigned a Job Description from it.
                Each of them will need to acknowledge the updated version again; their previous version is kept in Version History.
              </div>
              <Field label="Reason for change" required>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="At least 5 characters" />
              </Field>
            </>
          )}
        </CardContent>
      </Card>

      <ESignatureModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title="Sign — Edit JD Template"
        defaultMeaning="Approved"
        onConfirm={async (sig) => {
          await updateMut.mutateAsync(sig);
          setSignOpen(false);
        }}
      />
    </div>
  );
}
