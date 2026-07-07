import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/jobDescription.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = { ...paginationQuery.parse(req.query), userId: req.query.userId as string | undefined };
  const r = await svc.listJDs(q, { id: req.user!.id, roleNames: req.user!.roleNames });
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const get = asyncHandler(async (req, res) => sendSuccess(res, await svc.getJD(req.params.id)));

export const create = asyncHandler(async (req, res) =>
  sendCreated(res, await svc.createJD(req.body, req.user!.id), 'Job description created'),
);

export const update = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.updateJD(req.params.id, req.body, req), 'Job description updated'),
);

export const transition = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.transitionJD(req.params.id, req.body, req), 'Job description updated'),
);

export const mine = asyncHandler(async (req, res) => sendSuccess(res, await svc.getMyJD(req.user!.id)));

export const mineList = asyncHandler(async (req, res) => sendSuccess(res, await svc.listMyJDs(req.user!.id)));

export const assignFunctionalRole = asyncHandler(async (req, res) =>
  sendCreated(res, await svc.assignFunctionalRole(req.body.userId, req.body.functionalRoleId, req), 'Functional role assigned'),
);

export const assignFromTemplate = asyncHandler(async (req, res) =>
  sendCreated(res, await svc.assignJDFromTemplate(req.body, req), 'Job description assigned'),
);

export const acknowledge = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.acknowledgeJD(req.params.id, req.body, req), 'Job description acknowledged'),
);

export const fromTemplate = asyncHandler(async (req, res) => {
  const { userId, departmentId, roleId } = req.body;
  sendCreated(res, await svc.createFromTemplate(userId, departmentId, roleId, req.user!.id), 'Job description created from template');
});

export const history = asyncHandler(async (req, res) => sendSuccess(res, await svc.getEmployeeJDHistory(req.params.userId)));

// Supervisor/owner/admin view of a user's JDs (gated in the service), mirroring CV.
export const userJDs = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.getUserJDsForViewer(req.params.userId, req.user!)),
);

export const listTemplates = asyncHandler(async (req, res) => {
  const r = await svc.listTemplates(paginationQuery.parse(req.query));
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const createTemplate = asyncHandler(async (req, res) =>
  sendCreated(res, await svc.createTemplate(req.body, req.user!.id), 'Template created'),
);

export const updateTemplate = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.updateTemplate(req.params.id, req.body, req), 'Template updated'),
);
