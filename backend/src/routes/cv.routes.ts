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

router.get('/mine', requirePermission('cv', 'view'), c.mine);
router.post('/mine', requirePermission('cv', 'edit'), validate(upsertCvSchema), c.upsertMine);
router.get('/team', requirePermission('cv', 'view'), c.team);
router.get('/user/:userId', requirePermission('cv', 'view'), c.getUser);

export default router;
