import { Router } from 'express';
import * as c from '../controllers/location.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createLocationSchema, updateLocationSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Locations
 *     description: Master setup — physical locations
 */
const router = Router();
router.use(authenticate);

router.get('/', requirePermission('masterSetup', 'read'), c.list);
router.get('/:id', requirePermission('masterSetup', 'read'), c.get);
router.post('/', requirePermission('masterSetup', 'write'), validate(createLocationSchema), c.create);
router.patch(
  '/:id',
  requirePermission('masterSetup', 'write'),
  requireReasonForChange,
  validate(updateLocationSchema),
  c.update,
);
router.delete('/:id', requirePermission('masterSetup', 'write'), requireReasonForChange, c.remove);

export default router;
