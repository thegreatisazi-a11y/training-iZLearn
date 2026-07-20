import { Router } from 'express';
import * as c from '../controllers/role.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange, captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
import { createRoleSchema, updateRoleSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Roles
 *     description: Role management (Module 3) — RBAC roles & permission matrix
 */
const router = Router();
router.use(authenticate);

router.get('/', requirePermission('roleManagement', 'read'), c.list);
router.get('/:id', requirePermission('roleManagement', 'read'), c.get);
// L-A3: capture a reason-for-change when provided (a new role has no prior value, so it
// isn't mandatory) — records it in the audit trail like the edit/delete paths.
router.post('/', requirePermission('roleManagement', 'write'), captureReasonIfPresent, validate(createRoleSchema), c.create);
router.patch(
  '/:id',
  requirePermission('roleManagement', 'write'),
  requireReasonForChange,
  validate(updateRoleSchema),
  c.update,
);
router.delete('/:id', requirePermission('roleManagement', 'write'), requireReasonForChange, c.remove);

export default router;
