import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated, AppError } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import { toEndBound } from '../utils/dateUtils';
import * as svc from '../services/schedule.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listSchedules(q, {
    topicId: req.query.topicId as string | undefined,
    status: req.query.status as string | undefined,
    from: req.query.from ? new Date(req.query.from as string) : undefined,
    to: req.query.to ? toEndBound(req.query.to as string) : undefined,
  });
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getSchedule(req.params.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const s = await svc.createSchedule(req.body, req.user!.id);
  sendCreated(res, s, 'Training scheduled');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const s = await svc.updateSchedule(req.params.id, req.body);
  sendSuccess(res, s, 'Schedule updated');
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const s = await svc.cancelSchedule(req.params.id);
  sendSuccess(res, s, 'Schedule cancelled');
});

// ---- OJT --------------------------------------------------------------------

export const createOjt = asyncHandler(async (req: Request, res: Response) => {
  const r = await svc.createOjtRecord(req.body, req.user!.id);
  sendCreated(res, r, 'OJT record created');
});

export const listOjt = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listOjtRecords(q, {
    topicId: req.query.topicId as string | undefined,
    userId: req.query.userId as string | undefined,
  });
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

// ---- Offline ----------------------------------------------------------------

export const createOffline = asyncHandler(async (req: Request, res: Response) => {
  const r = await svc.createOfflineTraining(req.body, req.user!.id);
  sendCreated(res, r, 'Offline training record created');
});

export const listOffline = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listOfflineRecords(q, { topicId: req.query.topicId as string | undefined });
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const uploadOfflineSheet = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw AppError.badRequest('An attendance-sheet file is required.');
  const r = await svc.attachOfflineAttendanceSheet(req.params.id, req.file);
  sendSuccess(res, r, 'Attendance sheet attached');
});
