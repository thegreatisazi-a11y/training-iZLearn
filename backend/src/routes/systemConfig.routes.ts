import { Router } from 'express';
import * as c from '../controllers/systemConfig.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { bulkUpdateConfigSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: System Config
 *     description: System configuration (Module 14) — e-signed, audited as CONFIG_CHANGE
 */
const router = Router();
router.use(authenticate);

router.get('/', requirePermission('systemConfig', 'read'), c.list);
router.patch(
  '/',
  requirePermission('systemConfig', 'write'),
  requireReasonForChange,
  validate(bulkUpdateConfigSchema),
  c.update,
);

export default router;
