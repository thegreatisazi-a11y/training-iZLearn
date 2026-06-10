import { Router } from 'express';
import * as c from '../controllers/auth.controller';
import { authenticate, authenticateAllowLocked } from '../middlewares/auth.middleware';
import { authRateLimiter } from '../middlewares/rateLimit.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  loginSchema,
  refreshSchema,
  unlockSchema,
  changePasswordSchema,
  setSignaturePasswordSchema,
} from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Auth
 *     description: Authentication, sessions and credential management (Module 1)
 */
const router = Router();

// Module 15 §2 — every /auth endpoint is rate-limited (10 req/min/IP).
router.use(authRateLimiter);

// Public endpoints.
router.post('/login', validate(loginSchema), c.login);
router.post('/refresh', validate(refreshSchema), c.refresh);

// Authenticated endpoints.
router.post('/logout', authenticate, c.logout);
router.post('/lock', authenticate, c.lock);
router.post('/unlock', authenticateAllowLocked, validate(unlockSchema), c.unlock);
router.delete('/sessions/previous', authenticate, c.terminatePreviousSessions);
router.post('/change-password', authenticate, validate(changePasswordSchema), c.changePassword);
router.post('/set-signature-password', authenticate, validate(setSignaturePasswordSchema), c.setSignaturePassword);
router.get('/me', authenticate, c.me);

export default router;
