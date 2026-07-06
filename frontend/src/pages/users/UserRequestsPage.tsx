import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { formatDateTime } from '@/lib/format';
import { svc } from '@/services';

interface RequestRow {
  id: string;
  fullName: string;
  employeeId: string;
  windowsUsername: string;
  userType: string;
  status: string;
  createdAt?: string;
  decidedByName?: string | null;
  decidedAt?: string | null;
}

type Decision = 'APPROVE' | 'REJECT';

export default function UserRequestsPage() {
  const qc = useQueryClient();
  // User Requests is its own permission module now (split from Users).
  const canApprove = useAuthStore((s) => s.hasPermission)('userRequests', 'approve');

  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<{ open: boolean; kind: Decision; req?: RequestRow }>({ open: false, kind: 'APPROVE' });
  const [createdUser, setCreatedUser] = useState<{ username: string; tempPassword: string } | null>(null);

  const params = { page, pageSize: 50 };
  const { data, isLoading } = useQuery({ queryKey: ['user-requests', params], queryFn: () => svc.users.listRequests(params) });

  const decideMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => svc.users.decideRequest(id, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['user-requests'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      const d = res as { windowsUsername?: string; tempPassword?: string } | undefined;
      if (d?.tempPassword) {
        setCreatedUser({ username: d.windowsUsername ?? '', tempPassword: d.tempPassword });
      } else {
        toast.success('Request decision recorded.');
      }
    },
    onError: (e) => toast.error(apiError(e)),
  });

  async function confirmDecision(signature: ESignaturePayload) {
    if (!decision.req) return;
    await decideMutation.mutateAsync({
      id: decision.req.id,
      body: { decision: decision.kind, remarks: signature.meaning, signature, reasonForChange: `User request ${decision.kind === 'APPROVE' ? 'approved' : 'rejected'}` },
    });
  }

  const columns: Column<RequestRow>[] = [
    { key: 'fullName', header: 'Full Name' },
    { key: 'employeeId', header: 'Employee ID' },
    { key: 'windowsUsername', header: 'Username' },
    { key: 'userType', header: 'Type' },
    { key: 'createdAt', header: 'Requested', render: (r) => formatDateTime(r.createdAt) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status}>{r.status}</Badge> },
    {
      key: 'authorizedBy',
      header: 'Authorized by',
      render: (r) =>
        canApprove && r.status === 'PENDING_APPROVAL' ? (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setDecision({ open: true, kind: 'APPROVE', req: r })}>
              Approve
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDecision({ open: true, kind: 'REJECT', req: r })}>
              Reject
            </Button>
          </div>
        ) : r.decidedByName ? (
          <div className="text-sm">
            <div className="font-medium text-slate-700">{r.decidedByName}</div>
            {r.decidedAt && <div className="text-xs text-slate-400">{formatDateTime(r.decidedAt)}</div>}
          </div>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      <PageHeader title="User Requests" description="Pending account creation requests awaiting approval." />

      <DataTable
        columns={columns}
        rows={(data?.data ?? []) as unknown as RequestRow[]}
        loading={isLoading}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No pending requests."
      />

      <ESignatureModal
        open={decision.open}
        onClose={() => setDecision((s) => ({ ...s, open: false }))}
        onConfirm={confirmDecision}
        title={`${decision.kind === 'APPROVE' ? 'Approve' : 'Reject'} Request — ${decision.req?.fullName ?? ''}`}
        defaultMeaning={decision.kind === 'APPROVE' ? 'Approved' : 'Rejected'}
      />

      {createdUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-lg font-semibold">User Created Successfully</h2>
            <p className="mb-4 text-sm text-slate-500">
              Share these credentials with the new user securely. The temporary password cannot be retrieved again.
            </p>
            <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-4 font-mono text-sm">
              <div className="mb-1">
                <span className="text-slate-500">Username: </span>
                <strong>{createdUser.username}</strong>
              </div>
              <div>
                <span className="text-slate-500">Temp Password: </span>
                <strong>{createdUser.tempPassword}</strong>
              </div>
            </div>
            <p className="mb-4 text-xs text-amber-600">
              The user will be required to change this password on their first login.
            </p>
            <button
              className="w-full rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              onClick={() => { setCreatedUser(null); toast.success('Request approved.'); }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
