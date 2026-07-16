import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, AppError } from '../utils/response';
import { hasPermission } from '../utils/permissions';
import { toEndBound } from '../utils/dateUtils';
import { recordEvent } from '../services/auditTrail.service';
import { buildReport, exportReport, REPORT_TYPES, ReportType, ReportFilters } from '../services/report.service';

function parseFilters(src: Record<string, unknown>): ReportFilters {
  return {
    topicId: src.topicId ? String(src.topicId) : undefined,
    departmentId: src.departmentId ? String(src.departmentId) : undefined,
    roleId: src.roleId ? String(src.roleId) : undefined,
    userId: src.userId ? String(src.userId) : undefined,
    locationId: src.locationId ? String(src.locationId) : undefined,
    designationId: src.designationId ? String(src.designationId) : undefined,
    supervisorId: src.supervisorId ? String(src.supervisorId) : undefined,
    from: src.from ? new Date(String(src.from)) : undefined,
    to: src.to ? toEndBound(String(src.to)) : undefined,
    includeInactive: String(src.includeInactive ?? 'false') === 'true',
  };
}

function assertType(type: string): asserts type is ReportType {
  if (!(REPORT_TYPES as readonly string[]).includes(type)) throw AppError.notFound(`Unknown report type: ${type}`);
}

export const listTypes = asyncHandler(async (_req, res) => sendSuccess(res, REPORT_TYPES));

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.params;
  assertType(type);
  sendSuccess(res, await buildReport(type, parseFilters(req.query as Record<string, unknown>)));
});

export const exportReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.params;
  assertType(type);
  const isPrint = String(req.query.print ?? req.body?.print ?? 'false') === 'true';

  // Module 11: print requires reports.print; export requires reports.export.
  if (isPrint && !hasPermission(req.user!.permissions, 'reports', 'print')) {
    throw AppError.forbidden('You do not have print permission for reports.');
  }
  if (!isPrint && !hasPermission(req.user!.permissions, 'reports', 'export')) {
    throw AppError.forbidden('You do not have export permission for reports.');
  }

  const format = String(req.query.format ?? req.body?.format ?? 'pdf');
  const result = await exportReport(
    type,
    format,
    parseFilters({ ...(req.query as Record<string, unknown>), ...(req.body || {}) }),
    { fullName: req.user!.fullName, employeeId: req.user!.employeeId },
    isPrint,
  );

  await recordEvent({ action: isPrint ? 'PRINT' : 'EXPORT', entityType: 'Report', entityId: type, newValue: { format, rowCount: result.rowCount } });

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.body);
});
