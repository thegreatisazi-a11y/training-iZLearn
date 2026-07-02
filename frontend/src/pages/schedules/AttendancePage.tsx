import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { FileUpload } from '@/components/common/FileUpload';
import { EmptyState } from '@/components/common/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { formatDateTime } from '@/lib/format';

interface AttendanceEntry {
  id?: string;
  userId: string;
  userFullName?: string;
  employeeId?: string;
  status: string;
  method?: string;
  markedAt?: string;
}
interface Trainee {
  id: string;
  userId: string;
  fullName?: string;
  employeeId?: string;
}
interface ScheduleDetail {
  id: string;
  topicTitle?: string;
  trainees?: Trainee[];
}
interface UploadRow {
  rowNumber: number;
  employeeId: string;
  status: string;
}
interface UploadPreview {
  valid: UploadRow[];
  errors: Array<{ rowNumber: number; message: string }>;
}

const STATUS_OPTS = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
];

export default function AttendancePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const canWrite = useAuthStore((s) => s.hasPermission)('attendance', 'write');

  const attendance = useQuery({
    queryKey: ['attendance', id],
    queryFn: () => svc.attendance.list(id) as unknown as Promise<AttendanceEntry[]>,
    enabled: !!id,
  });
  const schedule = useQuery({
    queryKey: ['schedule', id],
    queryFn: () => svc.schedules.get(id) as unknown as Promise<ScheduleDetail>,
    enabled: !!id,
  });

  // Manual marking state, seeded from the schedule's trainees.
  const [marks, setMarks] = useState<Record<string, string>>({});
  useEffect(() => {
    const trainees = schedule.data?.trainees ?? [];
    setMarks((prev) => {
      const next: Record<string, string> = {};
      for (const t of trainees) next[t.userId] = prev[t.userId] ?? 'PRESENT';
      return next;
    });
  }, [schedule.data]);

  const markMutation = useMutation({
    mutationFn: () =>
      svc.attendance.mark({
        scheduleId: id,
        entries: Object.entries(marks).map(([userId, status]) => ({ userId, status })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance', id] });
      toast.success('Attendance recorded.');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Excel upload state.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);

  const previewMutation = useMutation({
    mutationFn: (f: File) => svc.attendance.uploadPreview(f) as unknown as Promise<UploadPreview>,
    onSuccess: (data) => setPreview(data),
    onError: (e) => toast.error(apiError(e)),
  });
  const commitMutation = useMutation({
    mutationFn: () => svc.attendance.uploadCommit(file as File, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance', id] });
      toast.success('Attendance imported.');
      setFile(null);
      setPreview(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const recordColumns: Column<AttendanceEntry>[] = [
    { key: 'userFullName', header: 'Trainee', render: (r) => r.userFullName ?? r.userId },
    { key: 'employeeId', header: 'Employee ID', render: (r) => r.employeeId ?? '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'PRESENT' ? 'COMPLETED' : 'REJECTED'}>{r.status}</Badge> },
    { key: 'method', header: 'Method', render: (r) => (r.method ? r.method.replace(/_/g, ' ') : '—') },
    { key: 'markedAt', header: 'Marked At', render: (r) => formatDateTime(r.markedAt) },
  ];

  const trainees = schedule.data?.trainees ?? [];

  return (
    <div>
      <PageHeader
        title="Attendance"
        description={schedule.data?.topicTitle ? `Session: ${schedule.data.topicTitle}` : undefined}
        actions={
          <Link to="/schedules">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4" /> Back to Schedules
            </Button>
          </Link>
        }
      />

      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Recorded Attendance</h2>
        <DataTable columns={recordColumns} rows={attendance.data ?? []} loading={attendance.isLoading} emptyText="No attendance recorded yet." />
      </div>

      {canWrite && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Mark Manually</CardTitle>
            </CardHeader>
            <CardContent>
              {schedule.isLoading ? (
                <PageLoader />
              ) : trainees.length === 0 ? (
                <EmptyState message="This session has no assigned trainees." />
              ) : (
                <>
                  <div className="space-y-2">
                    {trainees.map((t) => (
                      <div key={t.userId} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-slate-700">
                          {t.fullName ?? t.userId} {t.employeeId ? `(${t.employeeId})` : ''}
                        </span>
                        <Select
                          className="w-32"
                          options={STATUS_OPTS}
                          value={marks[t.userId] ?? 'PRESENT'}
                          onChange={(e) => setMarks((m) => ({ ...m, [t.userId]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-4">
                    <Button onClick={() => markMutation.mutate()} disabled={markMutation.isPending}>
                      {markMutation.isPending ? 'Saving…' : 'Save Attendance'}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Import from Excel</CardTitle>
            </CardHeader>
            <CardContent>
              <FileUpload
                accept=".xls,.xlsx"
                label="Choose spreadsheet"
                onSelect={(f) => {
                  setFile(f);
                  setPreview(null);
                  previewMutation.mutate(f);
                }}
              />
              {previewMutation.isPending && <p className="mt-3 text-sm text-slate-500">Validating…</p>}
              {preview && (
                <div className="mt-4 space-y-3 text-sm">
                  <div>
                    <p className="font-medium text-green-700">{preview.valid.length} valid row(s)</p>
                    {preview.valid.length > 0 && (
                      <ul className="mt-1 max-h-32 overflow-y-auto rounded border border-slate-200 p-2 text-slate-600">
                        {preview.valid.map((r) => (
                          <li key={r.rowNumber}>
                            Row {r.rowNumber}: {r.employeeId} → {r.status}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {preview.errors.length > 0 && (
                    <div>
                      <p className="font-medium text-red-600">{preview.errors.length} error(s)</p>
                      <ul className="mt-1 max-h-32 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-red-700">
                        {preview.errors.map((e) => (
                          <li key={e.rowNumber}>
                            Row {e.rowNumber}: {e.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button onClick={() => commitMutation.mutate()} disabled={commitMutation.isPending || preview.valid.length === 0}>
                    {commitMutation.isPending ? 'Importing…' : `Commit ${preview.valid.length} row(s)`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
