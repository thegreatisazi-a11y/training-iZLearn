import { Router } from 'express';
import * as c from '../controllers/department.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createDepartmentSchema, updateDepartmentSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Departments
 *     description: Master setup — departments (belong to a location)
 */
const router = Router();
router.use(authenticate);

router.get('/', requirePermission('masterSetup', 'read'), c.list);
router.get('/:id', requirePermission('masterSetup', 'read'), c.get);
router.post('/', requirePermission('masterSetup', 'write'), validate(createDepartmentSchema), c.create);
router.patch(
  '/:id',
  requirePermission('masterSetup', 'write'),
  requireReasonForChange,
  validate(updateDepartmentSchema),
  c.update,
);
router.delete('/:id', requirePermission('masterSetup', 'write'), requireReasonForChange, c.remove);

export default router;
