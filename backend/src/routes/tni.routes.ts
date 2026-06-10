import { Router } from 'express';
import * as c from '../controllers/tni.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
import { createTNISchema, tniDecisionSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('tni', 'read'), c.list);
router.get('/:id', requirePermission('tni', 'read'), c.get);
router.post('/', requirePermission('tni', 'write'), validate(createTNISchema), c.create);
router.post('/:id/decision', requirePermission('tni', 'approve'), captureReasonIfPresent, validate(tniDecisionSchema), c.decide);

export default router;
