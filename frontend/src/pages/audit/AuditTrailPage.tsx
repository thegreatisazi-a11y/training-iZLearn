import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ESignatureModal } from '@/components/common/ESignatureModal';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { svc, downloadBlob } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';
import { formatDateTime } from '@/lib/format';

interface AuditEntry {
  id: string;
  timestamp: string;
  userFullName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reasonForChange: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

// Internal/noisy fields excluded from the human-readable diff.
const DIFF_IGNORE = new Set(['updatedAt', 'createdAt', 'passwordChangedAt', 'lastLoginAt', 'id']);
const DIFF_REDACT = new Set(['passwordHash', 'signaturePasswordHash', 'refreshToken', 'password', 'signaturePassword']);

// CR-8: friendly labels for the common audited fields; anything not listed is
// de-camelCased automatically.
const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full Name',
  email: 'Email',
  isActive: 'Active',
  isDeleted: 'Deleted',
  status: 'Status',
  roleName: 'Role Name',
  description: 'Description',
  permissions: 'Permissions',
  title: 'Title',
  topicNumber: 'Topic Number',
  sopNumber: 'SOP Number',
  passingScorePercent: 'Passing Score (%)',
  maxAttempts: 'Max Attempts',
  durationMinutes: 'Duration (min)',
  assessmentTimeMinutes: 'Assessment Time (min)',
  requiresAssessment: 'Requires Assessment',
  dueDate: 'Due Date',
  refresherDueDate: 'Refresher Due',
  effectiveDate: 'Effective Date',
  reviewDate: 'Review Date',
  supervisorId: 'Reporting Manager',
  departmentId: 'Department',
  locationId: 'Location',
  userType: 'User Type',
};

function fieldLabel(k: string): string {
  return FIELD_LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/\sId$/, '');
}

// Fields whose values are user IDs — resolved to the user's name in change details.
const USER_ID_FIELDS = new Set([
  'approvedBy', 'createdBy', 'updatedBy', 'assignedBy', 'decidedBy', 'changedBy', 'identifiedBy',
  'supervisorId', 'releasedBy', 'userId', 'createdUserId', 'evaluatorId', 'trainerId', 'markedBy', 'archivedBy',
]);

