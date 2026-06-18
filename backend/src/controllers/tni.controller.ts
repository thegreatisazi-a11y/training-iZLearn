import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/tni.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = { ...paginationQuery.parse(req.query), userId: req.query.userId as string | undefined, status: req.query.status as string | undefined };
  const r = await svc.listTNI(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const get = asyncHandler(async (req, res) => sendSuccess(res, await svc.getTNI(req.params.id)));
export const create = asyncHandler(async (req, res) => sendCreated(res, await svc.createTNI(req.body, req.user!.id), 'TNI created'));
export const update = asyncHandler(async (req, res) => sendSuccess(res, await svc.updateTNI(req.params.id, req.body), 'TNI updated'));
export const archive = asyncHandler(async (req, res) => sendSuccess(res, await svc.archiveTNI(req.params.id), 'TNI removed'));
export const restore = asyncHandler(async (req, res) => sendSuccess(res, await svc.restoreTNI(req.params.id), 'TNI restored'));
export const decide = asyncHandler(async (req, res) => sendSuccess(res, await svc.decideTNI(req.params.id, req.body, req), 'TNI decision recorded'));

// CR-46/47/49: requirement matrix.
export const matrix = asyncHandler(async (_req, res) => sendSuccess(res, await svc.getRequirementMatrix()));
export const setRequirement = asyncHandler(async (req, res) => sendSuccess(res, await svc.setRequirement(req.body, req.user!.id), 'Requirement saved'));
export const applyMatrix = asyncHandler(async (req, res) => sendSuccess(res, await svc.applyRequirementMatrix(req.body, req), 'Assignments created from matrix'));
