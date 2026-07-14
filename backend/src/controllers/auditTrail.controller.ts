import { Request, Response } from 'express';
import { asyncHandler, sendPaginated, AppError } from '../utils/response';
import { queryAuditTrail, recordEvent } from '../services/auditTrail.service';
import { exportToCsv } from '../utils/csvExporter';
import { exportToExcel } from '../utils/excelExporter';
import { renderPdfFromHtml } from '../utils/pdfGenerator';
import { buildHeaderTemplate, buildFooterTemplate, escapeHtml } from '../utils/reportHeader';
import { generateReportReference } from '../utils/certificateNumber';
import { getOrgInfo } from '../services/systemConfig.service';
import { formatDateTime } from '../utils/dateUtils';
import { prisma } from '../config/prisma';

function parseFilters(src: Record<string, unknown>) {
  return {
    from: src.from ? new Date(String(src.from)) : undefined,
    to: src.to ? new Date(String(src.to)) : undefined,
    userId: src.userId ? String(src.userId) : undefined,
    action: src.action ? String(src.action) : undefined,
    entityType: src.entityType ? String(src.entityType) : undefined,
    entityId: src.entityId ? String(src.entityId) : undefined,
    page: src.page ? parseInt(String(src.page), 10) : 1,
    pageSize: src.pageSize ? parseInt(String(src.pageSize), 10) : 50,
  };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const r = await queryAuditTrail(parseFilters(req.query as Record<string, unknown>));
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

// Item 6: the raw "Entity ID" column is removed from exports; the human-readable
// "Record" (entityLabel) replaces it, matching the on-screen table.
const COLUMNS = [
  { header: 'Timestamp', key: 'timestamp' },
  { header: 'User', key: 'userFullName' },
  { header: 'Action', key: 'action' },
  { header: 'Entity Type', key: 'entityType' },
  { header: 'Record', key: 'record' },
  { header: 'Changes (old → new)', key: 'changes' },
  { header: 'Reason For Change', key: 'reasonForChange' },
  { header: 'IP Address', key: 'ipAddress' },
];

const DIFF_IGNORE = new Set(['updatedAt', 'createdAt', 'passwordChangedAt', 'lastLoginAt', 'id']);
const DIFF_REDACT = new Set(['passwordHash', 'signaturePasswordHash', 'refreshToken', 'password', 'signaturePassword']);
const HOUSEKEEPING_FIELDS = ['lastLoginAt', 'failedLoginAttempts', 'lockedUntil', 'passwordChangedAt'];

// Kept in sync with frontend AuditTrailPage.tsx so the exported "Changes" column
// reads exactly like the on-screen one.
const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full Name', email: 'Email', isActive: 'Active', isDeleted: 'Deleted', status: 'Status',
  roleName: 'Role Name', description: 'Description', permissions: 'Permissions', title: 'Title',
  topicNumber: 'Topic Number', sopNumber: 'SOP Number', passingScorePercent: 'Passing Score (%)',
  maxAttempts: 'Max Attempts', durationMinutes: 'Duration (min)', assessmentTimeMinutes: 'Assessment Time (min)',
  requiresAssessment: 'Requires Assessment', dueDate: 'Due Date', refresherDueDate: 'Refresher Due',
  effectiveDate: 'Effective Date', reviewDate: 'Review Date', supervisorId: 'Reporting Manager',
  departmentId: 'Department', locationId: 'Location', userType: 'User Type',
};
const USER_ID_FIELDS = new Set([
  'approvedBy', 'createdBy', 'updatedBy', 'assignedBy', 'decidedBy', 'changedBy', 'identifiedBy',
  'supervisorId', 'releasedBy', 'userId', 'createdUserId', 'evaluatorId', 'trainerId', 'markedBy', 'archivedBy',
]);
const ACTION_DESCRIPTION: Record<string, string> = {
  LOGIN: 'Signed in', LOGOUT: 'Signed out', LOGIN_FAILED: 'Sign-in failed',
  SESSION_LOCKED: 'Session locked (inactivity)', SESSION_TERMINATED: 'Session terminated',
  FILE_DOWNLOAD: 'File downloaded', FILE_UPLOAD: 'File uploaded', PRINT: 'Printed', EXPORT: 'Exported',
  ESIGN: 'Electronic signature applied', ACKNOWLEDGE: 'Acknowledged', ACCESS_DENIED: 'Access denied',
  RATE_LIMITED: 'Rate limited', BACKUP_TRIGGERED: 'Backup triggered', CERTIFICATE_GENERATED: 'Certificate generated',
  PERMISSION_CHANGE: 'Permissions changed', CONFIG_CHANGE: 'Configuration changed',
  AUTO_DEACTIVATED_AD_SYNC: 'Auto-deactivated (AD sync)', ASSESSMENT_SUBMITTED: 'Assessment submitted',
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function fieldLabel(k: string): string {
  return FIELD_LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/\sId$/, '');
}

