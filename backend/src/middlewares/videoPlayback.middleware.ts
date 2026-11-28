import { Request, Response, NextFunction } from 'express';
import { buildAuthUser } from './auth.middleware';
import { isLocked } from '../config/redis';
import { isSessionActive } from '../services/session.service';
import { auditContext } from '../utils/auditContext';
import { AppError, asyncHandler } from '../utils/response';
import { verifyVideoTicket, videoCookieName } from '../utils/videoPlayback';

/** Native video requests cannot send the Axios bearer header; use a scoped HttpOnly ticket. */
export const authenticateVideoPlayback = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.[videoCookieName(req.params.id)];
  if (typeof token !== 'string') throw AppError.unauthorized('Video access has expired. Reload the material.');
  let userId: string;
  let sessionId: string;
  let roleContext: string | undefined;
  try {
    ({ userId, sessionId, roleContext } = verifyVideoTicket(token, req.params.id));
  } catch {
    throw AppError.unauthorized('Video access has expired. Reload the material.');
  }
  if (!(await isSessionActive(userId, sessionId))) throw AppError.unauthorized('Your session has ended.');
  if (await isLocked(userId, sessionId)) throw new AppError(423, 'LOCKED', 'Session is locked.');
  const user = await buildAuthUser(userId, sessionId);
  if (!user) throw AppError.unauthorized('Account is inactive or no longer exists.');
  if (!roleContext || roleContext !== user.roleContext) throw AppError.unauthorized('Your active role changed. Reopen the video under your current role.');
  req.user = user;
  auditContext.setActor({ userId: user.id, userFullName: user.fullName, userUsername: user.windowsUsername, sessionId, activeRoleId: user.activeRoleId, activeRoleName: user.activeRoleName });
  auditContext.setRequestMeta({ sessionId });
  next();
});
