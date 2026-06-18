import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ESignatureModal, type ESignaturePayload } from '@/components/common/ESignatureModal';
import { RichTextEditor } from '@/components/common/RichTextEditor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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

interface NotifSetting {
  type: string;
  module: string;
  moduleLabel: string;
  label: string;
  description: string;
  defaultSubject: string;
  variables: string[];
  enabled: boolean;
  subject: string | null;
  bodyHtml: string | null;
}

/**
 * Module 10: per-notification controls — enable/disable each templated email and
 * override its subject/body (with {{variables}}) per module. Catalog-driven.
 */
function NotificationSettingsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notif-settings'],
    queryFn: () => svc.systemConfig.listNotifications() as unknown as Promise<NotifSetting[]>,
  });
  const [editing, setEditing] = useState<NotifSetting | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const mut = useMutation({
    mutationFn: ({ type, payload }: { type: string; payload: unknown }) => svc.systemConfig.updateNotification(type, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notif-settings'] });
      toast.success('Notification settings updated.');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const groups = useMemo(() => {
    const map = new Map<string, NotifSetting[]>();
    for (const n of data ?? []) {
      if (!map.has(n.moduleLabel)) map.set(n.moduleLabel, []);
      map.get(n.moduleLabel)!.push(n);
    }
    return Array.from(map.entries());
  }, [data]);

  function openEdit(n: NotifSetting) {
    setEditing(n);
    setSubject(n.subject ?? '');
    setBody(n.bodyHtml ?? '');
  }

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        Control which emails the system sends and customise each template per module. Use placeholders like <code className="rounded bg-slate-100 px-1">{'{{userName}}'}</code> — they are filled in when the email is sent. Leaving subject/body blank uses the built-in default.
      </p>
      {groups.map(([moduleLabel, items]) => (
        <Card key={moduleLabel}>
          <CardHeader>
            <CardTitle>{moduleLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100">
              {items.map((n) => (
                <div key={n.type} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{n.label}</span>
                      {n.enabled ? <Badge tone="APPROVED">On</Badge> : <Badge tone="default">Off</Badge>}
                      {(n.subject || n.bodyHtml) && <Badge tone="WAIVED">Custom template</Badge>}
                    </div>
                    <div className="text-xs text-slate-500">{n.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canWrite && (
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={n.enabled}
                          onChange={(e) => mut.mutate({ type: n.type, payload: { enabled: e.target.checked } })}
                        />
                        Enabled
                      </label>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openEdit(n)}>
                      {canWrite ? 'Edit template' : 'View template'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        className="max-w-3xl"
        title={editing ? `Email Template — ${editing.label}` : 'Email Template'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Close</Button>
            {canWrite && editing && (
              <Button
                disabled={mut.isPending}
                onClick={() => mut.mutate({ type: editing.type, payload: { subject: subject.trim() || null, bodyHtml: body.trim() || null } }, { onSuccess: () => setEditing(null) })}
              >
                {mut.isPending ? 'Saving…' : 'Save Template'}
              </Button>
            )}
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-medium">Available variables:</span>{' '}
              {editing.variables.map((v) => (
                <code key={v} className="mr-1 rounded bg-white px-1 ring-1 ring-slate-200">{`{{${v}}}`}</code>
              ))}
            </div>
            <Field label="Subject" hint={`Default: ${editing.defaultSubject}`}>
              <Input value={subject} disabled={!canWrite} onChange={(e) => setSubject(e.target.value)} placeholder={editing.defaultSubject} />
            </Field>
            <Field label="Body" hint="Leave blank to use the built-in default body.">
              {canWrite ? (
                <RichTextEditor value={body} onChange={setBody} minHeightClass="min-h-[240px]" />
              ) : (
                <div className="rounded-md border border-slate-200 p-3 text-sm" dangerouslySetInnerHTML={{ __html: body || '<em class="text-slate-400">Default template</em>' }} />
              )}
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
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
  const [tab, setTab] = useState<'settings' | 'notifications'>('settings');

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
        description="Manage application-wide settings and notification emails. Changes are e-signed and audited."
        actions={
          canWrite && tab === 'settings' && (
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

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: 'settings', label: 'Settings' },
            { key: 'notifications', label: 'Notifications & Email Templates' },
          ]}
          value={tab}
          onChange={(k) => setTab(k as typeof tab)}
        />
      </div>

      {tab === 'notifications' ? (
        <NotificationSettingsTab canWrite={canWrite} />
      ) : (
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
      )}

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
