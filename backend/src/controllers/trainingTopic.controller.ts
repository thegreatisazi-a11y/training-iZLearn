import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated, AppError } from '../utils/response';
import { paginationQuery, updateTopicStatusSchema } from '@izlearn/shared';
import { hasPermission } from '../utils/permissions';
import { recordEvent } from '../services/auditTrail.service';
import * as svc from '../services/trainingTopic.service';
import * as historySvc from '../services/topicVersionHistory.service';

/** Course managers (courseManagement:write) see drafts; everyone else only PUBLISHED (4.3). */
function canManageCourses(req: Request): boolean {
  return hasPermission(req.user?.permissions, 'courseManagement', 'write');
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const r = await svc.listTopics({ ...q, status }, canManageCourses(req));
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

/** Export the (filtered) topic catalogue as CSV. Guarded by courseManagement:export. */
export const exportCsv = asyncHandler(async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const csv = await svc.exportTopicsCsv({ status, search }, canManageCourses(req));
  await recordEvent({ action: 'EXPORT', entityType: 'TrainingTopic', entityId: 'catalogue', newValue: { status, search } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="training-topics.csv"');
  res.send(csv);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getTopic(req.params.id, canManageCourses(req)));
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const input = updateTopicStatusSchema.parse(req.body);
  // Archiving (moving a topic to Archived/Obsolete) is additionally gated on the
  // 'archive' verb so the action can be granted independently of plain editing.
  if (input.status === 'ARCHIVED' && !hasPermission(req.user?.permissions, 'courseManagement', 'archive')) {
    throw AppError.forbidden('You do not have "archive" permission on courseManagement.');
  }
  sendSuccess(res, await svc.updateTopicStatus(req.params.id, input.status, req), `Topic ${input.status.toLowerCase()}`);
});

export const history = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await historySvc.listVersionHistory(req.params.id, q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const topic = await svc.createTopic(req.body, req.user!.id);
  sendCreated(res, topic, 'Training topic created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.updateTopic(req.params.id, req.body), 'Training topic updated');
});

export const updatePassingScore = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.updatePassingScore(req.params.id, req.body, req), 'Passing score updated');
});

export const revise = asyncHandler(async (req: Request, res: Response) => {
  const topic = await svc.reviseTopic(req.params.id, req);
  sendCreated(res, topic, 'New topic version created');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.deactivateTopic(req.params.id), 'Training topic deactivated');
});
