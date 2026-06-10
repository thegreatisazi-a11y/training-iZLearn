import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated, AppError } from '../utils/response';
import { paginationQuery, userRequestDecisionSchema } from '@izlearn/shared';
import * as svc from '../services/user.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  // UR-85: users with userManagement:approve can view all locations;
  // those with only userManagement:read see only their own location.
  const canViewAll = req.user!.permissions['userManagement']?.approve === true;
  const locationFilter = canViewAll ? undefined : req.user!.locationId;
  const r = await svc.listUsers(q, locationFilter);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
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

export const update = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.updateUser(req.params.id, req.body, req.user!.id), 'User updated');
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

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.resetPassword(req.params.id, req), 'Password reset; user must set a new password at next login');
});

export const bulkPreview = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw AppError.badRequest('An Excel file is required.');
  sendSuccess(res, await svc.bulkPreview(req.file.buffer));
});

export const bulkCommit = asyncHandler(async (req: Request, res: Response) => {
  const rows = (req.body?.rows ?? []) as Parameters<typeof svc.bulkCommit>[0];
  if (!Array.isArray(rows) || rows.length === 0) throw AppError.badRequest('No rows to commit.');
  sendSuccess(res, await svc.bulkCommit(rows, req.user!.id), 'Bulk user requests created');
});
