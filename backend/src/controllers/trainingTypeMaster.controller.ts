import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/trainingTypeMaster.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const includeInactive = req.query.includeInactive === 'true';
  const r = await svc.listTrainingTypes({ ...q, includeInactive });
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const record = await svc.createTrainingType(req.body, req.user!.id);
  sendCreated(res, record, 'Training type created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const record = await svc.updateTrainingType(req.params.id, req.body, req.user!.id);
  sendSuccess(res, record, 'Training type updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const record = await svc.deleteTrainingType(req.params.id);
  sendSuccess(res, record, 'Training type deleted');
});
