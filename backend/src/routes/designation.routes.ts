import { Router } from 'express';
import * as c from '../controllers/designation.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createDesignationSchema, updateDesignationSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('masterSetup', 'read'), c.list);
router.post('/', requirePermission('masterSetup', 'write'), validate(createDesignationSchema), c.create);
router.patch(
  '/:id',
  requirePermission('masterSetup', 'write'),
  requireReasonForChange,
  validate(updateDesignationSchema),
  c.update,
);
router.delete('/:id', requirePermission('masterSetup', 'write'), requireReasonForChange, c.remove);

export default router;