/** Name lookup maps so id-valued fields render as names, not raw UUIDs (item 5). */
export interface NameMaps {
  user: Map<string, string>;
  dept: Map<string, string>;
  loc: Map<string, string>;
  timezone?: string;
}

function fmtVal(v: unknown, key: string | undefined, maps: NameMaps): string {
  if (v === null || v === undefined) return '∅';
  if (key && typeof v === 'string') {
    if (USER_ID_FIELDS.has(key) && maps.user.get(v)) return maps.user.get(v)!;
    if (key === 'departmentId' && maps.dept.get(v)) return maps.dept.get(v)!;
    if (key === 'locationId' && maps.loc.get(v)) return maps.loc.get(v)!;
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && ISO_DATE.test(v)) return formatDateTime(v, maps.timezone);
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/** CR-9 / item 6: a human-readable change summary for the export "Changes" column,
 *  matching the on-screen table (before→after diff, event payload, or action label). */
function buildChangeSummary(action: string, oldVal: unknown, newVal: unknown, maps: NameMaps): string {
  if (action === 'CREATE') return 'Record created';
  if (action === 'SOFT_DELETE') return 'Record removed (soft-delete)';
  if (oldVal && newVal && typeof oldVal === 'object' && typeof newVal === 'object') {
    const o = oldVal as Record<string, unknown>;
    const n = newVal as Record<string, unknown>;
    const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
    const changes: string[] = [];
    for (const k of keys) {
      if (DIFF_IGNORE.has(k) || DIFF_REDACT.has(k)) continue;
      if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) changes.push(`${fieldLabel(k)}: ${fmtVal(o[k], k, maps)} → ${fmtVal(n[k], k, maps)}`);
    }
    if (changes.length) return changes.slice(0, 12).join('; ') + (changes.length > 12 ? ` (+${changes.length - 12} more)` : '');
    const housekeeping = HOUSEKEEPING_FIELDS.some((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]));
    return housekeeping ? 'Sign-in / account activity (no data fields changed)' : 'No data fields changed';
  }
  // Event payload (newValue only) — e.g. ESIGN, FILE_DOWNLOAD, CERTIFICATE_GENERATED.
  if (newVal && typeof newVal === 'object' && !Array.isArray(newVal)) {
    const parts = Object.entries(newVal as Record<string, unknown>)
      .filter(([k]) => !DIFF_IGNORE.has(k) && !DIFF_REDACT.has(k))
      .map(([k, v]) => `${fieldLabel(k)}: ${fmtVal(v, k, maps)}`);
    if (parts.length) return parts.slice(0, 12).join('; ');
  }
  return ACTION_DESCRIPTION[action] ?? '';
}

