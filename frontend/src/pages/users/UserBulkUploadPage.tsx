import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/PageHeader';
import { FileUpload } from '@/components/common/FileUpload';
import { EmptyState } from '@/components/common/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { svc } from '@/services';

/** Mirrors the backend CreateUserInput rows returned by /users/bulk/preview. */
interface ValidRow {
  userType: string;
  fullName: string;
  employeeId: string;
  windowsUsername: string;
  email?: string;
  departmentId: string;
  locationId: string;
  roleIds: string[];
  remarks?: string;
}

interface PreviewError {
  row: number;
  messages: string[];
}

interface PreviewResult {
  valid: ValidRow[];
  errors: PreviewError[];
}

interface CommitSummary {
  created: number;
  failed: number;
}

export default function UserBulkUploadPage() {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  // Item 7: live upload progress percentage for the file-upload steps.
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [commitPct, setCommitPct] = useState<number | null>(null);

  const previewMutation = useMutation({
    mutationFn: (file: File) => {
      setUploadPct(0);
      return svc.users.bulkPreview(file, setUploadPct) as unknown as Promise<PreviewResult>;
    },
    onSettled: () => setUploadPct(null),
    onSuccess: (data) => {
      setPreview(data);
      setSummary(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const commitMutation = useMutation({
    mutationFn: (rows: ValidRow[]) => {
      setCommitPct(0);
      return svc.users.bulkCommit(rows, setCommitPct) as unknown as Promise<CommitSummary>;
    },
    onSettled: () => setCommitPct(null),
    onSuccess: (data) => {
      setSummary(data);
      setPreview(null);
      toast.success(`Bulk upload complete — ${data.created} user request(s) created.`);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const validRows = preview?.valid ?? [];
  const errors = preview?.errors ?? [];

  return (
    <div>
      <PageHeader title="Bulk User Upload" description="Upload an Excel sheet to create multiple user requests at once." />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-4">
          <FileUpload accept=".xls,.xlsx" label="Choose Excel file" onSelect={(f) => previewMutation.mutate(f)} progress={uploadPct} />
          {previewMutation.isPending && uploadPct === 100 && <span className="text-sm text-slate-500">Validating…</span>}
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Summary</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-6 text-sm">
            <div>
              <div className="text-2xl font-semibold text-green-700">{summary.created}</div>
              <div className="text-slate-500">Created</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-red-600">{summary.failed}</div>
              <div className="text-slate-500">Failed</div>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <div className="space-y-6">
          {errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Errors ({errors.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {errors.map((er) => (
                  <div key={er.row} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <strong>Row {er.row}:</strong> {er.messages.join('; ')}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="iz-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">Valid Rows</span>
                <Badge tone="APPROVED">{validRows.length}</Badge>
              </div>
              <Button disabled={validRows.length === 0 || commitMutation.isPending} onClick={() => commitMutation.mutate(validRows)}>
                {commitMutation.isPending
                  ? commitPct != null && commitPct < 100
                    ? `Uploading… ${commitPct}%`
                    : 'Committing…'
                  : `Commit ${validRows.length} Row(s)`}
              </Button>
            </div>
            {validRows.length === 0 ? (
              <EmptyState message="No valid rows to import." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Type</TH>
                    <TH>Full Name</TH>
                    <TH>Employee ID</TH>
                    <TH>Username</TH>
                    <TH>Email</TH>
                    <TH>Roles</TH>
                  </TR>
                </THead>
                <TBody>
                  {validRows.map((r, i) => (
                    <TR key={`${r.windowsUsername}-${i}`}>
                      <TD>{r.userType}</TD>
                      <TD>{r.fullName}</TD>
                      <TD>{r.employeeId}</TD>
                      <TD>{r.windowsUsername}</TD>
                      <TD>{r.email ?? '—'}</TD>
                      <TD>{r.roleIds.length}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </div>
      )}

      {!preview && !summary && !previewMutation.isPending && (
        <EmptyState message="Upload a .xls or .xlsx file to preview rows before committing." />
      )}
    </div>
  );
}
