import { Request, Response } from 'express';
import { asyncHandler, sendSuccess } from '../utils/response';
import { getDashboard, saveDashboardPreferences } from '../services/dashboard.service';

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getDashboard(req.user!));
});

// Self-scoped: save the signed-in user's own dashboard layout (no permission gate).
export const savePreferences = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await saveDashboardPreferences(req.user!.id, req.body), 'Dashboard layout saved');
});
