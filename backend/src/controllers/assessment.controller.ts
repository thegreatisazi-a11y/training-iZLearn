import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated } from '../utils/response';
import * as svc from '../services/assessment.service';

export const start = asyncHandler(async (req: Request, res: Response) =>
  sendCreated(res, await svc.startAttempt(req.user!.id, req.body.topicId, req.body.assignmentId), 'Assessment started'),
);

export const submit = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.submitAttempt(req.body.attemptId, req.body.answers, req.user!.id, req.body.autoSubmitted === true, req.body.reason), 'Assessment submitted'),
);

export const acknowledgeRead = asyncHandler(async (req: Request, res: Response) =>
  sendCreated(res, await svc.completeByAcknowledgement(req.user!.id, req.body.topicId, req.body.assignmentId), 'Training completed'),
);

export const listMine = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.listAttempts({ userId: req.user!.id, topicId: req.query.topicId as string | undefined })),
);

export const list = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.listAttempts({ userId: req.query.userId as string | undefined, topicId: req.query.topicId as string | undefined })),
);

export const get = asyncHandler(async (req, res) => sendSuccess(res, await svc.getAttempt(req.params.id)));

export const unblock = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.unblockAssignment(req.params.assignmentId, req), 'Assignment unblocked'),
);
