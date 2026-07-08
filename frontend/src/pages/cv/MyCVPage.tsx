import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Printer, History } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/spinner';
import { Dialog } from '@/components/ui/dialog';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { formatDateTime } from '@/lib/format';
import { printHtml, printTable } from '@/lib/print';

interface Qualification { year?: string; degree?: string; specialization?: string; institute?: string }
interface Experience { organisation?: string; role?: string; tenureFrom?: string; tenureTo?: string; responsibilities?: string }
interface Numbered { srNo?: string | number; detail?: string }
interface LanguageItem { language?: string; read?: boolean; write?: boolean; understand?: boolean }
/** R5: Yes/No options for the CV language proficiency fields (default No when unset). */
const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
interface CvHeader { employeeName: string; employeeCode: string; departmentName?: string | null; functionalRole?: string | null; functionalRoles?: string[] }
interface CvData {
  version?: number;
  languagesKnown?: string | null;
  languages?: LanguageItem[];
  qualifications?: Qualification[];
  currentRole?: string | null;
  currentTenureFrom?: string | null;
  currentTenureTo?: string | null;
  currentResponsibilities?: string | null;
  experience?: Experience[];
  trainings?: Numbered[];
  publications?: Numbered[];
  experienceNotApplicable?: boolean;
  trainingsNotApplicable?: boolean;
  publicationsNotApplicable?: boolean;
}

interface FormState {
  languagesKnown: string;
  languages: LanguageItem[];
  qualifications: Qualification[];
  currentRole: string;
  currentTenureFrom: string;
  currentTenureTo: string;
  currentResponsibilities: string;
  experience: Experience[];
  trainings: Numbered[];
  publications: Numbered[];
  experienceNotApplicable: boolean;
  trainingsNotApplicable: boolean;
  publicationsNotApplicable: boolean;
}

function emptyForm(): FormState {
  return {
    languagesKnown: '',
    languages: [{}],
    qualifications: [{}],
    currentRole: '',
    currentTenureFrom: '',
    currentTenureTo: '',
    currentResponsibilities: '',
    experience: [{}],
    trainings: [{}],
    publications: [{}],
    experienceNotApplicable: false,
    trainingsNotApplicable: false,
    publicationsNotApplicable: false,
  };
}

/** Map a saved CV (or null) into the editable form shape; falls back to legacy free-text languages. */
function seedForm(cv: CvData | null | undefined): FormState {
  if (!cv) return emptyForm();
  const seededLanguages: LanguageItem[] = cv.languages?.length
    ? cv.languages
    : cv.languagesKnown
      ? cv.languagesKnown.split(',').map((s) => s.trim()).filter(Boolean).map((language) => ({ language }))
      : [];
  return {
    languagesKnown: cv.languagesKnown ?? '',
    languages: seededLanguages.length ? seededLanguages : [{}],
    qualifications: cv.qualifications?.length ? cv.qualifications : [{}],
    currentRole: cv.currentRole ?? '',
    currentTenureFrom: cv.currentTenureFrom ?? '',
    currentTenureTo: cv.currentTenureTo ?? '',
    currentResponsibilities: cv.currentResponsibilities ?? '',
    experience: cv.experience?.length ? cv.experience : [{}],
    trainings: cv.trainings?.length ? cv.trainings : [{}],
    publications: cv.publications?.length ? cv.publications : [{}],
    experienceNotApplicable: !!cv.experienceNotApplicable,
    trainingsNotApplicable: !!cv.trainingsNotApplicable,
    publicationsNotApplicable: !!cv.publicationsNotApplicable,
  };
}

/** Build the printable CV body from a CV snapshot — shared by the live print and the
 *  version-history "View / Print" so every version renders identically. */
