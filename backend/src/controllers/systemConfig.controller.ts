import { Request, Response } from 'express';
import { asyncHandler, sendSuccess } from '../utils/response';
import * as svc from '../services/systemConfig.service';
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
