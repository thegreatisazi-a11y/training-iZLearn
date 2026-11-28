import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

const PLAYBACK_SECONDS = 8 * 60 * 60;
const playbackSecret = () => createHmac('sha256', env.jwt.accessSecret).update('izlearn-video-playback-v1').digest();

export function videoCookieName(materialId: string): string {
  return `izlearn_video_${materialId}`;
}

export function createVideoTicket(userId: string, sessionId: string, materialId: string, roleContext: string): string {
  return jwt.sign({ sub: userId, sid: sessionId, mid: materialId, rc: roleContext, purpose: 'video' }, playbackSecret(), {
    expiresIn: PLAYBACK_SECONDS,
  });
}

export function verifyVideoTicket(token: string, materialId: string): { userId: string; sessionId: string; roleContext: string } {
  const payload = jwt.verify(token, playbackSecret()) as jwt.JwtPayload;
  if (payload.purpose !== 'video' || payload.mid !== materialId ||
      typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.rc !== 'string') {
    throw new Error('Invalid video ticket');
  }
  return { userId: payload.sub, sessionId: payload.sid, roleContext: payload.rc };
}

export const VIDEO_TICKET_MAX_AGE_MS = PLAYBACK_SECONDS * 1000;

