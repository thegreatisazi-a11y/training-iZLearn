import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/department.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listDepartments(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getDepartment(req.params.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const dept = await svc.createDepartment(req.body, req.user!.id);
  sendCreated(res, dept, 'Department created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const dept = await svc.updateDepartment(req.params.id, req.body);
  sendSuccess(res, dept, 'Department updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const dept = await svc.deactivateDepartment(req.params.id);
  sendSuccess(res, dept, 'Department deactivated');
});
