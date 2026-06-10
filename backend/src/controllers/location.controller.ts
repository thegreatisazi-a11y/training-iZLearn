import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/location.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listLocations(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getLocation(req.params.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const loc = await svc.createLocation(req.body, req.user!.id);
  sendCreated(res, loc, 'Location created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const loc = await svc.updateLocation(req.params.id, req.body);
  sendSuccess(res, loc, 'Location updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const loc = await svc.deactivateLocation(req.params.id);
  sendSuccess(res, loc, 'Location deactivated');
});
