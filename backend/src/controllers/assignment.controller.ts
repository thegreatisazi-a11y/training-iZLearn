import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/assignment.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = {
    ...paginationQuery.parse(req.query),
    userId: req.query.userId as string | undefined,
    topicId: req.query.topicId as string | undefined,
    status: req.query.status as string | undefined,
  };
  const r = await svc.listAssignments(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const mine = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.listMyTrainings(req.user!.id));
});

export const get = asyncHandler(async (req, res) => sendSuccess(res, await svc.getAssignment(req.params.id)));
export const create = asyncHandler(async (req, res) => sendCreated(res, await svc.createAssignment(req.body, req.user!.id), 'Assignment(s) created'));
export const update = asyncHandler(async (req, res) => sendSuccess(res, await svc.updateAssignment(req.params.id, req.body), 'Assignment updated'));
export const waive = asyncHandler(async (req, res) => sendSuccess(res, await svc.waiveAssignment(req.params.id, req), 'Assignment waived'));
