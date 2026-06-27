import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
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

interface Certificate {
  id: string;
  certificateNumber: string;
  topicId: string;
  topicTitle?: string;
  topicNumber?: string | null;
  issuedAt: string;
  certificateType: string;
}

function columns(): Column<Certificate>[] {
  return [
    { key: 'certificateNumber', header: 'Certificate No.' },
    // BUG-04: show "number – title".
    { key: 'topic', header: 'Topic', render: (r) => (r.topicNumber ? `${r.topicNumber} – ${r.topicTitle ?? r.topicId}` : r.topicTitle ?? r.topicId) },
    { key: 'issuedAt', header: 'Issued', render: (r) => formatDate(r.issuedAt) },
    { key: 'certificateType', header: 'Type' },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => downloadCertificate(r)}>
          <Download className="h-4 w-4" /> Download
        </Button>
      ),
    },
  ];
}

export default function CertificatesPage() {
  const canViewAll = useAuthStore((s) => s.hasPermission)('certificates', 'read');
  const [tab, setTab] = useState<'mine' | 'all'>('mine');

  const mine = useQuery({ queryKey: ['certificates', 'mine'], queryFn: () => svc.certificates.listMine() as unknown as Promise<Certificate[]> });
  const all = useQuery({
    queryKey: ['certificates', 'all'],
    queryFn: () => svc.certificates.list({ pageSize: 200 }) as unknown as Promise<Certificate[]>,
    enabled: canViewAll && tab === 'all',
  });

  return (
    <div>
      <PageHeader title="Certificates" description="Download your training and induction certificates." />

      {canViewAll && (
        <div className="mb-4">
          <Tabs
            tabs={[
              { key: 'mine', label: 'My Certificates' },
              { key: 'all', label: 'All Certificates' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as 'mine' | 'all')}
          />
        </div>
      )}

      {tab === 'mine' ? (
        <DataTable columns={columns()} rows={mine.data ?? []} loading={mine.isLoading} emptyText="You have no certificates yet." />
      ) : (
        <DataTable columns={columns()} rows={all.data ?? []} loading={all.isLoading} emptyText="No certificates found." />
      )}
    </div>
  );
}
