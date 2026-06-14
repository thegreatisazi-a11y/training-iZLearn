import { Router } from 'express';
import * as c from '../controllers/retake.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
import { createRetakeRequestSchema, retakeDecisionSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

// Trainee endpoints — own retake requests (any authenticated user).
router.get('/mine', c.mine);
router.post('/', validate(createRetakeRequestSchema), c.create);

// Supervisor endpoints — gated by the team module; scoped server-side to direct reports.
router.get('/', requirePermission('team', 'view'), c.list);
router.post('/:id/decision', requirePermission('team', 'approve'), captureReasonIfPresent, validate(retakeDecisionSchema), c.decide);

export default router;
