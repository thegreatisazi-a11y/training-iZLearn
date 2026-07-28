import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExportMenu } from '@/components/common/ExportMenu';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/store/authStore';
import { svc, downloadBlob } from '@/services';
import { printPdfBlob } from '@/lib/print';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';

interface ReportResult {
  title: string;
  columns: Array<{ header: string; key: string }>;
  rows: Array<Record<string, unknown>>;
}

const EXT: Record<string, string> = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };

function labelFor(type: string) {
  return type.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const canExport = useAuthStore((s) => s.hasPermission)('reports', 'export');
  const canPrint = useAuthStore((s) => s.hasPermission)('reports', 'print');

  // Each report declares the filters it actually uses (backend is the source of truth), so we
  // render only those and never show a control the report would silently ignore.
  const types = useQuery({ queryKey: ['reports', 'types'], queryFn: () => svc.reports.types() as unknown as Promise<Array<{ type: string; filters: string[] }>> });
  const typeMeta = useMemo(() => types.data ?? [], [types.data]);
  const typeOpts = useMemo(() => typeMeta.map((t) => ({ value: t.type, label: labelFor(t.type) })), [typeMeta]);

  // R1: dropdown data for the filters (replaces the old free-text ID inputs).
  const topicsQ = useQuery({ queryKey: ['reports', 'topics'], queryFn: () => svc.topics.list({ pageSize: 500 }) });
  const usersQ = useQuery({ queryKey: ['reports', 'users'], queryFn: () => svc.users.list({ pageSize: 1000 }) });
  const deptsQ = useQuery({ queryKey: ['reports', 'depts'], queryFn: () => svc.departments.list({ pageSize: 500 }) });
  const locsQ = useQuery({ queryKey: ['reports', 'locs'], queryFn: () => svc.locations.list({ pageSize: 500 }) });
  const desigsQ = useQuery({ queryKey: ['reports', 'desigs'], queryFn: () => svc.master.listDesignations({ pageSize: 500 }) });

  const rowsOf = (r: unknown): Array<Record<string, unknown>> => ((r as { data?: unknown } | undefined)?.data as Array<Record<string, unknown>>) ?? [];
  const topicOpts = useMemo(() => rowsOf(topicsQ.data).map((t) => ({ value: String(t.id), label: `${(t.topicNumber ?? t.topicCode ?? '') as string} ${(t.title ?? '') as string}`.trim() })), [topicsQ.data]);
  const userOpts = useMemo(() => rowsOf(usersQ.data).map((u) => ({ value: String(u.id), label: `${u.fullName as string}${u.employeeId ? ` (${u.employeeId as string})` : ''}` })), [usersQ.data]);
  const deptOpts = useMemo(() => rowsOf(deptsQ.data).map((d) => ({ value: String(d.id), label: String(d.name ?? d.id) })), [deptsQ.data]);
  const locOpts = useMemo(() => rowsOf(locsQ.data).map((l) => ({ value: String(l.id), label: String(l.name ?? l.id) })), [locsQ.data]);
  const desigOpts = useMemo(() => rowsOf(desigsQ.data).map((d) => ({ value: String(d.id), label: String(d.displayName ?? d.id) })), [desigsQ.data]);

  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [topicId, setTopicId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [userId, setUserId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);

  // The filters the currently-selected report supports. Drives which controls render AND which
  // values are actually sent, so the panel and the query can never disagree.
  const activeFilters = useMemo(() => new Set(typeMeta.find((t) => t.type === type)?.filters ?? []), [typeMeta, type]);
  const has = (key: string) => activeFilters.has(key);

  function filters() {
    return {
      from: has('dateRange') ? from || undefined : undefined,
      to: has('dateRange') ? to || undefined : undefined,
      includeInactive: has('includeInactive') ? includeInactive || undefined : undefined,
      topicId: has('topic') ? topicId || undefined : undefined,
      departmentId: has('department') ? departmentId || undefined : undefined,
      userId: has('user') ? userId || undefined : undefined,
      locationId: has('location') ? locationId || undefined : undefined,
      designationId: has('designation') ? designationId || undefined : undefined,
      supervisorId: has('supervisor') ? supervisorId || undefined : undefined,
    };
  }

  const run = useMutation({
    mutationFn: () => svc.reports.get(type, filters()) as unknown as Promise<ReportResult>,
    onSuccess: (r) => setResult(r),
    onError: (e) => toast.error(apiError(e)),
  });

  // Item 7: live export progress percentage.
  const [exportPct, setExportPct] = useState<number | null>(null);
  const exportMutation = useMutation({
    mutationFn: async ({ format, print }: { format: string; print?: boolean }) => {
      setExportPct(0);
      const res = await svc.reports.export(type, { ...filters(), format, ...(print ? { print: true } : {}) }, setExportPct);
      return { blob: res.data as Blob, format, print: !!print };
    },
    onSettled: () => setExportPct(null),
    onSuccess: ({ blob, format, print }) => {
      // Print opens the PDF in the browser's print dialog; every other format downloads a file.
      if (print) {
        if (!printPdfBlob(blob)) toast.error('Please allow pop-ups to print this report.');
      } else {
        downloadBlob(blob, `${type}.${EXT[format] ?? format}`);
      }
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const columns: Column<Record<string, unknown>>[] = (result?.columns ?? []).map((c) => ({
    key: c.key,
    header: c.header,
    render: (row) => String(row[c.key] ?? '—'),
  }));

  // #7: drill-down — rows that carry a hidden _userId / _topicId open the matching
  // detail (employee → My Team member view; topic → course detail), like My Teams.
  const rowsHaveDrill = (result?.rows ?? []).some((r) => r._userId || r._topicId);
  function drillInto(row: Record<string, unknown>) {
    const uid = row._userId as string | undefined;
    const tid = row._topicId as string | undefined;
    if (uid) navigate(`/team/${uid}`);
    else if (tid) navigate(`/topics/${tid}`);
  }

  return (
    <div>
      <PageHeader title="Reports" description="Generate compliance and training reports." />

      <Card className="mb-6">
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Report type" hint={!type ? 'Choose a report to see its filters.' : undefined}>
              <Select options={typeOpts} value={type} onChange={(e) => { setType(e.target.value); setResult(null); }} placeholder="Select a report…" />
            </Field>
            {has('dateRange') && (
              <Field label="From">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
            )}
            {has('dateRange') && (
              <Field label="To">
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            )}
            {has('topic') && (
              <Field label="Topic">
                <Select options={topicOpts} value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="All topics" />
              </Field>
            )}
            {has('department') && (
              <Field label="Department">
                <Select options={deptOpts} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="All departments" />
              </Field>
            )}
            {has('user') && (
              <Field label="User">
                <Select options={userOpts} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="All users" />
              </Field>
            )}
            {has('location') && (
              <Field label="Location">
                <Select options={locOpts} value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="All locations" />
              </Field>
            )}
            {has('designation') && (
              <Field label="Functional Role">
                <Select options={desigOpts} value={designationId} onChange={(e) => setDesignationId(e.target.value)} placeholder="All functional roles" />
              </Field>
            )}
            {has('supervisor') && (
              <Field label="Reporting Manager">
                <Select options={userOpts} value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} placeholder="All managers" />
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {has('includeInactive') && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
                Include inactive users
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run.mutate()} disabled={!type || run.isPending}>
                {run.isPending ? 'Running…' : 'Run'}
              </Button>
              {(canExport || canPrint) && (
                <ExportMenu
                  disabled={!type}
                  busy={exportMutation.isPending}
                  formats={[...(canExport ? (['csv', 'excel', 'pdf'] as const) : []), ...(canPrint ? (['print'] as const) : [])]}
                  onSelect={(f) =>
                    exportMutation.mutate(
                      f === 'csv' ? { format: 'csv' } : f === 'excel' ? { format: 'xlsx' } : f === 'pdf' ? { format: 'pdf' } : { format: 'pdf', print: true },
                    )
                  }
                />
              )}
              {exportMutation.isPending && <span className="self-center text-sm text-slate-500">Exporting… {exportPct ?? 0}%</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      {result && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">{result.title}</h2>
          {rowsHaveDrill && <p className="mb-2 text-xs text-slate-400">Tip: click a row to open its details.</p>}
          <DataTable
            columns={columns}
            rows={result.rows}
            emptyText="No data for the selected filters."
            onRowClick={rowsHaveDrill ? drillInto : undefined}
          />
        </div>
      )}
    </div>
  );
}