function cvPrintBody(header: CvHeader, cv: CvData): string {
  const langs = (cv.languages ?? []).filter((l) => l.language);
  const languagesBlock = langs.length
    ? printTable(['Language', 'Read', 'Write', 'Understand'], langs.map((l) => [l.language, l.read ? 'Yes' : 'No', l.write ? 'Yes' : 'No', l.understand ? 'Yes' : 'No']))
    : `<p>${cv.languagesKnown || '—'}</p>`;
  return (
    `<h1>Curriculum Vitae</h1>` +
    `<div class="meta">${header.employeeName} (${header.employeeCode}) · ${header.functionalRole ?? ''} · ${header.departmentName ?? ''} · v${cv.version ?? 1}</div>` +
    `<div class="section">Languages Known</div>${languagesBlock}` +
    `<div class="section">Educational Qualifications</div>` +
    printTable(['Year', 'Degree', 'Specialization', 'Institute'], (cv.qualifications ?? []).map((q) => [q.year, q.degree, q.specialization, q.institute])) +
    `<div class="section">Current Role</div><p>${cv.currentRole || '—'} (${cv.currentTenureFrom || '?'} → ${cv.currentTenureTo || 'present'})</p><p>${cv.currentResponsibilities || ''}</p>` +
    `<div class="section">Previous Positions</div>` +
    (cv.experienceNotApplicable
      ? `<p>Not Applicable</p>`
      : printTable(['Organisation', 'Role', 'From', 'To', 'Responsibilities'], (cv.experience ?? []).map((e) => [e.organisation, e.role, e.tenureFrom, e.tenureTo, e.responsibilities]))) +
    `<div class="section">Trainings / Seminars / Workshops</div>` +
    (cv.trainingsNotApplicable ? `<p>Not Applicable</p>` : printTable(['#', 'Detail'], (cv.trainings ?? []).map((t, i) => [t.srNo ?? i + 1, t.detail]))) +
    `<div class="section">Publications / Memberships</div>` +
    (cv.publicationsNotApplicable ? `<p>Not Applicable</p>` : printTable(['#', 'Detail'], (cv.publications ?? []).map((p, i) => [p.srNo ?? i + 1, p.detail])))
  );
}

/** Item A: CV version history — every saved version (reconstructed from the audit trail);
 *  open/print any older version in the same format as the current one. */
