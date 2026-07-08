import { Router } from 'express';
import * as c from '../controllers/assessment.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
import { startAssessmentSchema, submitAssessmentSchema } from '@izlearn/shared';
import type { PermissionAction } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/mine', c.listMine);
// S1/Item 3: attempts of OTHER users the requester may view/download (team for a
// supervisor, org-wide for admin/coordinator). Gated on the dedicated view_others
// action; the exact team-vs-all scope is enforced in the service.
router.get('/managed', requirePermission('assessments', 'view_others' as PermissionAction), c.listManaged);
// Review a completed attempt (own attempt for any user; any attempt for a manager).
// Ownership/authorization is enforced in the service, so no blanket permission gate.
router.get('/:id/review', c.review);
router.get('/', requirePermission('assessments', 'read'), c.list);
// Taking an assessment is a PERSONAL action on the user's own assigned training —
// any authenticated user may take training that has been assigned to them, regardless
// of their role's assessment-authoring permissions. Ownership / assignment / blocked
// / reading-gate checks are all enforced in assessment.service.
router.post('/start', validate(startAssessmentSchema), c.start);
router.post('/submit', validate(submitAssessmentSchema), c.submit);
// CR-41: complete a no-assessment SOP via read + T&C acknowledgement.
router.post('/acknowledge-read', validate(startAssessmentSchema), c.acknowledgeRead);
router.post('/assignments/:assignmentId/unblock', requirePermission('assessments', 'write'), captureReasonIfPresent, c.unblock);
router.get('/:id', requirePermission('assessments', 'read'), c.get);

export default router;
