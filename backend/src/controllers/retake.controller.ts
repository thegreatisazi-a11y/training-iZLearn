import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/retake.service';

/** Trainee: create a retake request for one of their blocked assignments. */
export const create = asyncHandler(async (req: Request, res: Response) =>
  sendCreated(res, await svc.createRetakeRequest(req.body, req.user!.id), 'Retake request submitted'),
);

/** Trainee: their own retake requests (with status). */
export const mine = asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await svc.listMyRetakeRequests(req.user!.id)));

/** Supervisor: retake requests routed to them (their direct reports). */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = { ...paginationQuery.parse(req.query), status: req.query.status as string | undefined };
  const r = await svc.listForSupervisor(req, q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

/** Supervisor: approve / reject a retake request (e-signed). */
export const decide = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await svc.decideRetakeRequest(req.params.id, req.body, req), 'Retake decision recorded'),
);
