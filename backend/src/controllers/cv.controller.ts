import { Request, Response } from 'express';
import { asyncHandler, sendSuccess } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/cv.service';

export const mine = asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await svc.getMyCV(req.user!.id)));

export const upsertMine = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await svc.upsertMyCV(req.user!.id, req.body), 'CV saved'),
);

export const getUser = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await svc.getUserCV(req.params.userId, req.user!)),
);

export const team = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await svc.listTeamCVs(req.user!, paginationQuery.parse(req.query))),
);
