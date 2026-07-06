import { Router } from 'express';
import * as c from '../controllers/user.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange, captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
import { uploadExcel } from '../middlewares/upload.middleware';
import { createUserSchema, updateUserSchema, changeUserRolesSchema, setReleaseStageSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Users
 *     description: User management (Module 2) — creation-request approval workflow, roles, lifecycle
 */
const router = Router();
router.use(authenticate);

// Users
router.get('/', requirePermission('userManagement', 'read'), c.list);
// CR-12: export the (filtered) users list. Must precede '/:id' so it is not captured as an id.
router.get('/export', requirePermission('userManagement', 'export'), c.exportUsers);

// Team overview — gated on the team module (CR: per-action team RBAC) and still
// supervisor-scoped server-side (a supervisor sees only their own reports; admin sees all).
router.get('/team', requirePermission('team', 'view'), c.team);
router.get('/team/:userId/history', requirePermission('team', 'view'), c.teamHistory);

// Creation requests (specific routes before '/:id'). The User Requests QUEUE (list +
// approve/reject) is now its own permission module, split from Users. Raising a request
// stays a Users capability (userManagement:write), since it is initiated from the Users /
// My Team screens.
router.get('/requests', requirePermission('userRequests', 'view'), c.listRequests);
router.get('/requests/:id', requirePermission('userRequests', 'view'), c.getRequest);
router.post(
  '/requests',
  requirePermission('userManagement', 'write'),
  validate(createUserSchema),
  c.createRequest,
);
router.post(
  '/requests/:id/decision',
  requirePermission('userRequests', 'approve'),
  captureReasonIfPresent,
  c.decideRequest,
);

// Bulk upload
router.post(
  '/bulk/preview',
  requirePermission('userManagement', 'write'),
  uploadExcel.single('file'),
  c.bulkPreview,
);
router.post('/bulk/commit', requirePermission('userManagement', 'write'), c.bulkCommit);

// Single user
router.get('/:id', requirePermission('userManagement', 'read'), c.get);
router.patch(
  '/:id',
  requirePermission('userManagement', 'write'),
  requireReasonForChange,
  validate(updateUserSchema),
  c.update,
);
router.post(
  '/:id/roles',
  requirePermission('userManagement', 'approve'),
  requireReasonForChange,
  validate(changeUserRolesSchema),
  c.changeRoles,
);
router.post(
  '/:id/activate',
  requirePermission('userManagement', 'approve'),
  requireReasonForChange,
  c.activate,
);
router.post(
  '/:id/deactivate',
  requirePermission('userManagement', 'approve'),
  requireReasonForChange,
  c.deactivate,
);
// Reset password — authorization is enforced in the service: an admin
// (userManagement write/reset_password) may reset anyone; a supervisor may reset only
// their own DIRECT reports. So no blanket permission guard here (only auth + reason).
router.post(
  '/:id/reset-password',
  requireReasonForChange,
  c.resetPassword,
);

// CR-15/16: user lifecycle aggregate (read) + release-stage transition (approve + e-sign).
router.get('/:id/lifecycle', requirePermission('userManagement', 'read'), c.lifecycle);
router.post(
  '/:id/release-stage',
  requirePermission('userManagement', 'approve'),
  requireReasonForChange,
  validate(setReleaseStageSchema),
  c.setReleaseStage,
);

export default router;
