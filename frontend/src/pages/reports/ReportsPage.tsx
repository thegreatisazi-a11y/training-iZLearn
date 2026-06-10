import { useMemo, useState } from 'react';
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
  const canExport = useAuthStore((s) => s.hasPermission)('reports', 'export');
  const canPrint = useAuthStore((s) => s.hasPermission)('reports', 'print');

  const types = useQuery({ queryKey: ['reports', 'types'], queryFn: () => svc.reports.types() as unknown as Promise<string[]> });
  const typeOpts = useMemo(() => (types.data ?? []).map((t) => ({ value: t, label: labelFor(t) })), [types.data]);

  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [topicId, setTopicId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [userId, setUserId] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);

  function filters() {
    return {
      from: from || undefined,
      to: to || undefined,
      includeInactive: includeInactive || undefined,
      topicId: topicId || undefined,
      departmentId: departmentId || undefined,
      userId: userId || undefined,
    };
  }

  const run = useMutation({
    mutationFn: () => svc.reports.get(type, filters()) as unknown as Promise<ReportResult>,
    onSuccess: (r) => setResult(r),
    onError: (e) => toast.error(apiError(e)),
  });

  const exportMutation = useMutation({
    mutationFn: async ({ format, print }: { format: string; print?: boolean }) => {
      const res = await svc.reports.export(type, { ...filters(), format, ...(print ? { print: true } : {}) });
      return { blob: res.data as Blob, format };
    },
    onSuccess: ({ blob, format }) => downloadBlob(blob, `${type}.${EXT[format] ?? format}`),
    onError: (e) => toast.error(apiError(e)),
  });

  const columns: Column<Record<string, unknown>>[] = (result?.columns ?? []).map((c) => ({
    key: c.key,
    header: c.header,
    render: (row) => String(row[c.key] ?? '—'),
  }));

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
            <Field label="Topic ID">
              <Input value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Department ID">
              <Input value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="User ID">
              <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Optional" />
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
            </div>
          </div>
        </CardContent>
      </Card>

      {result && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">{result.title}</h2>
          <DataTable columns={columns} rows={result.rows} emptyText="No data for the selected filters." />
        </div>
      )}
    </div>
  );
}
