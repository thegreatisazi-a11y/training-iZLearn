import { auditEntityLabel } from '@izlearn/shared';
import type { AuditTrail } from '@prisma/client';
import { formatDateTime } from '../utils/dateUtils';

type SearchRow = AuditTrail & { entityLabel: string | null };
export interface AuditSearchNames {
  user: Map<string, string>;
  department: Map<string, string>;
  location: Map<string, string>;
}

const IGNORED = new Set(['updatedAt', 'createdAt', 'passwordChangedAt', 'lastLoginAt', 'id']);
const REDACTED = new Set(['passwordHash', 'signaturePasswordHash', 'refreshToken', 'password', 'signaturePassword']);
const HOUSEKEEPING = ['lastLoginAt', 'failedLoginAttempts', 'lockedUntil', 'passwordChangedAt'];
const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full Name', email: 'Email', isActive: 'Active', isDeleted: 'Deleted',
  status: 'Status', roleName: 'Role Name', description: 'Description',
  permissions: 'Permissions', title: 'Title', topicNumber: 'Course Number',
  sopNumber: 'SOP Number', passingScorePercent: 'Passing Score (%)',
  maxAttempts: 'Max Attempts', durationMinutes: 'Duration (min)',
  assessmentTimeMinutes: 'Assessment Time (min)', requiresAssessment: 'Requires Assessment',
  dueDate: 'Due Date', refresherDueDate: 'Refresher Due', effectiveDate: 'Effective Date',
  reviewDate: 'Review Date', supervisorId: 'Reporting Manager',
  departmentId: 'Department', locationId: 'Location', userType: 'User Type',
};
const USER_FIELDS = new Set([
  'approvedBy', 'createdBy', 'updatedBy', 'assignedBy', 'decidedBy', 'changedBy', 'identifiedBy',
  'supervisorId', 'releasedBy', 'userId', 'createdUserId', 'evaluatorId', 'trainerId', 'markedBy', 'archivedBy',
]);
const EVENT_DETAILS: Record<string, string> = {
  CREATE: 'Record created', SOFT_DELETE: 'Record removed (soft-delete)',
  LOGIN: 'Signed in', LOGOUT: 'Signed out', LOGIN_FAILED: 'Sign-in failed',
  SESSION_LOCKED: 'Session locked (inactivity)', SESSION_TERMINATED: 'Session terminated',
  FILE_DOWNLOAD: 'File downloaded', FILE_UPLOAD: 'File uploaded', PRINT: 'Printed', EXPORT: 'Exported',
  ESIGN: 'Electronic signature applied', ACKNOWLEDGE: 'Acknowledged', ACCESS_DENIED: 'Access denied',
  RATE_LIMITED: 'Rate limited', BACKUP_TRIGGERED: 'Backup triggered',
  CERTIFICATE_GENERATED: 'Certificate generated', PERMISSION_CHANGE: 'Permissions changed',
  CONFIG_CHANGE: 'Configuration changed', AUTO_DEACTIVATED_AD_SYNC: 'Auto-deactivated (AD sync)',
  ASSESSMENT_SUBMITTED: 'Assessment submitted',
};

function detailValue(value: unknown, key: string, names: AuditSearchNames): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'string') {
    const resolved = USER_FIELDS.has(key) ? names.user.get(value)
      : key === 'departmentId' ? names.department.get(value)
        : key === 'locationId' ? names.location.get(value) : undefined;
    if (resolved) return resolved;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return formatDateTime(value);
    return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function detailField(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/ Id$/, '');
}

function changeDetails(row: SearchRow, names: AuditSearchNames): string {
  if (row.action === 'CREATE' || row.action === 'SOFT_DELETE') return EVENT_DETAILS[row.action];
  const oldValue = row.oldValue;
  const newValue = row.newValue;
  if (oldValue && newValue && typeof oldValue === 'object' && typeof newValue === 'object') {
    const before = oldValue as Record<string, unknown>;
    const after = newValue as Record<string, unknown>;
    const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => !IGNORED.has(key) && !REDACTED.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .slice(0, 8)
      .map((key) => `${detailField(key)}: ${detailValue(before[key], key, names)} → ${detailValue(after[key], key, names)}`);
    if (changes.length) return changes.join('; ');
    const housekeepingChanged = HOUSEKEEPING.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    return housekeepingChanged ? 'Sign-in / account activity (no data fields changed)' : 'No data fields changed';
  }
  if (newValue && typeof newValue === 'object' && !Array.isArray(newValue)) {
    const parts = Object.entries(newValue as Record<string, unknown>)
      .filter(([key]) => !IGNORED.has(key) && !REDACTED.has(key))
      .slice(0, 8)
      .map(([key, value]) => `${detailField(key)}: ${detailValue(value, key, names)}`);
    if (parts.length) return parts.join('; ');
  }
  return EVENT_DETAILS[row.action] ?? '—';
}

/** Match the text represented by every visible audit-table column before pagination. */
export function matchesAuditSearch(row: SearchRow, search: string, names: AuditSearchNames): boolean {
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return true;
  // Legacy records intentionally retain their immutable full-name display.
  const displayedUser = row.userUsername || row.userFullName;
  const fields = [
    displayedUser,
    row.action,
    row.entityType,
    auditEntityLabel(row.entityType),
    row.entityLabel,
    row.entityId,
    row.reasonForChange,
    row.ipAddress,
    changeDetails(row, names),
  ];
  return fields.some((field) => typeof field === 'string' && field.toLocaleLowerCase().includes(needle));
}
