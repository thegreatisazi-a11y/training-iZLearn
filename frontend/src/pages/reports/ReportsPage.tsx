import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/store/authStore';
import { svc, downloadBlob } from '@/services';
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

  const types = useQuery({ queryKey: ['reports', 'types'], queryFn: () => svc.reports.types() as unknown as Promise<string[]> });
  const typeOpts = useMemo(() => (types.data ?? []).map((t) => ({ value: t, label: labelFor(t) })), [types.data]);

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

  function filters() {
    return {
      from: from || undefined,
      to: to || undefined,
      includeInactive: includeInactive || undefined,
      topicId: topicId || undefined,
      departmentId: departmentId || undefined,
      userId: userId || undefined,
      locationId: locationId || undefined,
      designationId: designationId || undefined,
      supervisorId: supervisorId || undefined,
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
      return { blob: res.data as Blob, format };
    },
    onSettled: () => setExportPct(null),
    onSuccess: ({ blob, format }) => downloadBlob(blob, `${type}.${EXT[format] ?? format}`),
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
            <Field label="Report type">
              <Select options={typeOpts} value={type} onChange={(e) => { setType(e.target.value); setResult(null); }} placeholder="Select a report…" />
            </Field>
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Topic">
              <Select options={topicOpts} value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="All topics" />
            </Field>
            <Field label="Department">
              <Select options={deptOpts} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="All departments" />
            </Field>
            <Field label="User">
              <Select options={userOpts} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="All users" />
            </Field>
            <Field label="Location">
              <Select options={locOpts} value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="All locations" />
            </Field>
            <Field label="Functional Role">
              <Select options={desigOpts} value={designationId} onChange={(e) => setDesignationId(e.target.value)} placeholder="All functional roles" />
            </Field>
            <Field label="Reporting Manager">
              <Select options={userOpts} value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} placeholder="All managers" />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Include inactive users
            </label>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run.mutate()} disabled={!type || run.isPending}>
                {run.isPending ? 'Running…' : 'Run'}
              </Button>
              {canExport && (
                <>
                  <Button variant="outline" disabled={!type || exportMutation.isPending} onClick={() => exportMutation.mutate({ format: 'csv' })}>
                    <Download className="h-4 w-4" /> CSV
                  </Button>
                  <Button variant="outline" disabled={!type || exportMutation.isPending} onClick={() => exportMutation.mutate({ format: 'xlsx' })}>
                    <Download className="h-4 w-4" /> Excel
                  </Button>
                  <Button variant="outline" disabled={!type || exportMutation.isPending} onClick={() => exportMutation.mutate({ format: 'pdf' })}>
                    <Download className="h-4 w-4" /> PDF
                  </Button>
                </>
              )}
              {canPrint && (
                <Button variant="outline" disabled={!type || exportMutation.isPending} onClick={() => exportMutation.mutate({ format: 'pdf', print: true })}>
                  <Printer className="h-4 w-4" /> Print
                </Button>
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
