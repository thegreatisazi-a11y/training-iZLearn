/**
 * Canonical Job Description printout. Used by BOTH the "Job Description" module
 * (JDPage) and "My Job Description" (MyJobDescriptionPage) so a printed JD looks
 * identical regardless of where it was printed from.
 */
import DOMPurify from 'dompurify';
import { printHtml, printTable, escapeHtml } from './print';
import { formatDate } from './format';

export interface JdPrintData {
  title: string;
  version: number;
  status: string;
  employeeName?: string | null;
  employeeCode?: string | null;
  department?: string | null;
  functionalRole?: string | null;
  approvedByName?: string | null;
  acknowledgedAt?: string | null;
  content?: string | null;
}

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function printJobDescription(jd: JdPrintData, meta?: { printedBy?: string | null }): void {
  const body = `
      <h1>Job Description</h1>
      <div class="sub">${escapeHtml(jd.title)} · v${jd.version} · ${escapeHtml(String(jd.status).replace(/_/g, ' '))}</div>
      ${printTable(
        ['Field', 'Value'],
        [
          ['Employee Name', dash(jd.employeeName)],
          ['Employee Code', dash(jd.employeeCode)],
          ['Department', dash(jd.department)],
          ['Functional Role', dash(jd.functionalRole)],
          ['JD Version', `v${jd.version}`],
          ['Approved By', dash(jd.approvedByName)],
          ['Acknowledged', jd.acknowledgedAt ? `Yes · ${formatDate(jd.acknowledgedAt)}` : 'Pending'],
        ],
      )}
      <div class="section">Job Description Details</div>
      <div>${DOMPurify.sanitize(jd.content ?? '')}</div>
    `;
  printHtml(`Job Description — ${jd.title}`, body, { printedBy: meta?.printedBy ?? undefined });
}
