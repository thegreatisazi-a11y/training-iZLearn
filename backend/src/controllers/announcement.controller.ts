import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/announcement.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listAnnouncements(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

/** Active announcements targeted at the current user (any authenticated user). */
export const feed = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.feedForUser(req.user!.roleIds));
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getAnnouncement(req.params.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const a = await svc.createAnnouncement(req.body, req.user!.id);
  sendCreated(res, a, 'Announcement published');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const a = await svc.updateAnnouncement(req.params.id, req.body);
  sendSuccess(res, a, 'Announcement updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const a = await svc.deactivateAnnouncement(req.params.id);
  sendSuccess(res, a, 'Announcement deactivated');
});
