import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/designation.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const includeInactive = req.query.includeInactive === 'true';
  const r = await svc.listDesignations({ ...q, includeInactive });
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const record = await svc.createDesignation(req.body, req.user!.id);
  sendCreated(res, record, 'Designation created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const record = await svc.updateDesignation(req.params.id, req.body);
  sendSuccess(res, record, 'Designation updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const record = await svc.deleteDesignation(req.params.id);
  sendSuccess(res, record, 'Designation deleted');
});
