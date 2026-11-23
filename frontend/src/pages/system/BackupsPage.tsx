import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Download, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Field } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { formatDateTime } from '@/lib/format';
import { svc } from '@/services';
import { tokenStore } from '@/lib/axios';

interface BackupItem {
  file: string;
  sizeBytes: number;
  createdAt: string;
  destination: 'local' | 'r2';
}
interface BackupInfo {
  items: BackupItem[];
  jobs: Array<{ id: string | number; status: string; failedReason: string | null; timestamp: number; finishedOn: number | null }>;
  fileStorage: 'local' | 'r2' | 'mongo';
  backupStorage: 'local' | 'r2';
}
interface BackupInspection {
  compatible: boolean;
  manifest: { createdAt: string; appVersion: string; storageDriver: string; filesCount: number };
}

function size(bytes: number) {
  if (!bytes) return '—';
  return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export default function BackupsPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission('backup', 'create');
  const canRestore = hasPermission('backup', 'approve');
  const [signAction, setSignAction] = useState<'backup' | 'restore' | null>(null);
  const [restoreFile, setRestoreFile] = useState<string | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['backups'], queryFn: () => svc.admin.backups() as Promise<BackupInfo>, refetchInterval: 30000,
  });
  const trigger = useMutation({
    mutationFn: (signature: ESignaturePayload) => svc.admin.triggerBackup(signature),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['backups'] }); toast.success('Backup queued. Status will update here.'); },
  });
  const verify = useMutation({
    mutationFn: (file: string) => svc.admin.verifyBackup(file),
    onSuccess: () => toast.success('Backup format, database, uploaded files and checksums verified.'),
    onError: (e) => toast.error(apiError(e)),
  });
  const restore = useMutation({
    mutationFn: ({ file, signature }: { file: string; signature: ESignaturePayload }) => svc.admin.restoreBackup(file, signature, confirmation),
    onSuccess: () => {
      toast.success('Website data restored. Sign in with an account from the restored backup.');
      tokenStore.clear();
      useAuthStore.getState().setUser(null);
      window.location.assign('/login');
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const upload = useMutation({
    mutationFn: (file: File) => svc.admin.uploadBackup(file, setUploadProgress),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['backups'] }); toast.success('Backup uploaded and verified. It is ready to select; no live data was changed.'); },
    onError: (e) => toast.error(apiError(e)),
  });
  const inspect = useMutation({
    mutationFn: (file: string) => svc.admin.inspectBackup(file) as Promise<BackupInspection>,
    onSuccess: (result) => { setInspection(result); setConfirmation(''); setRestoreConfirmOpen(true); },
    onError: (e) => { setRestoreFile(null); toast.error(apiError(e)); },
  });
  const working = upload.isPending || inspect.isPending || restore.isPending || trigger.isPending || verify.isPending;

  function selectUpload(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.tar.gz')) return toast.error('Select an izLearn .tar.gz backup bundle.');
    setUploadProgress(0);
    upload.mutate(file);
  }

  async function signed(signature: ESignaturePayload) {
    if (signAction === 'backup') await trigger.mutateAsync(signature);
    else if (signAction === 'restore' && restoreFile) await restore.mutateAsync({ file: restoreFile, signature });
    setSignAction(null);
    setRestoreFile(null);
  }

  async function download(file: string) {
    setDownloading(file);
    try { await svc.admin.downloadBackup(file); }
    catch (e) { toast.error(apiError(e)); }
    finally { setDownloading(null); }
  }

  return (
    <div>
      <PageHeader title="Backup & Restore" description="Manage complete recovery bundles for the database and uploaded files."
        actions={<div className="flex gap-2">
          {canRestore && <>
            <input ref={uploadInput} type="file" accept=".tar.gz" className="hidden" onChange={(e) => {
              selectUpload(e.target.files?.[0]); e.target.value = '';
            }} />
            <Button variant="outline" disabled={working} onClick={() => uploadInput.current?.click()}>
              <Upload className="h-4 w-4" /> {upload.isPending ? (uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : 'Validating backup…') : 'Upload backup'}
            </Button>
          </>}
          {canCreate && <Button disabled={working} onClick={() => setSignAction('backup')}>Create backup</Button>}
        </div>} />
      <Card>
        <CardContent>
          <div className="space-y-2 py-2 text-sm text-slate-700">
            <p><strong>Live file storage:</strong> {data?.fileStorage ?? '—'} · <strong>Backup destination:</strong> {data?.backupStorage ?? '—'}</p>
            <p>Each bundle contains a MongoDB archive, uploaded files (or MongoDB FileBlob records), checksums, and an app-version manifest. Deployment code and secrets are restored separately.</p>
            <p className="text-amber-700">A backup stored only on the same server is not disaster recovery. Copy it to separate storage and test a full restore regularly.</p>
            {canRestore && <p>Upload an izLearn .tar.gz bundle to validate and add it to this list. Uploading does not restore data. Restore temporarily blocks website access and background jobs, and signs everyone out afterwards.</p>}
          </div>
        </CardContent>
      </Card>

      {!!data?.jobs.length && (
        <Card>
          <CardContent>
            <div className="space-y-1 py-2 text-sm text-slate-700">
              <strong>Recent backup jobs</strong>
              {data.jobs.slice(0, 5).map((job) => (
                <div key={String(job.id)} className="flex flex-wrap gap-2 text-xs">
                  <span>{formatDateTime(new Date(job.timestamp).toISOString())}</span>
                  <span className={job.status === 'failed' ? 'text-red-700' : ''}>{job.status}</span>
                  {job.failedReason && <span className="text-red-700">{job.failedReason}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-5 space-y-3">
        {isLoading && <PageLoader />}
        {error && <p className="text-sm text-red-700">Could not load backups: {apiError(error)}</p>}
        {data?.items.length === 0 && <p className="text-sm text-slate-600">No complete backups yet.</p>}
        {data?.items.map((backup) => (
          <Card key={backup.file}>
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-4 py-2">
                <div className="flex min-w-0 items-start gap-3">
                  <Database className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="break-all font-medium text-slate-900">{backup.file}</div>
                    <div className="text-xs text-slate-500">{backup.createdAt ? formatDateTime(backup.createdAt) : '—'} · {size(backup.sizeBytes)} · {backup.destination.toUpperCase()}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={verify.isPending} onClick={() => verify.mutate(backup.file)}>
                    <ShieldCheck className="h-4 w-4" /> Verify
                  </Button>
                  {canRestore && <Button size="sm" variant="outline" disabled={downloading === backup.file} onClick={() => download(backup.file)}>
                    <Download className="h-4 w-4" /> Download
                  </Button>}
                  {canRestore && (
                    <Button size="sm" variant="outline" disabled={working} onClick={() => { setRestoreFile(backup.file); setInspection(null); inspect.mutate(backup.file); }}>
                      <RotateCcw className="h-4 w-4" /> {inspect.isPending && restoreFile === backup.file ? 'Checking…' : 'Restore'}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={restoreConfirmOpen} onClose={() => { setRestoreConfirmOpen(false); setRestoreFile(null); }} title="Restore complete website data"
        footer={<>
          <Button variant="outline" onClick={() => { setRestoreConfirmOpen(false); setRestoreFile(null); }}>Cancel</Button>
          <Button disabled={confirmation !== 'RESTORE' || !inspection?.compatible} onClick={() => { setRestoreConfirmOpen(false); setSignAction('restore'); }}>Continue to signature</Button>
        </>}>
        <p className="mb-4 text-sm text-red-700">This replaces the live database and uploaded files with the selected snapshot. The website will enter maintenance mode and create a current safety backup before replacement begins. Everyone must sign in again afterwards.</p>
        <p className="mb-3 break-all text-xs text-slate-600">{restoreFile}</p>
        {inspection && <div className="mb-4 space-y-1 text-sm">
          <p>Snapshot date: {formatDateTime(inspection.manifest.createdAt)}</p>
          <p>Application version: {inspection.manifest.appVersion}</p>
          <p>File storage: {inspection.manifest.storageDriver} · Files: {inspection.manifest.filesCount}</p>
          {!inspection.compatible && <p className="text-red-700">This backup uses an incompatible file-storage mode. An operator must configure the matching storage mode before restoring it.</p>}
          <p className="text-amber-700">Use a backup compatible with the deployed application version. Deployment code and secrets are not replaced.</p>
        </div>}
        <Field label="Type RESTORE to continue"><Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></Field>
      </Dialog>
      <ESignatureModal open={!!signAction} onClose={() => { setSignAction(null); setRestoreFile(null); }} onConfirm={signed}
        title={signAction === 'restore' ? 'Sign complete restore' : 'Sign manual backup'}
        defaultMeaning="Performed" hideMeaning />
      {restore.isPending && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 p-6 text-center text-white" role="status">
        Restoring website data… Keep this page open. Other requests and background jobs are paused until recovery finishes.
      </div>}
    </div>
  );
}
