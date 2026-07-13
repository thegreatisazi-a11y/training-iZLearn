/**
 * Canonical Curriculum Vitae printout. Used by BOTH "Team CVs" (TeamCVsPage) and
 * the supervisor's "My Team → member" view (TeamMemberPage) so a printed/downloaded
 * CV looks identical regardless of where it was printed from. Mirrors jdPrint.ts.
 */
import { printHtml, printTable } from './print';

export interface CvPrintHeader {
  employeeName: string;
  employeeCode: string;
  departmentName?: string | null;
  functionalRole?: string | null;
}
export interface CvPrintLanguage { language?: string; read?: boolean; write?: boolean; understand?: boolean }
export interface CvPrintData {
  version?: number;
  languagesKnown?: string | null;
  languages?: CvPrintLanguage[];
  qualifications?: { year?: string; degree?: string; specialization?: string; institute?: string }[];
  currentRole?: string | null;
  currentResponsibilities?: string | null;
  experience?: { organisation?: string; role?: string; tenureFrom?: string; tenureTo?: string; responsibilities?: string }[];
  trainings?: { detail?: string }[];
  publications?: { detail?: string }[];
}

/** Open the browser print dialog (which can "print to PDF") for a curriculum vitae. */
export function printCurriculumVitae(header: CvPrintHeader, cv: CvPrintData | null | undefined): void {
  const langs = (cv?.languages ?? []).filter((l) => l.language);
  const languagesBlock = langs.length
    ? printTable(
        ['Language', 'Read', 'Write', 'Understand'],
        langs.map((l) => [l.language, l.read ? 'Yes' : 'No', l.write ? 'Yes' : 'No', l.understand ? 'Yes' : 'No']),
      )
    : `<p>${cv?.languagesKnown || '—'}</p>`;

  const body =
    `<h1>Curriculum Vitae</h1>` +
    `<div class="meta">${header.employeeName} (${header.employeeCode}) · ${header.functionalRole ?? ''} · ${header.departmentName ?? ''} · v${cv?.version ?? 1}</div>` +
    `<div class="section">Languages Known</div>${languagesBlock}` +
    `<div class="section">Educational Qualifications</div>` +
    printTable(['Year', 'Degree', 'Specialization', 'Institute'], (cv?.qualifications ?? []).map((q) => [q.year, q.degree, q.specialization, q.institute])) +
    `<div class="section">Current Role</div><p>${cv?.currentRole || '—'}</p><p>${cv?.currentResponsibilities || ''}</p>` +
    `<div class="section">Previous Positions</div>` +
    printTable(['Organisation', 'Role', 'From', 'To', 'Responsibilities'], (cv?.experience ?? []).map((e) => [e.organisation, e.role, e.tenureFrom, e.tenureTo, e.responsibilities])) +
    `<div class="section">Trainings / Seminars / Workshops</div>` +
    printTable(['#', 'Detail'], (cv?.trainings ?? []).filter((tr) => tr.detail).map((tr, i) => [i + 1, tr.detail])) +
    `<div class="section">Publications / Memberships</div>` +
    printTable(['#', 'Detail'], (cv?.publications ?? []).filter((p) => p.detail).map((p, i) => [i + 1, p.detail]));

  printHtml('Curriculum Vitae', body);
}
