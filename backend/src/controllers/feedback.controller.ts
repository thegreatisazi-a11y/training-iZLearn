import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/feedback.service';

export const listForms = asyncHandler(async (req: Request, res: Response) => {
  const q = { ...paginationQuery.parse(req.query), topicId: req.query.topicId as string | undefined };
  const r = await svc.listForms(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const getForm = asyncHandler(async (req, res) => sendSuccess(res, await svc.getForm(req.params.id)));
export const createForm = asyncHandler(async (req, res) => sendCreated(res, await svc.createForm(req.body, req.user!.id), 'Feedback form created'));
export const updateForm = asyncHandler(async (req, res) => sendSuccess(res, await svc.updateForm(req.params.id, req.body), 'Feedback form updated'));
export const deactivateForm = asyncHandler(async (req, res) => sendSuccess(res, await svc.deactivateForm(req.params.id), 'Feedback form deactivated'));
export const submit = asyncHandler(async (req, res) => sendCreated(res, await svc.submitFeedback(req.body, req.user!.id), 'Feedback submitted'));
export const analysis = asyncHandler(async (req, res) => sendSuccess(res, await svc.analyzeForm(req.params.id)));
