import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, AppError } from '../utils/response';
import * as svc from '../services/attendance.service';

export const list = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await svc.listAttendance(req.params.scheduleId)),
);

export const mark = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.markAttendance(req.body, req.user!.id), 'Attendance recorded'),
);

export const uploadPreview = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('An Excel file is required.');
  sendSuccess(res, await svc.previewAttendanceExcel(req.file.buffer));
});

export const uploadCommit = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('An Excel file is required.');
  const scheduleId = req.body.scheduleId as string;
  if (!scheduleId) throw AppError.badRequest('scheduleId is required.');
  sendSuccess(res, await svc.commitAttendanceExcel(scheduleId, req.file.buffer, req.user!.id), 'Attendance uploaded');
});
