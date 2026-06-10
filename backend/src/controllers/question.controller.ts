import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/question.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listQuestions({
    ...q,
    topicId: typeof req.query.topicId === 'string' ? req.query.topicId : undefined,
  });
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getQuestion(req.params.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const question = await svc.createQuestion(req.body, req.user!.id);
  sendCreated(res, question, 'Question created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.updateQuestion(req.params.id, req.body), 'Question updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.deactivateQuestion(req.params.id), 'Question deactivated');
});
