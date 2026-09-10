import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, AppError } from '../utils/response';
import * as svc from '../services/systemConfig.service';
import * as notifSvc from '../services/notificationSetting.service';
import { isNotificationType } from '@izlearn/shared';
import { signFromRequest } from '../services/eSignature.service';

export const list = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await svc.listConfig());
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  // Two-component e-signature is required to change system configuration.
  await signFromRequest(req, 'SystemConfig', 'config', 'Approved');
  const result = await svc.updateConfig(req.body.items, req.user!.id);
  sendSuccess(res, result, 'System configuration updated');
});

// Module 10: notification & email-template settings (per the notification catalog).
export const listNotifications = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await notifSvc.listSettings());
});

export const updateNotification = asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.params;
  if (!isNotificationType(type)) throw AppError.badRequest('Unknown notification type.');
  sendSuccess(res, await notifSvc.updateSetting(type, req.body, req.user!.id), 'Notification settings updated');
});