/** Load the id→name maps used to humanise change-detail values. */
async function loadNameMaps(timezone?: string): Promise<NameMaps> {
  const [users, depts, locs] = await Promise.all([
    prisma.user.findMany({ select: { id: true, fullName: true, employeeId: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.location.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    user: new Map(users.map((u) => [u.id, `${u.fullName} (${u.employeeId})`])),
    dept: new Map(depts.map((d) => [d.id, d.name])),
    loc: new Map(locs.map((l) => [l.id, l.name])),
    timezone,
  };
}

/** Export the audit trail (PDF/CSV/XLS). No e-signature required (item 6); the export
 *  itself is still recorded in the audit trail below. */
export const exportAudit = asyncHandler(async (req: Request, res: Response) => {
  const format = String(req.body.format || req.query.format || 'csv').toLowerCase();

  const filters = parseFilters({ ...(req.query as Record<string, unknown>), ...(req.body || {}) });
  const r = await queryAuditTrail({ ...filters, page: 1, pageSize: 100000 });
  const org = await getOrgInfo();
  const maps = await loadNameMaps(org.timezone);
  const rows = r.data.map((d) => ({
    timestamp: formatDateTime(d.timestamp, org.timezone),
    userFullName: d.userFullName,
    action: d.action,
    entityType: d.entityType,
    record: (d as { entityLabel?: string | null }).entityLabel ?? (d.entityId ?? ''),
    changes: buildChangeSummary(d.action, d.oldValue, d.newValue, maps),
    reasonForChange: d.reasonForChange ?? '',
    ipAddress: d.ipAddress ?? '',
  }));

  await recordEvent({ action: 'EXPORT', entityType: 'AuditTrail', newValue: { format, count: rows.length } });

  const generatedBy = req.user?.fullName;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-trail.csv"');
    return res.send(exportToCsv(COLUMNS, rows, { generatedBy }));
  }
  if (format === 'xls' || format === 'xlsx') {
    const buf = await exportToExcel(COLUMNS, rows, 'Audit Trail', undefined, { generatedBy });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-trail.xlsx"');
    return res.send(buf);
  }
  // PDF
  const ref = generateReportReference('AUD');
  const cfg = {
    orgName: org.name,
    orgLogoPath: /^(https?:|data:)/.test(org.logoPath) ? org.logoPath : undefined,
    reportTitle: 'Audit Trail Report',
    referenceNumber: ref,
    generatedByName: req.user!.fullName,
    generatedByEmployeeId: req.user!.employeeId,
    generatedAt: new Date(),
    timezone: org.timezone,
    printedByName: req.user!.fullName,
  };
  // Item 6: render landscape with a fixed table layout + explicit column widths and
  // word-wrapping so the table never overflows the page and the (often long) Changes
  // column is fully shown instead of being cut off.
  const COL_WIDTH: Record<string, string> = {
    timestamp: '11%', userFullName: '12%', action: '9%', entityType: '10%',
    record: '14%', changes: '30%', reasonForChange: '9%', ipAddress: '5%',
  };
  const body = `<html><head><style>
    body{font-family:Arial;font-size:8px;}
    table{width:100%;border-collapse:collapse;table-layout:fixed;}
    th,td{border:1px solid #ccc;padding:3px;text-align:left;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;white-space:normal;}
    th{background:#f0f0f0;}
    colgroup col{}
  </style></head><body>
    <table>
    <colgroup>${COLUMNS.map((c) => `<col style="width:${COL_WIDTH[c.key] ?? 'auto'}" />`).join('')}</colgroup>
    <thead><tr>${COLUMNS.map((c) => `<th>${c.header}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${COLUMNS.map((c) => `<td>${escapeHtml(String((row as Record<string, unknown>)[c.key] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  // CR-10: PDF generation depends on a headless Chrome (Puppeteer) which is not
  // available on every host (e.g. the free demo tier). Fail with a clear,
  // actionable message instead of an opaque 500 so the user can pick CSV/Excel.
  let pdf: Buffer;
  try {
    pdf = await renderPdfFromHtml(body, { headerHtml: buildHeaderTemplate(cfg), footerHtml: buildFooterTemplate(cfg), landscape: true });
  } catch {
    throw new AppError(503, 'PDF_UNAVAILABLE', 'PDF export is unavailable on this server. Please export as Excel or CSV instead.');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-trail.pdf"');
  return res.send(pdf);
});
