import { Card, CardContent } from '@/components/ui/card';

/**
 * Read-only, formatted Curriculum Vitae layout shared by "My CV" (read mode) and
 * "Team CVs" (View). Renders the controlled-document sections: header, languages,
 * qualifications, current role, previous positions, trainings and publications.
 */

export interface CvDocHeader {
  employeeName: string;
  employeeCode: string;
  departmentName?: string | null;
  functionalRole?: string | null;
  functionalRoles?: string[];
}
export interface CvDocLanguage { language?: string; read?: boolean; write?: boolean; understand?: boolean }
export interface CvDocData {
  languagesKnown?: string | null;
  languages?: CvDocLanguage[];
  qualifications?: { year?: string; degree?: string; specialization?: string; institute?: string }[];
  currentRole?: string | null;
  currentTenureFrom?: string | null;
  currentTenureTo?: string | null;
  currentResponsibilities?: string | null;
  experience?: { organisation?: string; role?: string; tenureFrom?: string; tenureTo?: string; responsibilities?: string }[];
  trainings?: { srNo?: string | number; detail?: string }[];
  publications?: { srNo?: string | number; detail?: string }[];
}

function langCaps(l: CvDocLanguage): string {
  return [l.read && 'Read', l.write && 'Write', l.understand && 'Understand'].filter(Boolean).join(' / ');
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <CardContent>
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        {children}
      </CardContent>
    </Card>
  );
}

function Empty() {
  return <p className="text-sm text-slate-400">Not provided.</p>;
}

export function CvDocument({ header, cv }: { header?: CvDocHeader; cv?: CvDocData | null }) {
  const languages = (cv?.languages ?? []).filter((l) => l.language);
  const quals = (cv?.qualifications ?? []).filter((q) => q.year || q.degree || q.specialization || q.institute);
  const experience = (cv?.experience ?? []).filter((e) => e.organisation || e.role || e.responsibilities);
  const trainings = (cv?.trainings ?? []).filter((t) => t.detail);
  const publications = (cv?.publications ?? []).filter((p) => p.detail);

  return (
    <div>
      {header && (
        <Card className="mb-4">
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><div className="text-xs text-slate-500">Employee Name</div><div className="font-medium">{header.employeeName}</div></div>
              <div><div className="text-xs text-slate-500">Employee Code</div><div className="font-medium">{header.employeeCode}</div></div>
              <div><div className="text-xs text-slate-500">Functional Role</div><div className="font-medium">{header.functionalRole ?? '—'}</div></div>
              <div><div className="text-xs text-slate-500">Department</div><div className="font-medium">{header.departmentName ?? '—'}</div></div>
            </div>
          </CardContent>
        </Card>
      )}

      <Section title="Language(s) Known">
        {languages.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1">Language</th><th className="py-1">Read</th><th className="py-1">Write</th><th className="py-1">Understand</th>
              </tr>
            </thead>
            <tbody>
              {languages.map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1">{l.language}</td>
                  <td className="py-1">{l.read ? '✓' : '—'}</td>
                  <td className="py-1">{l.write ? '✓' : '—'}</td>
                  <td className="py-1">{l.understand ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : cv?.languagesKnown ? (
          <p className="text-sm text-slate-700">{cv.languagesKnown}</p>
        ) : (
          <Empty />
        )}
        {!!languages.length && (
          <div className="sr-only">{languages.map((l) => `${l.language}: ${langCaps(l)}`).join('; ')}</div>
        )}
      </Section>

      <Section title="Educational Qualifications">
        {quals.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1">Year</th><th className="py-1">Degree / Certification</th><th className="py-1">Specialization</th><th className="py-1">Institute / University</th>
              </tr>
            </thead>
            <tbody>
              {quals.map((q, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1">{q.year || '—'}</td>
                  <td className="py-1">{q.degree || '—'}</td>
                  <td className="py-1">{q.specialization || '—'}</td>
                  <td className="py-1">{q.institute || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="Current Role">
        {cv?.currentRole || cv?.currentResponsibilities ? (
          <div className="text-sm text-slate-700">
            <p className="font-medium">
              {cv?.currentRole || '—'}
              {(cv?.currentTenureFrom || cv?.currentTenureTo) && (
                <span className="font-normal text-slate-500"> ({cv?.currentTenureFrom || '?'} → {cv?.currentTenureTo || 'present'})</span>
              )}
            </p>
            {cv?.currentResponsibilities && <p className="mt-1 whitespace-pre-line text-slate-600">{cv.currentResponsibilities}</p>}
          </div>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="Previous Positions">
        {experience.length ? (
          <div className="space-y-3">
            {experience.map((e, i) => (
              <div key={i} className="border-t border-slate-100 pt-2 text-sm first:border-0 first:pt-0">
                <p className="font-medium text-slate-700">
                  {[e.role, e.organisation].filter(Boolean).join(' · ') || '—'}
                  {(e.tenureFrom || e.tenureTo) && <span className="font-normal text-slate-500"> ({e.tenureFrom || '?'} → {e.tenureTo || '?'})</span>}
                </p>
                {e.responsibilities && <p className="mt-1 whitespace-pre-line text-slate-600">{e.responsibilities}</p>}
              </div>
            ))}
          </div>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="Trainings / Seminars / Workshops">
        {trainings.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {trainings.map((t, i) => (
              <li key={i}>{t.detail}</li>
            ))}
          </ol>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="Publications / Memberships">
        {publications.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {publications.map((p, i) => (
              <li key={i}>{p.detail}</li>
            ))}
          </ol>
        ) : (
          <Empty />
        )}
      </Section>
    </div>
  );
}
