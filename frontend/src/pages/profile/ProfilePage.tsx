import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { FileUpload } from '@/components/common/FileUpload';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { formatDate } from '@/lib/format';

interface Assignment {
  id: string;
  topicId: string;
  topicTitle?: string;
  topicNumber?: string;
  status: string;
  dueDate: string | null;
}
interface Certificate {
  id: string;
  certificateNumber: string;
  topicTitle?: string;
  topicNumber?: string | null;
  topicId: string;
  issuedAt: string;
  certificateType: string;
}
interface PersonalDoc {
  id: string;
  title: string;
  documentType: string;
  uploadedAt?: string;
  createdAt?: string;
}

function SignaturePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loginPassword, setLoginPassword] = useState('');
  const [oldSignaturePassword, setOldSignaturePassword] = useState('');
  const [signaturePassword, setSignaturePassword] = useState('');
  const [confirmSignaturePassword, setConfirm] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setLoginPassword('');
    setOldSignaturePassword('');
    setSignaturePassword('');
    setConfirm('');
    setError('');
  };

  // Client-side check so the user gets immediate, specific feedback before we
  // ever hit the network. The backend enforces the same rule (CR-19).
  const mismatch = confirmSignaturePassword.length > 0 && signaturePassword !== confirmSignaturePassword;

  const mutation = useMutation({
    mutationFn: () =>
      svc.auth.setSignaturePassword({
        loginPassword,
        oldSignaturePassword: oldSignaturePassword || undefined,
        signaturePassword,
        confirmSignaturePassword,
      }),
    onSuccess: () => {
      toast.success('Signature password set.');
      reset();
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  const submit = () => {
    if (signaturePassword !== confirmSignaturePassword) {
      setError('New signature and confirm password must match.');
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Set Signature Password"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={mutation.isPending || !loginPassword || !signaturePassword || !confirmSignaturePassword || mismatch}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">Your signature password is the second component of your electronic signature (21 CFR Part 11).</p>
      <Field label="Login password" required>
        <Input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="off" onPaste={(e) => e.preventDefault()} />
      </Field>
      <Field label="Old signature password" hint="Required only if you already have a signature password set.">
        <Input type="password" value={oldSignaturePassword} onChange={(e) => setOldSignaturePassword(e.target.value)} autoComplete="off" onPaste={(e) => e.preventDefault()} />
      </Field>
      <Field label="New signature password" required>
        <Input type="password" value={signaturePassword} onChange={(e) => setSignaturePassword(e.target.value)} autoComplete="off" onPaste={(e) => e.preventDefault()} />
      </Field>
      <Field
        label="Confirm new signature password"
        required
        error={mismatch ? 'New signature and confirm password must match.' : undefined}
      >
        <Input type="password" value={confirmSignaturePassword} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" onPaste={(e) => e.preventDefault()} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

export default function ProfilePage() {
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'training' | 'certificates' | 'documents'>('training');
  const [sigOpen, setSigOpen] = useState(false);

  // Use the enriched "my trainings" endpoint so topic name/number resolve (the raw
  // assignments list returns ids only — which showed "—" in the Topic column).
  const training = useQuery({
    queryKey: ['profile', 'training', me?.id],
    queryFn: () => svc.assignments.mine() as unknown as Promise<Assignment[]>,
    enabled: !!me?.id && tab === 'training',
  });
  const certificates = useQuery({
    queryKey: ['certificates', 'mine'],
    queryFn: () => svc.certificates.listMine() as unknown as Promise<Certificate[]>,
    enabled: tab === 'certificates',
  });
  const docs = useQuery({
    queryKey: ['personalDocs', 'mine'],
    queryFn: () => svc.personalDocs.mine() as unknown as Promise<PersonalDoc[]>,
    enabled: tab === 'documents',
  });

  // Document upload state.
  const [docFile, setDocFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('');
  const [docTitle, setDocTitle] = useState('');

  const uploadMutation = useMutation({
    mutationFn: () => svc.personalDocs.upload(docFile as File, documentType, docTitle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personalDocs', 'mine'] });
      toast.success('Document uploaded.');
      setDocFile(null);
      setDocumentType('');
      setDocTitle('');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const trainingColumns: Column<Assignment>[] = [
    {
      key: 'topic',
      header: 'Topic',
      // Link to the course topic; falls back to plain text if there's no topic id.
      render: (r) =>
        r.topicId ? (
          <button className="text-left font-medium text-primary hover:underline" onClick={() => navigate(`/topics/${r.topicId}`)}>
            {r.topicTitle || r.topicNumber || r.topicId}
          </button>
        ) : (
          r.topicTitle || r.topicNumber || '—'
        ),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status}>{r.status}</Badge> },
    { key: 'dueDate', header: 'Due Date', render: (r) => formatDate(r.dueDate) },
  ];
  const certColumns: Column<Certificate>[] = [
    { key: 'certificateNumber', header: 'Certificate No.' },
    { key: 'topic', header: 'Topic', render: (r) => (r.topicNumber ? `${r.topicNumber} – ${r.topicTitle ?? r.topicId}` : r.topicTitle || '—') },
    { key: 'certificateType', header: 'Type' },
    { key: 'issuedAt', header: 'Issued', render: (r) => formatDate(r.issuedAt) },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => svc.certificates.download(r.id, `${r.certificateNumber}.pdf`).catch((e) => toast.error(apiError(e)))}>
          <Download className="h-4 w-4" /> Download
        </Button>
      ),
    },
  ];
  const docColumns: Column<PersonalDoc>[] = [
    { key: 'title', header: 'Title' },
    { key: 'documentType', header: 'Type' },
    { key: 'uploadedAt', header: 'Uploaded', render: (r) => formatDate(r.uploadedAt ?? r.createdAt) },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => svc.personalDocs.download(r.id, r.title).catch((e) => toast.error(apiError(e)))}>
          <Download className="h-4 w-4" /> Download
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="My Profile"
        description={me ? `${me.fullName} · ${me.employeeId}` : undefined}
        actions={<Button variant="outline" onClick={() => setSigOpen(true)}>Set Signature Password</Button>}
      />

      <Card className="mb-6">
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
            <div>
              <dt className="text-slate-500">Username</dt>
              <dd className="text-slate-800">{me?.windowsUsername}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Employee ID</dt>
              <dd className="text-slate-800">{me?.employeeId}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Email</dt>
              <dd className="text-slate-800">{me?.email ?? '—'}</dd>
            </div>
            <div className="col-span-2 md:col-span-3">
              <dt className="text-slate-500">Roles</dt>
              <dd className="text-slate-800">{me?.roleNames?.join(', ')}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: 'training', label: 'My Training' },
            { key: 'certificates', label: 'My Certificates' },
            { key: 'documents', label: 'My Documents' },
          ]}
          value={tab}
          onChange={(k) => setTab(k as typeof tab)}
        />
      </div>

      {tab === 'training' && (
        <DataTable columns={trainingColumns} rows={(training.data ?? []) as unknown as Assignment[]} loading={training.isLoading} emptyText="No training assigned." />
      )}

      {tab === 'certificates' && (
        <DataTable columns={certColumns} rows={certificates.data ?? []} loading={certificates.isLoading} emptyText="You have no certificates yet." />
      )}

      {tab === 'documents' && (
        <div className="space-y-4">
          <Card>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Document type" required>
                  <Input value={documentType} onChange={(e) => setDocumentType(e.target.value)} placeholder="e.g. CV, Degree" />
                </Field>
                <Field label="Title" required>
                  <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                </Field>
                <div className="flex items-end">
                  <FileUpload onSelect={setDocFile} label={docFile ? docFile.name : 'Choose file'} />
                </div>
              </div>
              <Button onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending || !docFile || !documentType || !docTitle}>
                {uploadMutation.isPending ? 'Uploading…' : 'Upload Document'}
              </Button>
            </CardContent>
          </Card>
          <DataTable columns={docColumns} rows={docs.data ?? []} loading={docs.isLoading} emptyText="No documents uploaded." />
        </div>
      )}

      <SignaturePasswordDialog open={sigOpen} onClose={() => setSigOpen(false)} />
    </div>
  );
}
