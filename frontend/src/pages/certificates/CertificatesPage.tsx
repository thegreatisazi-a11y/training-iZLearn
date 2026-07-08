import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { formatDate } from '@/lib/format';

async function downloadCertificate(c: Certificate) {
  try {
    await svc.certificates.download(c.id, `${c.certificateNumber}.pdf`);
  } catch (e) {
    toast.error(apiError(e));
  }
}

// View a certificate PDF inline. Opens the tab synchronously (within the click) so it
// isn't blocked as a popup, then points it at the authed PDF blob once fetched.
async function viewCertificate(c: Certificate) {
  const win = window.open('', '_blank');
  try {
    const blob = await svc.certificates.blob(c.id);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else await svc.certificates.download(c.id, `${c.certificateNumber}.pdf`); // popup blocked → download
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    toast.error(apiError(e));
  }
}

interface Certificate {
  id: string;
  certificateNumber: string;
  topicId: string;
  topicTitle?: string;
  topicNumber?: string | null;
  issuedAt: string;
  certificateType: string;
  // Present only in the "Other Certificates" view.
  userFullName?: string | null;
  employeeId?: string | null;
}

function columns(opts?: { showEmployee?: boolean }): Column<Certificate>[] {
  const cols: Column<Certificate>[] = [];
  if (opts?.showEmployee) {
    cols.push({ key: 'employee', header: 'Employee', render: (r) => (r.userFullName ? `${r.userFullName}${r.employeeId ? ` (${r.employeeId})` : ''}` : '—') });
  }
  cols.push(
    { key: 'certificateNumber', header: 'Certificate No.' },
    // BUG-04: show "number – title".
    { key: 'topic', header: 'Topic', render: (r) => (r.topicNumber ? `${r.topicNumber} – ${r.topicTitle ?? r.topicId}` : r.topicTitle ?? r.topicId) },
    { key: 'issuedAt', header: 'Issued', render: (r) => formatDate(r.issuedAt) },
    { key: 'certificateType', header: 'Type' },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => viewCertificate(r)}>
            <Eye className="h-4 w-4" /> View
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadCertificate(r)}>
            <Download className="h-4 w-4" /> Download
          </Button>
        </div>
      ),
    },
  );
  return cols;
}

export default function CertificatesPage() {
  // R3: the "Other Certificates" view is gated on its own permission; the scope within it
  // (a supervisor sees their team, admin/coordinator see everyone) is enforced server-side.
  const canViewOthers = useAuthStore((s) => s.hasPermission)('certificates', 'view_others' as never);
  const [tab, setTab] = useState<'mine' | 'others'>('mine');

  const mine = useQuery({ queryKey: ['certificates', 'mine'], queryFn: () => svc.certificates.listMine() as unknown as Promise<Certificate[]> });
  const others = useQuery({
    queryKey: ['certificates', 'others'],
    queryFn: () => svc.certificates.listOthers() as unknown as Promise<Certificate[]>,
    enabled: canViewOthers && tab === 'others',
  });

  return (
    <div>
      <PageHeader title="Certificates" description="View and download your training and induction certificates." />

      {canViewOthers && (
        <div className="mb-4">
          <Tabs
            tabs={[
              { key: 'mine', label: 'My Certificates' },
              { key: 'others', label: 'Other Certificates' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as 'mine' | 'others')}
          />
        </div>
      )}

      {tab === 'mine' ? (
        <DataTable columns={columns()} rows={mine.data ?? []} loading={mine.isLoading} emptyText="You have no certificates yet." />
      ) : (
        <DataTable columns={columns({ showEmployee: true })} rows={others.data ?? []} loading={others.isLoading} emptyText="No certificates found." />
      )}
    </div>
  );
}
