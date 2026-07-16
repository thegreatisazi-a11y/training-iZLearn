import { Router } from 'express';
import * as c from '../controllers/user.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission, requireExactPermission } from '../middlewares/rbac.middleware';
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
// Item F: the user's OWN full profile — self-scoped (any authenticated user). Must
// precede '/:id' so 'me' is not captured as a user id.
router.get('/me', c.myProfile);

// Team overview — gated on the team module (CR: per-action team RBAC) and still
// supervisor-scoped server-side (a supervisor sees only their own reports; admin sees all).
router.get('/team', requirePermission('team', 'view'), c.team);
router.get('/team/:userId/history', requirePermission('team', 'view'), c.teamHistory);

// Creation requests (specific routes before '/:id'). The User Requests QUEUE (list +
// approve/reject) is now its own permission module, split from Users. Raising a request
// is gated on the EXACT userManagement:create flag so the "Create / New User Request"
// toggle in Roles & Access Control controls it independently (using the derived `write`
// would let edit/assign/etc. implicitly re-enable it).
router.get('/requests', requirePermission('userRequests', 'view'), c.listRequests);
router.get('/requests/:id', requirePermission('userRequests', 'view'), c.getRequest);
router.post(
  '/requests',
  requireExactPermission('userManagement', 'create'),
  validate(createUserSchema),
  c.createRequest,
);
// Item D: raising a request from "My Team" (Add Team Member) is gated on its OWN
// permission (team:create), independent of the Users module's create. Same underlying
// request flow — the supervisorId is supplied in the body so the new user is linked.
router.post(
  '/team-member',
  requireExactPermission('team', 'create'),
  validate(createUserSchema),
  c.createRequest,
);
// S5: edit / deactivate a team member from My Team. Gated on team:edit / team:deactivate;
// the controller enforces the hierarchy (supervisor → direct reports only; admin/
// coordinator → anyone). The underlying update/deactivate is still e-signed. These
// literal '/team-member/...' paths never collide with '/:id' (single-segment).
router.patch(
  '/team-member/:id',
  requireExactPermission('team', 'edit'),
  requireReasonForChange,
  validate(updateUserSchema),
  c.updateTeamMember,
);
router.post(
  '/team-member/:id/deactivate',
  requireExactPermission('team', 'deactivate'),
  requireReasonForChange,
  c.deactivateTeamMember,
);
router.post(
  '/requests/:id/decision',
  requirePermission('userRequests', 'approve'),
  captureReasonIfPresent,
  c.decideRequest,
);

// Bulk upload — gated on the dedicated 'bulk_upload' action so the Roles & Access
// Control toggle actually controls it (seed back-fills it for roles that previously
// could bulk-upload via write, so no one loses existing access).
router.post(
  '/bulk/preview',
  requireExactPermission('userManagement', 'bulk_upload'),
  uploadExcel.single('file'),
  c.bulkPreview,
);
router.post('/bulk/commit', requireExactPermission('userManagement', 'bulk_upload'), c.bulkCommit);

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
// Reset password — authorization is enforced in the service: an admin with the explicit
// userManagement:reset_password permission may reset anyone (except a SUPER_ADMIN, unless
// they are one); a supervisor may reset only their own DIRECT reports. So no blanket
// permission guard here (only auth + reason).
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
