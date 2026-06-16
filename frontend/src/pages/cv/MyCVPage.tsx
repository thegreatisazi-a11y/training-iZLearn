import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, Trash2, Printer } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Field } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/spinner';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { printHtml, printTable } from '@/lib/print';

interface Qualification { year?: string; degree?: string; specialization?: string; institute?: string }
interface Experience { organisation?: string; role?: string; tenureFrom?: string; tenureTo?: string; responsibilities?: string }
interface Numbered { srNo?: string | number; detail?: string }
interface LanguageItem { language?: string; read?: boolean; write?: boolean; understand?: boolean }
interface CvHeader { employeeName: string; employeeCode: string; departmentName?: string | null; functionalRole?: string | null; functionalRoles?: string[] }
interface CvData {
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
  };
}

export default function MyCVPage() {
  const [form, setForm] = useState<FormState>(emptyForm());
  const { data, isLoading } = useQuery({
    queryKey: ['my-cv'],
    queryFn: () => svc.cv.mine() as unknown as Promise<{ header: CvHeader; cv: CvData | null }>,
  });

  useEffect(() => {
    const cv = data?.cv;
    if (!cv) return;
    // #4: prefer the structured array; if empty but a legacy free-text string
    // exists, seed one row per comma-separated language for editing back-compat.
    const seededLanguages: LanguageItem[] = cv.languages?.length
      ? cv.languages
      : cv.languagesKnown
        ? cv.languagesKnown.split(',').map((s) => s.trim()).filter(Boolean).map((language) => ({ language }))
        : [];
    setForm({
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
    });
  }, [data?.cv]);

  const save = useMutation({
    mutationFn: () =>
      svc.cv.save({
        languagesKnown: form.languagesKnown || undefined,
        languages: form.languages.filter((l) => l.language),
        qualifications: form.qualifications.filter((q) => q.year || q.degree || q.specialization || q.institute),
        currentRole: form.currentRole || undefined,
        currentTenureFrom: form.currentTenureFrom || undefined,
        currentTenureTo: form.currentTenureTo || undefined,
        currentResponsibilities: form.currentResponsibilities || undefined,
        experience: form.experience.filter((e) => e.organisation || e.role || e.responsibilities),
        trainings: form.trainings.filter((t) => t.detail),
        publications: form.publications.filter((p) => p.detail),
      }),
    onSuccess: () => toast.success('CV saved.'),
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading) return <PageLoader />;
  const header = data?.header;

  function handlePrint() {
    if (!header) return;
    // #4: prefer the structured array; fall back to the legacy free-text string.
    const langs = form.languages.filter((l) => l.language);
    const languagesBlock = langs.length
      ? printTable(['Language', 'Read', 'Write', 'Understand'], langs.map((l) => [l.language, l.read ? 'Yes' : '—', l.write ? 'Yes' : '—', l.understand ? 'Yes' : '—']))
      : `<p>${form.languagesKnown || '—'}</p>`;
    const body =
      `<h1>Curriculum Vitae</h1>` +
      `<div class="meta">${header.employeeName} (${header.employeeCode}) · ${header.functionalRole ?? ''} · ${header.departmentName ?? ''}</div>` +
      `<div class="section">Languages Known</div>${languagesBlock}` +
      `<div class="section">Educational Qualifications</div>` +
      printTable(['Year', 'Degree', 'Specialization', 'Institute'], form.qualifications.map((q) => [q.year, q.degree, q.specialization, q.institute])) +
      `<div class="section">Current Role</div><p>${form.currentRole || '—'} (${form.currentTenureFrom || '?'} → ${form.currentTenureTo || 'present'})</p><p>${form.currentResponsibilities || ''}</p>` +
      `<div class="section">Previous Positions</div>` +
      printTable(['Organisation', 'Role', 'From', 'To', 'Responsibilities'], form.experience.map((e) => [e.organisation, e.role, e.tenureFrom, e.tenureTo, e.responsibilities])) +
      `<div class="section">Trainings / Seminars / Workshops</div>` +
      printTable(['#', 'Detail'], form.trainings.map((t, i) => [t.srNo ?? i + 1, t.detail])) +
      `<div class="section">Publications / Memberships</div>` +
      printTable(['#', 'Detail'], form.publications.map((p, i) => [p.srNo ?? i + 1, p.detail]));
    printHtml('Curriculum Vitae', body);
  }

  const upd = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader
        title="My CV"
        description="Your curriculum vitae. The header is pulled from your employee record."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save CV'}
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><div className="text-xs text-slate-500">Employee Name</div><div className="font-medium">{header?.employeeName}</div></div>
            <div><div className="text-xs text-slate-500">Employee Code</div><div className="font-medium">{header?.employeeCode}</div></div>
            <div><div className="text-xs text-slate-500">Functional Role</div><div className="font-medium">{header?.functionalRole ?? '—'}</div></div>
            <div><div className="text-xs text-slate-500">Department</div><div className="font-medium">{header?.departmentName ?? '—'}</div></div>
          </div>
        </CardContent>
      </Card>

      {/* #4: structured Language(s) Known — name + Read / Write / Understand */}
      <RepeatableSection
        title="Language(s) Known"
        rows={form.languages}
        onChange={(rows) => upd('languages', rows)}
        blank={{}}
        render={(row, set) => (
          <div className="flex flex-wrap items-center gap-3">
            <Input className="flex-1 min-w-[180px]" placeholder="Language (e.g. English)" value={row.language ?? ''} onChange={(e) => set({ ...row, language: e.target.value })} />
            <label className="flex items-center gap-1 text-sm text-slate-700"><input type="checkbox" checked={!!row.read} onChange={(e) => set({ ...row, read: e.target.checked })} /> Read</label>
            <label className="flex items-center gap-1 text-sm text-slate-700"><input type="checkbox" checked={!!row.write} onChange={(e) => set({ ...row, write: e.target.checked })} /> Write</label>
            <label className="flex items-center gap-1 text-sm text-slate-700"><input type="checkbox" checked={!!row.understand} onChange={(e) => set({ ...row, understand: e.target.checked })} /> Understand</label>
          </div>
        )}
      />

      {/* Qualifications */}
      <RepeatableSection
        title="Educational Qualifications"
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
        rows={form.trainings}
        onChange={(rows) => upd('trainings', rows)}
        blank={{}}
        render={(row, set) => (
          <Input placeholder="Detail (month-year, topic, location…) or 'Not Applicable'" value={row.detail ?? ''} onChange={(e) => set({ ...row, detail: e.target.value })} />
        )}
      />

      {/* Publications */}
      <RepeatableSection
        title="Publications / Memberships"
        rows={form.publications}
        onChange={(rows) => upd('publications', rows)}
        blank={{}}
        render={(row, set) => (
          <Input placeholder="Detail or 'Not Applicable'" value={row.detail ?? ''} onChange={(e) => set({ ...row, detail: e.target.value })} />
        )}
      />
    </div>
  );
}

function RepeatableSection<T>({
  title,
  rows,
  onChange,
  blank,
  render,
}: {
  title: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: T;
  render: (row: T, set: (next: T) => void) => React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <CardContent>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase text-slate-500">{title}</div>
          <Button size="sm" variant="outline" onClick={() => onChange([...rows, { ...blank }])}>
            <Plus className="h-4 w-4" /> Add row
          </Button>
        </div>
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
      </CardContent>
    </Card>
  );
}
