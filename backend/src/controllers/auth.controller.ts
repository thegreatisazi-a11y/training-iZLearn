import { Request, Response } from 'express';
import { asyncHandler, sendSuccess } from '../utils/response';
import * as svc from '../services/auth.service';
import * as session from '../services/session.service';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await svc.login(
    { windowsUsername: req.body.windowsUsername, password: req.body.password, deviceInfo: req.body.deviceInfo },
    req.ip,
    req.get('user-agent'),
    req.body.terminateExisting === true,
  );
  sendSuccess(res, result, 'Logged in');
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.refresh(req.body.refreshToken));
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await svc.logout(req.user!.id, req.user!.sessionId);
  sendSuccess(res, { ok: true }, 'Logged out');
});

export const lock = asyncHandler(async (req: Request, res: Response) => {
  await svc.lockSession(req.user!.id, req.user!.sessionId);
  sendSuccess(res, { ok: true }, 'Session locked');
});

export const unlock = asyncHandler(async (req: Request, res: Response) => {
  const result = await svc.unlock(req.user!.id, req.user!.sessionId, req.body.password);
  sendSuccess(res, result, 'Session unlocked');
});

export const terminatePreviousSessions = asyncHandler(async (req: Request, res: Response) => {
  await session.terminatePreviousSessions(req.user!.id, 'User-initiated termination');
  sendSuccess(res, { ok: true }, 'Previous sessions terminated');
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await svc.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
  sendSuccess(res, result, 'Password changed');
});

export const setSignaturePassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await svc.setSignaturePassword(req.user!.id, req.body.loginPassword, req.body.signaturePassword);
  sendSuccess(res, result, 'Signature password set');
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, req.user);
});