function CvHistoryDialog({ open, onClose, header }: { open: boolean; onClose: () => void; header?: CvHeader }) {
  const { data, isLoading } = useQuery({
    queryKey: ['my-cv-history'],
    queryFn: () => svc.cv.mineHistory() as unknown as Promise<{ header: CvHeader; versions: { version: number | null; updatedAt: string; cv: CvData }[] }>,
    enabled: open,
  });
  const versions = data?.versions ?? [];
  const hdr = header ?? data?.header;
  return (
    <Dialog open={open} onClose={onClose} title="Curriculum Vitae — Version History" footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      {isLoading ? (
        <PageLoader />
      ) : versions.length === 0 ? (
        <p className="text-sm text-slate-500">No versions found.</p>
      ) : (
        <div className="space-y-2">
          {versions.map((v, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2">
              <div className="text-sm">
                <span className="font-medium text-slate-800">v{v.version ?? '—'}</span>
                <span className="ml-2 text-xs text-slate-400">{formatDateTime(v.updatedAt)}</span>
              </div>
              <Button size="sm" variant="outline" disabled={!hdr} onClick={() => hdr && printHtml('Curriculum Vitae', cvPrintBody(hdr, v.cv))}>
                <Printer className="h-4 w-4" /> View / Print
              </Button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

export default function MyCVPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editing, setEditing] = useState(false); // C1: read-only until Edit is clicked
  const [histOpen, setHistOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['my-cv'],
    queryFn: () => svc.cv.mine() as unknown as Promise<{ header: CvHeader; cv: CvData | null }>,
  });

  useEffect(() => {
    if (data?.cv) setForm(seedForm(data.cv));
  }, [data?.cv]);

  // S3: every section is mandatory. The three optional-content sections are satisfied
  // either by having ≥1 entry OR by being marked Not Applicable.
  const filledLanguages = form.languages.filter((l) => l.language);
  const filledQuals = form.qualifications.filter((q) => q.year || q.degree || q.specialization || q.institute);
  const filledExperience = form.experience.filter((e) => e.organisation || e.role || e.responsibilities);
  const filledTrainings = form.trainings.filter((t) => t.detail);
  const filledPublications = form.publications.filter((p) => p.detail);
  const missing: string[] = [];
  if (filledLanguages.length === 0) missing.push('Language(s) Known');
  if (filledQuals.length === 0) missing.push('Educational Qualifications');
  if (!form.currentRole.trim()) missing.push('Current Role');
  if (filledExperience.length === 0 && !form.experienceNotApplicable) missing.push('Previous Positions');
  if (filledTrainings.length === 0 && !form.trainingsNotApplicable) missing.push('Trainings / Seminars / Workshops');
  if (filledPublications.length === 0 && !form.publicationsNotApplicable) missing.push('Publications / Memberships');
  const cvValid = missing.length === 0;

  const save = useMutation({
    mutationFn: () =>
      svc.cv.save({
        languagesKnown: form.languagesKnown || undefined,
        languages: filledLanguages,
        qualifications: filledQuals,
        currentRole: form.currentRole || undefined,
        currentTenureFrom: form.currentTenureFrom || undefined,
        currentTenureTo: form.currentTenureTo || undefined,
        currentResponsibilities: form.currentResponsibilities || undefined,
        experience: form.experienceNotApplicable ? [] : filledExperience,
        trainings: form.trainingsNotApplicable ? [] : filledTrainings,
        publications: form.publicationsNotApplicable ? [] : filledPublications,
        experienceNotApplicable: form.experienceNotApplicable,
        trainingsNotApplicable: form.trainingsNotApplicable,
        publicationsNotApplicable: form.publicationsNotApplicable,
      }),
    onSuccess: () => {
      toast.success('CV saved.');
      setEditing(false);
      // Refetch so the bumped version number (and other server-set fields) show immediately.
      qc.invalidateQueries({ queryKey: ['my-cv'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading) return <PageLoader />;
  const header = data?.header;

  function handlePrint() {
    if (!header) return;
    // Print the CURRENT (possibly just-edited) form using the shared body builder.
    printHtml('Curriculum Vitae', cvPrintBody(header, { ...form, version: data?.cv?.version }));
  }

  const upd = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader
        title="My CV"
        description="Your curriculum vitae. The header is pulled from your employee record."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setHistOpen(true)}>
              <History className="h-4 w-4" /> Version History
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            {editing ? (
              <>
                <Button variant="outline" onClick={() => { setForm(seedForm(data?.cv)); setEditing(false); }} disabled={save.isPending}>
                  Cancel
                </Button>
                <Button
                  disabled={save.isPending || !cvValid}
                  title={cvValid ? undefined : `Complete all sections first: ${missing.join(', ')}`}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? 'Saving…' : 'Save CV'}
                </Button>
              </>
            ) : (
              <Button onClick={() => setEditing(true)}>Edit</Button>
            )}
          </div>
        }
      />
      <CvHistoryDialog open={histOpen} onClose={() => setHistOpen(false)} header={header} />

      {/* S3: all sections are mandatory — show what's still missing while editing. */}
      {editing && !cvValid && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          All sections are required. Please complete (or mark “Not Applicable” where offered): <strong>{missing.join(', ')}</strong>.
        </div>
      )}

      <Card className="mb-4">
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            <div><div className="text-xs text-slate-500">Employee Name</div><div className="font-medium">{header?.employeeName}</div></div>
            <div><div className="text-xs text-slate-500">Employee Code</div><div className="font-medium">{header?.employeeCode}</div></div>
            <div><div className="text-xs text-slate-500">Functional Role</div><div className="font-medium">{header?.functionalRole ?? '—'}</div></div>
            <div><div className="text-xs text-slate-500">Department</div><div className="font-medium">{header?.departmentName ?? '—'}</div></div>
            <div><div className="text-xs text-slate-500">CV Version</div><div className="font-medium">v{data?.cv?.version ?? 1}</div></div>
          </div>
        </CardContent>
      </Card>

      {/* C1: everything below is read-only until Edit is clicked. */}
      <fieldset disabled={!editing} className="min-w-0 border-0 p-0 disabled:opacity-70">

      {/* #4: structured Language(s) Known — name + Read / Write / Understand */}
      <RepeatableSection
        title="Language(s) Known"
        rows={form.languages}
        onChange={(rows) => upd('languages', rows)}
        blank={{}}
        render={(row, set) => (
          <div className="flex flex-wrap items-center gap-3">
            <Input className="flex-1 min-w-[180px]" placeholder="Language (e.g. English)" value={row.language ?? ''} onChange={(e) => set({ ...row, language: e.target.value })} />
            {/* R5: explicit Yes/No (blank/unset defaults to No) instead of a tick/cross/hyphen. */}
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              Read
              <Select className="w-20" options={YES_NO} value={row.read ? 'yes' : 'no'} onChange={(e) => set({ ...row, read: e.target.value === 'yes' })} />
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              Write
              <Select className="w-20" options={YES_NO} value={row.write ? 'yes' : 'no'} onChange={(e) => set({ ...row, write: e.target.value === 'yes' })} />
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              Understand
              <Select className="w-20" options={YES_NO} value={row.understand ? 'yes' : 'no'} onChange={(e) => set({ ...row, understand: e.target.value === 'yes' })} />
            </label>
          </div>
        )}
      />

      {/* Qualifications */}
      <RepeatableSection
        title="Educational Qualifications"
        required
        rows={form.qualifications}
        onChange={(rows) => upd('qualifications', rows)}
        blank={{}}
        render={(row, set) => (
          <div className="grid grid-cols-4 gap-2">
            <Input placeholder="Year" value={row.year ?? ''} onChange={(e) => set({ ...row, year: e.target.value })} />
            <Input placeholder="Degree / Certification" value={row.degree ?? ''} onChange={(e) => set({ ...row, degree: e.target.value })} />
            <Input placeholder="Specialization" value={row.specialization ?? ''} onChange={(e) => set({ ...row, specialization: e.target.value })} />
            <Input placeholder="Institute / University" value={row.institute ?? ''} onChange={(e) => set({ ...row, institute: e.target.value })} />
          </div>
        )}
      />

      {/* Current role */}
      <Card className="mb-4">
        <CardContent>
          <div className="mb-2 text-sm font-semibold uppercase text-slate-500">Current Role</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Current Role / Designation"><Input value={form.currentRole} onChange={(e) => upd('currentRole', e.target.value)} /></Field>
            <Field label="From (MM-YYYY)"><Input value={form.currentTenureFrom} onChange={(e) => upd('currentTenureFrom', e.target.value)} placeholder="01-2024" /></Field>
            <Field label="To (MM-YYYY)"><Input value={form.currentTenureTo} onChange={(e) => upd('currentTenureTo', e.target.value)} placeholder="present" /></Field>
          </div>
          <Field label="Key Responsibilities"><Textarea value={form.currentResponsibilities} onChange={(e) => upd('currentResponsibilities', e.target.value)} /></Field>
        </CardContent>
      </Card>

      {/* Previous positions */}
      <RepeatableSection
        title="Previous Positions"
        required
        notApplicable={form.experienceNotApplicable}
        onNotApplicable={(v) => upd('experienceNotApplicable', v)}
        rows={form.experience}
        onChange={(rows) => upd('experience', rows)}
        blank={{}}
        render={(row, set) => (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Input placeholder="Organisation" value={row.organisation ?? ''} onChange={(e) => set({ ...row, organisation: e.target.value })} />
            <Input placeholder="Role / Designation" value={row.role ?? ''} onChange={(e) => set({ ...row, role: e.target.value })} />
            <Input placeholder="From (MM-YYYY)" value={row.tenureFrom ?? ''} onChange={(e) => set({ ...row, tenureFrom: e.target.value })} />
            <Input placeholder="To (MM-YYYY)" value={row.tenureTo ?? ''} onChange={(e) => set({ ...row, tenureTo: e.target.value })} />
            <Textarea className="md:col-span-2" placeholder="Key Responsibilities" value={row.responsibilities ?? ''} onChange={(e) => set({ ...row, responsibilities: e.target.value })} />
          </div>
        )}
      />

      {/* Trainings */}
      <RepeatableSection
        title="Trainings / Seminars / Workshops"
        required
        notApplicable={form.trainingsNotApplicable}
        onNotApplicable={(v) => upd('trainingsNotApplicable', v)}
        rows={form.trainings}
        onChange={(rows) => upd('trainings', rows)}
        blank={{}}
        render={(row, set) => (
          <Input placeholder="Detail (month-year, topic, location…)" value={row.detail ?? ''} onChange={(e) => set({ ...row, detail: e.target.value })} />
        )}
      />

      {/* Publications */}
      <RepeatableSection
        title="Publications / Memberships"
        required
        notApplicable={form.publicationsNotApplicable}
        onNotApplicable={(v) => upd('publicationsNotApplicable', v)}
        rows={form.publications}
        onChange={(rows) => upd('publications', rows)}
        blank={{}}
        render={(row, set) => (
          <Input placeholder="Detail" value={row.detail ?? ''} onChange={(e) => set({ ...row, detail: e.target.value })} />
        )}
      />
      </fieldset>
    </div>
  );
}

function RepeatableSection<T>({
  title,
  rows,
  onChange,
  blank,
  render,
  required,
  notApplicable,
  onNotApplicable,
}: {
  title: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: T;
  render: (row: T, set: (next: T) => void) => React.ReactNode;
  /** S3: mark the section header with a required asterisk. */
  required?: boolean;
  /** S3: when provided, a "Not Applicable" checkbox is shown; checking it hides the rows. */
  notApplicable?: boolean;
  onNotApplicable?: (v: boolean) => void;
}) {
  return (
    <Card className="mb-4">
      <CardContent>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold uppercase text-slate-500">
            {title}
            {required && <span className="text-red-500"> *</span>}
          </div>
          <div className="flex items-center gap-3">
            {onNotApplicable && (
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={!!notApplicable} onChange={(e) => onNotApplicable(e.target.checked)} /> Not Applicable
              </label>
            )}
            {!notApplicable && (
              <Button size="sm" variant="outline" onClick={() => onChange([...rows, { ...blank }])}>
                <Plus className="h-4 w-4" /> Add row
              </Button>
            )}
          </div>
        </div>
        {notApplicable ? (
          <p className="text-sm text-slate-400">Marked <strong>Not Applicable</strong>.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">{render(row, (next) => onChange(rows.map((r, j) => (j === i ? next : r))))}</div>
                {rows.length > 1 && (
                  <button type="button" className="mt-2 text-red-600" aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
