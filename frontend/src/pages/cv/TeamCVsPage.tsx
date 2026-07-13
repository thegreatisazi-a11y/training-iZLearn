import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Printer } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/spinner';
import { CvDocument } from '@/components/common/CvDocument';
import { svc } from '@/services';
import { printCurriculumVitae } from '@/lib/cvPrint';

interface TeamRow {
  id: string;
  fullName: string;
  employeeId: string;
  departmentName?: string | null;
  functionalRole?: string | null;
  hasCv: boolean;
}
interface CvHeader { employeeName: string; employeeCode: string; departmentName?: string | null; functionalRole?: string | null }
interface LanguageItem { language?: string; read?: boolean; write?: boolean; understand?: boolean }
interface CvData {
  version?: number;
  languagesKnown?: string | null;
  languages?: LanguageItem[];
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
  // CR-CV3: client-side filters over the loaded team list (name / employee code / dept / functional role / CV status).
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [frFilter, setFrFilter] = useState('');
  const [cvFilter, setCvFilter] = useState('');

  // Load a large page so filtering operates over the full team, not just one page.
  const params = { page: 1, pageSize: 1000 };
  const { data, isLoading } = useQuery({ queryKey: ['team-cvs', params], queryFn: () => svc.cv.team(params) });

  const allRows = (data?.data ?? []) as unknown as TeamRow[];
  const deptOpts = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.departmentName).filter(Boolean) as string[])).sort(),
    [allRows],
  );
  const frOpts = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.functionalRole).filter(Boolean) as string[])).sort(),
    [allRows],
  );
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (q && !(`${r.fullName} ${r.employeeId}`.toLowerCase().includes(q))) return false;
      if (deptFilter && r.departmentName !== deptFilter) return false;
      if (frFilter && r.functionalRole !== frFilter) return false;
      if (cvFilter === 'yes' && !r.hasCv) return false;
      if (cvFilter === 'no' && r.hasCv) return false;
      return true;
    });
  }, [allRows, search, deptFilter, frFilter, cvFilter]);
  const pageSize = 50;
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
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
    if (!cvData?.header) return;
    printCurriculumVitae(cvData.header, cvData.cv);
  }

  return (
    <div>
      <PageHeader title="Team CVs" description="Curriculum vitae for your direct reports (supervisors) or everyone (admin)." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name or employee code…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-64"
        />
        <Select
          value={deptFilter}
          onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}
          className="w-48"
          options={[{ value: '', label: 'All departments' }, ...deptOpts.map((d) => ({ value: d, label: d }))]}
        />
        <Select
          value={frFilter}
          onChange={(e) => { setFrFilter(e.target.value); setPage(1); }}
          className="w-48"
          options={[{ value: '', label: 'All functional roles' }, ...frOpts.map((f) => ({ value: f, label: f }))]}
        />
        <Select
          value={cvFilter}
          onChange={(e) => { setCvFilter(e.target.value); setPage(1); }}
          className="w-36"
          options={[{ value: '', label: 'CV: any' }, { value: 'yes', label: 'CV on file' }, { value: 'no', label: 'No CV' }]}
        />
        {(search || deptFilter || frFilter || cvFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setDeptFilter(''); setFrFilter(''); setCvFilter(''); setPage(1); }}>Clear</Button>
        )}
        <span className="ml-auto text-xs text-slate-500">{filteredRows.length} of {allRows.length}</span>
      </div>
      <DataTable
        columns={columns}
        rows={pagedRows}
        loading={isLoading}
        page={page}
        pageSize={pageSize}
        total={filteredRows.length}
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
          // C2: render the same formatted, read-only CV layout used on "My CV".
          <CvDocument header={cvData.header} cv={cvData.cv} />
        )}
      </Dialog>
    </div>
  );
}
