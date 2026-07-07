import { Router } from 'express';
import * as c from '../controllers/cv.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { upsertCvSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: CV
 *     description: Curriculum Vitae (CR-52) — one live CV per user; visibility enforced server-side
 */
const router = Router();
router.use(authenticate);

// A user's OWN CV is a personal record (the "My CV" menu item is ungated) and is also a
// prerequisite gate for starting training — so viewing/editing it must NOT require the
// cv management permission. Ownership is implicit (always the caller's own CV).
router.get('/mine', c.mine);
// Item A: the user's own CV version history (self-scoped, reconstructed from audit trail).
router.get('/mine/history', c.mineHistory);
router.post('/mine', validate(upsertCvSchema), c.upsertMine);
// Team CV views are gated on the team module ("View team CV"); ownership/supervisor
// scope is still enforced in the service.
router.get('/team', requirePermission('team', 'view'), c.team);
router.get('/user/:userId', requirePermission('cv', 'view'), c.getUser);

export default router;
