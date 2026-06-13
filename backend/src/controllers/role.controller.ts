import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/role.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listRoles(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getRole(req.params.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const role = await svc.createRole(req.body, req);
  sendCreated(res, role, 'Role created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const role = await svc.updateRole(req.params.id, req.body, req);
  sendSuccess(res, role, 'Role updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const role = await svc.deactivateRole(req.params.id, req);
  sendSuccess(res, role, 'Role deactivated');
});
