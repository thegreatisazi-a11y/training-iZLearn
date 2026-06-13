import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Printer } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/spinner';
import { svc } from '@/services';
import { printHtml, printTable } from '@/lib/print';

interface TeamRow {
  id: string;
  fullName: string;
  employeeId: string;
  departmentName?: string | null;
  functionalRole?: string | null;
  hasCv: boolean;
}
interface CvHeader { employeeName: string; employeeCode: string; departmentName?: string | null; functionalRole?: string | null }
interface CvData {
  languagesKnown?: string | null;
  qualifications?: { year?: string; degree?: string; specialization?: string; institute?: string }[];
  currentRole?: string | null;
  currentResponsibilities?: string | null;
  experience?: { organisation?: string; role?: string; tenureFrom?: string; tenureTo?: string; responsibilities?: string }[];
  trainings?: { detail?: string }[];
  publications?: { detail?: string }[];
}

export default function TeamCVsPage() {
  const [page, setPage] = useState(1);
  const [viewUserId, setViewUserId] = useState<string | null>(null);

  const params = { page, pageSize: 50 };
  const { data, isLoading } = useQuery({ queryKey: ['team-cvs', params], queryFn: () => svc.cv.team(params) });
  const { data: cvData, isLoading: cvLoading } = useQuery({
    queryKey: ['team-cv', viewUserId],
    queryFn: () => svc.cv.user(viewUserId as string) as unknown as Promise<{ header: CvHeader; cv: CvData | null }>,
    enabled: !!viewUserId,
  });

  const columns: Column<TeamRow>[] = [
    { key: 'fullName', header: 'Name' },
    { key: 'employeeId', header: 'Employee Code' },
    { key: 'functionalRole', header: 'Functional Role', render: (r) => r.functionalRole ?? '—' },
    { key: 'departmentName', header: 'Department', render: (r) => r.departmentName ?? '—' },
    { key: 'hasCv', header: 'CV', render: (r) => (r.hasCv ? <Badge tone="COMPLETED">On file</Badge> : <Badge tone="PENDING">Not created</Badge>) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => setViewUserId(r.id)}>
          <Eye className="h-4 w-4" /> View CV
        </Button>
      ),
    },
  ];

  function handlePrint() {
    const h = cvData?.header;
    const cv = cvData?.cv;
    if (!h) return;
    const body =
      `<h1>Curriculum Vitae</h1>` +
      `<div class="meta">${h.employeeName} (${h.employeeCode}) · ${h.functionalRole ?? ''} · ${h.departmentName ?? ''}</div>` +
      `<div class="section">Languages Known</div><p>${cv?.languagesKnown || '—'}</p>` +
      `<div class="section">Educational Qualifications</div>` +
      printTable(['Year', 'Degree', 'Specialization', 'Institute'], (cv?.qualifications ?? []).map((q) => [q.year, q.degree, q.specialization, q.institute])) +
      `<div class="section">Current Role</div><p>${cv?.currentRole || '—'}</p><p>${cv?.currentResponsibilities || ''}</p>` +
      `<div class="section">Previous Positions</div>` +
      printTable(['Organisation', 'Role', 'From', 'To', 'Responsibilities'], (cv?.experience ?? []).map((e) => [e.organisation, e.role, e.tenureFrom, e.tenureTo, e.responsibilities]));
    printHtml('Curriculum Vitae', body);
  }

  return (
    <div>
      <PageHeader title="Team CVs" description="Curriculum vitae for your direct reports (supervisors) or everyone (admin)." />
      <DataTable
        columns={columns}
        rows={(data?.data ?? []) as unknown as TeamRow[]}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No team members found."
      />

      <Dialog
        open={!!viewUserId}
        onClose={() => setViewUserId(null)}
        className="max-w-3xl"
        title={cvData?.header ? `CV — ${cvData.header.employeeName}` : 'Curriculum Vitae'}
        footer={
          <>
            <Button variant="outline" onClick={handlePrint} disabled={!cvData?.cv}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            <Button variant="outline" onClick={() => setViewUserId(null)}>Close</Button>
          </>
        }
      >
        {cvLoading ? (
          <PageLoader />
        ) : !cvData?.cv ? (
          <p className="text-sm text-slate-500">This user has not created a CV yet.</p>
        ) : (
          <div className="space-y-3 text-sm text-slate-700">
            <p><span className="text-slate-500">Languages:</span> {cvData.cv.languagesKnown || '—'}</p>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Qualifications</div>
              <ul className="list-disc pl-5">
                {(cvData.cv.qualifications ?? []).map((q, i) => (
                  <li key={i}>{[q.year, q.degree, q.specialization, q.institute].filter(Boolean).join(' · ') || '—'}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Current Role</div>
              <p>{cvData.cv.currentRole || '—'}</p>
              <p className="text-slate-600">{cvData.cv.currentResponsibilities}</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Previous Positions</div>
              <ul className="list-disc pl-5">
                {(cvData.cv.experience ?? []).map((e, i) => (
                  <li key={i}>{[e.organisation, e.role, `${e.tenureFrom ?? ''}–${e.tenureTo ?? ''}`].filter(Boolean).join(' · ')}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
