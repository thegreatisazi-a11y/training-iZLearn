import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated, AppError } from '../utils/response';
import { paginationQuery, userRequestDecisionSchema } from '@izlearn/shared';
import { exportToCsv } from '../utils/csvExporter';
import { exportToExcel } from '../utils/excelExporter';
import { recordEvent } from '../services/auditTrail.service';
import * as svc from '../services/user.service';

/**
 * Users-list scope: full admins (userManagement:approve) see everyone org-wide; every
 * other user sees only their OWN department, excluding themselves.
 */
function userScope(req: Request): svc.UserListScope {
  // S4: anyone who can VIEW the Users module (userManagement:read — the route gate) sees
  // ALL users, same as an admin. A Supervisor with only 'view' is therefore view-only
  // (the action buttons are gated on write/approve). A Department filter narrows the list.
  const canViewAll = req.user!.permissions['userManagement']?.read === true;
  const departmentId = typeof req.query.departmentId === 'string' && req.query.departmentId ? req.query.departmentId : undefined;
  return canViewAll
    ? { all: true, departmentId }
    : { departmentId: departmentId ?? req.user!.departmentId, excludeUserId: req.user!.id };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listUsers(q, userScope(req));
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

const EXPORT_COLUMNS = [
  { header: 'Employee ID', key: 'employeeId' },
  { header: 'Full Name', key: 'fullName' },
  { header: 'Username', key: 'username' },
  { header: 'Email', key: 'email' },
  { header: 'Department', key: 'department' },
  { header: 'Location', key: 'location' },
  { header: 'Roles', key: 'roles' },
  { header: 'Status', key: 'status' },
];

/** CR-12: export the (filtered, all-rows) users list as Excel or CSV. */
export const exportUsers = asyncHandler(async (req: Request, res: Response) => {
  const format = String(req.query.format || 'xlsx').toLowerCase();
  const q = paginationQuery.parse(req.query);
  const users = await svc.listUsersForExport(q, userScope(req));
  const rows = users.map((u) => ({
    employeeId: u.employeeId,
    fullName: u.fullName,
    username: u.windowsUsername,
    email: u.email ?? '',
    department: u.departmentName ?? '',
    location: u.locationName ?? '',
    roles: u.roleNames.join(', '),
    status: u.isActive ? 'Active' : 'Inactive',
  }));

  await recordEvent({ action: 'EXPORT', entityType: 'User', entityId: 'list', newValue: { format, count: rows.length } });

  const generatedBy = req.user?.fullName;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    return res.send(exportToCsv(EXPORT_COLUMNS, rows, { generatedBy }));
  }
  const buf = await exportToExcel(EXPORT_COLUMNS, rows, 'Users', undefined, { generatedBy });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="users.xlsx"');
  return res.send(buf);
});

export const listRequests = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listRequests(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const getRequest = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getRequest(req.params.id));
});

export const createRequest = asyncHandler(async (req: Request, res: Response) => {
  const r = await svc.createUserRequest(req.body, req.user!.id);
  sendCreated(res, r, 'User-creation request submitted for approval');
});

export const decideRequest = asyncHandler(async (req: Request, res: Response) => {
  const input = userRequestDecisionSchema.parse(req.body);
  const r = await svc.decideRequest(req.params.id, input, req);
  sendSuccess(res, r, `Request ${input.decision === 'APPROVE' ? 'approved' : 'rejected'}`);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getUser(req.params.id));
});

// Item F: the logged-in user's own full profile (self-scoped — no management permission).
export const myProfile = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getMyProfile(req.user!.id));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.updateUser(req.params.id, req.body, req), 'User updated');
});

export const changeRoles = asyncHandler(async (req: Request, res: Response) => {
  const r = await svc.changeRoles(req.params.id, req.body.roleIds, req);
  sendSuccess(res, r, 'Roles updated');
});

export const activate = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.activateUser(req.params.id, req), 'User activated');
});

export const deactivate = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.deactivateUser(req.params.id, req), 'User deactivated');
});

// S5: edit / deactivate a team member from My Team (hierarchy-scoped in the service).
export const updateTeamMember = asyncHandler(async (req: Request, res: Response) => {
  await svc.assertTeamManageAccess({ id: req.user!.id, permissions: req.user!.permissions as Record<string, Record<string, boolean>> }, req.params.id);
  sendSuccess(res, await svc.updateUser(req.params.id, req.body, req), 'Team member updated');
});
export const deactivateTeamMember = asyncHandler(async (req: Request, res: Response) => {
  await svc.assertTeamManageAccess({ id: req.user!.id, permissions: req.user!.permissions as Record<string, Record<string, boolean>> }, req.params.id);
  sendSuccess(res, await svc.deactivateUser(req.params.id, req), 'Team member deactivated');
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.resetPassword(req.params.id, req), 'Password reset; user must set a new password at next login');
});

// Team overview: a SUPER_ADMIN sees the whole organisation; every other user sees ONLY
// their own IMMEDIATE direct reports (no indirect subordinates).
export const team = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const seeAll = req.user!.roleNames.includes('SUPER_ADMIN');
  const r = await svc.listMyTeam(req.user!.id, seeAll, q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

// Training history for one team member (scoped to the caller's reports / admin).
export const teamHistory = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getTeamMemberHistory(req, req.params.userId));
});

// CR-15/16: user lifecycle aggregate + release-stage transition.
export const lifecycle = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getUserLifecycle(req.params.id));
});

export const setReleaseStage = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.setReleaseStage(req.params.id, req.body.stage, req), 'Release stage updated');
});

export const bulkPreview = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw AppError.badRequest('An Excel file is required.');
  sendSuccess(res, await svc.bulkPreview(req.file.buffer));
});

export const bulkCommit = asyncHandler(async (req: Request, res: Response) => {
  const rows = (req.body?.rows ?? []) as Parameters<typeof svc.bulkCommit>[0];
  if (!Array.isArray(rows) || rows.length === 0) throw AppError.badRequest('No rows to commit.');
  sendSuccess(res, await svc.bulkCommit(rows, req.user!.id, req.user!.permissions as Parameters<typeof svc.bulkCommit>[2]), 'Bulk user requests created');
});
