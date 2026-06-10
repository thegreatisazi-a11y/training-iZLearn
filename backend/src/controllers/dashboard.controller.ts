import { Request, Response } from 'express';
import { asyncHandler, sendSuccess } from '../utils/response';
import { getDashboard } from '../services/dashboard.service';

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getDashboard(req.user!));
});
