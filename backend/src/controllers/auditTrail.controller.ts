import { Request, Response } from 'express';
import { asyncHandler, sendPaginated, AppError } from '../utils/response';
import { queryAuditTrail, recordEvent } from '../services/auditTrail.service';
import { signFromRequest } from '../services/eSignature.service';
import { exportToCsv } from '../utils/csvExporter';
import { exportToExcel } from '../utils/excelExporter';
import { renderPdfFromHtml } from '../utils/pdfGenerator';
import { buildHeaderTemplate, buildFooterTemplate, escapeHtml } from '../utils/reportHeader';
import { generateReportReference } from '../utils/certificateNumber';
import { getOrgInfo } from '../services/systemConfig.service';
import { formatDateTime } from '../utils/dateUtils';

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

const COLUMNS = [
  { header: 'Timestamp', key: 'timestamp' },
  { header: 'User', key: 'userFullName' },
  { header: 'Action', key: 'action' },
  { header: 'Entity Type', key: 'entityType' },
  { header: 'Entity ID', key: 'entityId' },
  { header: 'Changes (old → new)', key: 'changes' },
  { header: 'Reason For Change', key: 'reasonForChange' },
  { header: 'IP Address', key: 'ipAddress' },
];

const DIFF_IGNORE = new Set(['updatedAt', 'createdAt', 'passwordChangedAt', 'lastLoginAt', 'id']);

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/** CR-9: a human-readable old→new field diff for the export "Changes" column. */
function buildChangeSummary(action: string, oldVal: unknown, newVal: unknown): string {
  if (action === 'CREATE') return 'Record created';
  if (action === 'SOFT_DELETE') return 'Record removed (soft-delete)';
  if (oldVal && newVal && typeof oldVal === 'object' && typeof newVal === 'object') {
    const o = oldVal as Record<string, unknown>;
    const n = newVal as Record<string, unknown>;
    const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
    const changes: string[] = [];
    for (const k of keys) {
      if (DIFF_IGNORE.has(k)) continue;
      if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) changes.push(`${k}: ${fmtVal(o[k])} → ${fmtVal(n[k])}`);
    }
    return changes.slice(0, 12).join('; ');
  }
  return '';
}

/** Export the audit trail (PDF/CSV/XLS). Exporting is e-signed and itself audited. */
export const exportAudit = asyncHandler(async (req: Request, res: Response) => {
  const format = String(req.body.format || req.query.format || 'csv').toLowerCase();
  await signFromRequest(req, 'AuditTrail', 'export', 'Reviewed');

  const filters = parseFilters({ ...(req.query as Record<string, unknown>), ...(req.body || {}) });
  const r = await queryAuditTrail({ ...filters, page: 1, pageSize: 100000 });
  const org = await getOrgInfo();
  const rows = r.data.map((d) => ({
    timestamp: formatDateTime(d.timestamp, org.timezone),
    userFullName: d.userFullName,
    action: d.action,
    entityType: d.entityType,
    entityId: d.entityId ?? '',
    changes: buildChangeSummary(d.action, d.oldValue, d.newValue),
    reasonForChange: d.reasonForChange ?? '',
    ipAddress: d.ipAddress ?? '',
  }));

  await recordEvent({ action: 'EXPORT', entityType: 'AuditTrail', newValue: { format, count: rows.length } });

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-trail.csv"');
    return res.send(exportToCsv(COLUMNS, rows));
  }
  if (format === 'xls' || format === 'xlsx') {
    const buf = await exportToExcel(COLUMNS, rows, 'Audit Trail');
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
  const body = `<html><head><style>body{font-family:Arial;font-size:10px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ccc;padding:4px;text-align:left;}th{background:#f0f0f0;}</style></head><body>
    <table><thead><tr>${COLUMNS.map((c) => `<th>${c.header}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${COLUMNS.map((c) => `<td>${escapeHtml(String((row as Record<string, unknown>)[c.key] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  // CR-10: PDF generation depends on a headless Chrome (Puppeteer) which is not
  // available on every host (e.g. the free demo tier). Fail with a clear,
  // actionable message instead of an opaque 500 so the user can pick CSV/Excel.
  let pdf: Buffer;
  try {
    pdf = await renderPdfFromHtml(body, { headerHtml: buildHeaderTemplate(cfg), footerHtml: buildFooterTemplate(cfg) });
  } catch {
    throw new AppError(503, 'PDF_UNAVAILABLE', 'PDF export is unavailable on this server. Please export as Excel or CSV instead.');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-trail.pdf"');
  return res.send(pdf);
});
