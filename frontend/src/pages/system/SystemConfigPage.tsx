import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { svc } from '@/services';

interface ConfigItem {
  key: string;
  value: string;
  description?: string;
}

const GROUP_LABELS: Record<string, string> = {
  password: 'Password Policy',
  session: 'Session',
  auth: 'Authentication',
  reminder: 'Reminders',
  org: 'Organisation',
  system: 'System',
  ldap: 'LDAP / Active Directory',
  smtp: 'Email (SMTP)',
  backup: 'Backup',
  upload: 'Uploads',
  security: 'Security',
  assessment: 'Assessments',
};

function groupOf(key: string) {
  const prefix = key.split('.')[0];
  return GROUP_LABELS[prefix] ?? prefix;
}

export default function SystemConfigPage() {
  const qc = useQueryClient();
  const canWrite = useAuthStore((s) => s.hasPermission)('systemConfig', 'write');

  const { data, isLoading } = useQuery({ queryKey: ['system-config'], queryFn: () => svc.systemConfig.list() as unknown as Promise<ConfigItem[]> });

  const [values, setValues] = useState<Record<string, string>>({});
  const [reasonOpen, setReasonOpen] = useState(false);
  const [esignOpen, setEsignOpen] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (data) {
      setValues(Object.fromEntries(data.map((c) => [c.key, c.value])));
    }
  }, [data]);

  const groups = useMemo(() => {
    const map = new Map<string, ConfigItem[]>();
    for (const item of data ?? []) {
      const g = groupOf(item.key);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(item);
    }
    return Array.from(map.entries());
  }, [data]);

  const dirtyItems = useMemo(
    () => (data ?? []).filter((c) => values[c.key] !== c.value).map((c) => ({ key: c.key, value: values[c.key] })),
    [data, values],
  );

  const saveMutation = useMutation({
    mutationFn: (body: unknown) => svc.systemConfig.update(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system-config'] });
      toast.success('Configuration saved.');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  async function confirmSave(signature: ESignaturePayload) {
    await saveMutation.mutateAsync({ items: dirtyItems, reasonForChange: reason.trim(), signature });
  }

  if (isLoading || !data) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="System Configuration"
        description="Manage application-wide settings. Changes are e-signed and audited."
        actions={
          canWrite && (
            <Button
              disabled={dirtyItems.length === 0}
              onClick={() => {
                setReason('');
                setReasonOpen(true);
              }}
            >
              <Save className="h-4 w-4" /> Save All{dirtyItems.length ? ` (${dirtyItems.length})` : ''}
            </Button>
          )
        }
      />

      <div className="grid gap-5 md:grid-cols-2">
        {groups.map(([group, items]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{group}</CardTitle>
            </CardHeader>
            <CardContent>
              {items.map((item) => (
                <Field key={item.key} label={item.key}>
                  <Input
                    value={values[item.key] ?? ''}
                    disabled={!canWrite}
                    onChange={(e) => setValues((v) => ({ ...v, [item.key]: e.target.value }))}
                  />
                  {item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}
                </Field>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={reasonOpen}
        onClose={() => setReasonOpen(false)}
        title="Save Configuration"
        footer={
          <>
            <Button variant="outline" onClick={() => setReasonOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length < 5}
              onClick={() => {
                setReasonOpen(false);
                setEsignOpen(true);
              }}
            >
              Continue to Sign
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">{dirtyItems.length} setting(s) will be updated.</p>
        <Field label="Reason for change (required)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why these settings are being changed…" />
        </Field>
      </Dialog>

      <ESignatureModal
        open={esignOpen}
        onClose={() => setEsignOpen(false)}
        onConfirm={confirmSave}
        title="Sign to Save Configuration"
        defaultMeaning="Approved"
      />
    </div>
  );
}
