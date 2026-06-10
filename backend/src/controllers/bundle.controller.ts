import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery, addTopicToBundlesSchema, assignBundleSchema } from '@izlearn/shared';
import { recordEvent } from '../services/auditTrail.service';
import * as svc from '../services/bundle.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listBundles(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

/** Export the (filtered) bundle list as CSV. Guarded by bundleManagement:export. */
export const exportCsv = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const csv = await svc.exportBundlesCsv(q);
  await recordEvent({ action: 'EXPORT', entityType: 'TopicBundle', entityId: 'list', newValue: { search: q.search } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bundles.csv"');
  res.send(csv);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getBundle(req.params.id));
});

export const detail = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getBundleDetail(req.params.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const bundle = await svc.createBundle(req.body, req.user!.id);
  sendCreated(res, bundle, 'Bundle created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.updateBundle(req.params.id, req.body, req.user!.id), 'Bundle updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.deleteBundle(req.params.id), 'Bundle deleted');
});

/** Archive / restore a bundle (toggle isActive). Reason captured by middleware. */
export const setActive = asyncHandler(async (req: Request, res: Response) => {
  const isActive = req.body?.isActive === true;
  sendSuccess(res, await svc.setBundleActive(req.params.id, isActive), isActive ? 'Bundle restored' : 'Bundle archived');
});

/** 4.7: link a topic to one or more bundles. */
export const addTopic = asyncHandler(async (req: Request, res: Response) => {
  const { bundleIds } = addTopicToBundlesSchema.parse(req.body);
  const r = await svc.addTopicToBundles(req.params.topicId, bundleIds, req.user!.id);
  sendSuccess(res, r, 'Topic added to bundle(s)');
});

/** Phase 5: assign a bundle → per-(user × topic) training assignments. */
export const assign = asyncHandler(async (req: Request, res: Response) => {
  const input = assignBundleSchema.parse(req.body);
  const created = await svc.assignBundle(req.params.id, req, { dueDate: input.dueDate ?? null });
  sendSuccess(res, { count: created.length }, `Bundle assigned — ${created.length} assignment(s) created`);
});