// Friendly description for event-style actions that carry no before/after field diff,
// so every audit row shows a meaningful detail (never a bare "—").
const ACTION_DESCRIPTION: Record<string, string> = {
  LOGIN: 'Signed in',
  LOGOUT: 'Signed out',
  LOGIN_FAILED: 'Sign-in failed',
  SESSION_LOCKED: 'Session locked (inactivity)',
  SESSION_TERMINATED: 'Session terminated',
  FILE_DOWNLOAD: 'File downloaded',
  FILE_UPLOAD: 'File uploaded',
  PRINT: 'Printed',
  EXPORT: 'Exported',
  ESIGN: 'Electronic signature applied',
  ACKNOWLEDGE: 'Acknowledged',
  ACCESS_DENIED: 'Access denied',
  RATE_LIMITED: 'Rate limited',
  BACKUP_TRIGGERED: 'Backup triggered',
  CERTIFICATE_GENERATED: 'Certificate generated',
  PERMISSION_CHANGE: 'Permissions changed',
  CONFIG_CHANGE: 'Configuration changed',
  AUTO_DEACTIVATED_AD_SYNC: 'Auto-deactivated (AD sync)',
  ASSESSMENT_SUBMITTED: 'Assessment submitted',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

type ResolveUser = (id: string) => string | undefined;

function fmtVal(v: unknown, key?: string, resolveUser?: ResolveUser): string {
  if (v === null || v === undefined) return '∅';
  // Resolve user-id fields to the person's name instead of showing the raw UUID.
  if (key && USER_ID_FIELDS.has(key) && typeof v === 'string' && resolveUser) {
    const name = resolveUser(v);
    if (name) return name;
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && ISO_DATE.test(v)) return formatDateTime(v);
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  }
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/**
 * Human-readable change details for an audit row:
 *  - before→after field diff when both snapshots exist,
 *  - otherwise the event payload (newValue) — so ESIGN / FILE_DOWNLOAD / EXPORT etc. show context,
 *  - otherwise a friendly action description so no row is left blank.
 * User-id fields are resolved to names.
 */
function changeSummary(entry: AuditEntry, resolveUser?: ResolveUser): string {
  const { action, oldValue, newValue } = entry;
  if (action === 'CREATE') return 'Record created';
  if (action === 'SOFT_DELETE') return 'Record removed (soft-delete)';
  if (oldValue && newValue && typeof oldValue === 'object' && typeof newValue === 'object') {
    const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
    const changes: string[] = [];
    for (const k of keys) {
      if (DIFF_IGNORE.has(k)) continue;
      if (DIFF_REDACT.has(k)) continue;
      const ov = (oldValue as Record<string, unknown>)[k];
      const nv = (newValue as Record<string, unknown>)[k];
      if (JSON.stringify(ov) !== JSON.stringify(nv)) changes.push(`${fieldLabel(k)}: ${fmtVal(ov, k, resolveUser)} → ${fmtVal(nv, k, resolveUser)}`);
    }
    if (changes.length) return changes.slice(0, 8).join('; ') + (changes.length > 8 ? ` (+${changes.length - 8} more)` : '');
  }
  // Event payload (newValue only) — e.g. ESIGN { meaning }, FILE_DOWNLOAD { originalFileName }.
  if (newValue && typeof newValue === 'object' && !Array.isArray(newValue)) {
    const parts = Object.entries(newValue as Record<string, unknown>)
      .filter(([k]) => !DIFF_IGNORE.has(k) && !DIFF_REDACT.has(k))
      .map(([k, v]) => `${fieldLabel(k)}: ${fmtVal(v, k, resolveUser)}`);
    if (parts.length) return parts.slice(0, 8).join('; ');
  }
  return ACTION_DESCRIPTION[action] ?? '—';
}

const ACTIONS = [
  'CREATE', 'UPDATE', 'SOFT_DELETE', 'APPROVE', 'REJECT', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED',
  'SESSION_TERMINATED', 'SESSION_LOCKED', 'EXPORT', 'PRINT', 'ESIGN', 'CONFIG_CHANGE',
  'PERMISSION_CHANGE', 'FILE_UPLOAD', 'FILE_DOWNLOAD', 'BACKUP_TRIGGERED', 'AUTO_DEACTIVATED_AD_SYNC',
  'ASSESSMENT_SUBMITTED', 'CERTIFICATE_GENERATED', 'ACCESS_DENIED', 'RATE_LIMITED',
].map((a) => ({ value: a, label: a }));

export default function AuditTrailPage() {
  const canExport = useAuthStore((s) => s.hasPermission)('auditTrail', 'export');
  const [page, setPage] = useState(1);
  const [signOpen, setSignOpen] = useState(false);

  // Resolve user IDs in change details to names (e.g. "Approved By: … → System Administrator").
  const usersForNames = useQuery({ queryKey: ['users', 'audit-names'], queryFn: () => svc.users.list({ pageSize: 1000, includeInactive: true }) });
  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of (usersForNames.data?.data ?? []) as { id: string; fullName: string }[]) m.set(u.id, u.fullName);
    return m;
  }, [usersForNames.data]);
  const resolveUser = (id: string) => userNameById.get(id);
  // CR-10: let the user pick the export format. Excel/CSV are generated server-side
  // with no browser dependency; PDF needs headless Chrome and may be unavailable.
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'pdf'>('xlsx');

  // Applied filters (drive the query); the form mutates draft state then commits via Search.
  const [filters, setFilters] = useState({ from: '', to: '', userId: '', action: '', entityType: '', entityId: '' });
  const [draft, setDraft] = useState(filters);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, filters],
    queryFn: () =>
      svc.audit.list({
        page,
        pageSize: 50,
        from: filters.from || undefined,
        to: filters.to || undefined,
        userId: filters.userId || undefined,
        action: filters.action || undefined,
        entityType: filters.entityType || undefined,
        entityId: filters.entityId || undefined,
      }),
  });

  const exportMutation = useMutation({
    mutationFn: async (sig: { windowsUsername: string; signaturePassword: string; meaning: string }) => {
      const res = await svc.audit.export(format, {
        from: filters.from || undefined,
        to: filters.to || undefined,
        userId: filters.userId || undefined,
        action: filters.action || undefined,
        entityType: filters.entityType || undefined,
        entityId: filters.entityId || undefined,
        signature: sig,
      });
      return res.data as Blob;
    },
    onSuccess: (blob) => {
      downloadBlob(blob, `audit-trail.${format}`);
      toast.success('Audit trail exported.');
    },
    onError: async (e) => {
      // A blob responseType means error bodies arrive as a Blob — read the JSON message out.
      const blob = (e as { response?: { data?: unknown } })?.response?.data;
      if (blob instanceof Blob) {
        try {
          const parsed = JSON.parse(await blob.text());
          toast.error(parsed?.error?.message || 'Export failed.');
          return;
        } catch {
          /* fall through */
        }
      }
      toast.error(apiError(e));
    },
  });

  function applyFilters() {
    setPage(1);
    setFilters(draft);
  }

  const columns: Column<AuditEntry>[] = [
    { key: 'timestamp', header: 'Timestamp', render: (r) => formatDateTime(r.timestamp) },
    { key: 'userFullName', header: 'User' },
    { key: 'action', header: 'Action', render: (r) => <Badge tone={r.action}>{r.action}</Badge> },
    { key: 'entityType', header: 'Entity' },
    {
      key: 'changeDetails',
      header: 'Change Details',
      render: (r) => <span className="block max-w-md whitespace-pre-wrap break-words text-xs text-slate-600">{changeSummary(r, resolveUser)}</span>,
    },
    { key: 'reasonForChange', header: 'Reason', render: (r) => r.reasonForChange ?? '—' },
  ];

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        description="Immutable record of all system actions (21 CFR Part 11)."
        actions={
          canExport && (
            <div className="flex items-center gap-2">
              <Select
                className="w-32"
                value={format}
                onChange={(e) => setFormat(e.target.value as 'xlsx' | 'csv' | 'pdf')}
                options={[
                  { value: 'xlsx', label: 'Excel (.xlsx)' },
                  { value: 'csv', label: 'CSV' },
                  { value: 'pdf', label: 'PDF' },
                ]}
              />
              <Button variant="outline" onClick={() => setSignOpen(true)}>
                <Download className="h-4 w-4" /> Export
              </Button>
            </div>
          )
        }
      />

      <Card className="mb-6">
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="From">
              <Input type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
            </Field>
            <Field label="To">
              <Input type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
            </Field>
            <Field label="Action">
              <Select options={ACTIONS} value={draft.action} onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))} placeholder="Any action" />
            </Field>
            <Field label="User ID">
              <Input value={draft.userId} onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))} placeholder="Optional" />
            </Field>
            <Field label="Entity type">
              <Input value={draft.entityType} onChange={(e) => setDraft((d) => ({ ...d, entityType: e.target.value }))} placeholder="Optional" />
            </Field>
            <Field label="Entity ID">
              <Input value={draft.entityId} onChange={(e) => setDraft((d) => ({ ...d, entityId: e.target.value }))} placeholder="Optional" />
            </Field>
          </div>
          <Button onClick={applyFilters}>Search</Button>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={(data?.data ?? []) as unknown as AuditEntry[]}
        loading={isLoading}
        page={page}
        pageSize={50}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyText="No audit records match the filters."
      />

      <ESignatureModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title="Sign to Export Audit Trail"
        defaultMeaning="Reviewed"
        onConfirm={async (sig) => {
          await exportMutation.mutateAsync(sig);
        }}
      />
    </div>
  );
}
