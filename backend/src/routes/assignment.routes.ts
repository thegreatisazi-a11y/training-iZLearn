import { Router } from 'express';
import * as c from '../controllers/assignment.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createAssignmentSchema, updateAssignmentSchema, waiveAssignmentSchema, supervisorDecisionSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

// A user's own trainings — any authenticated user (no elevated permission needed).
router.get('/mine', c.mine);
router.get('/', requirePermission('scheduling', 'read'), c.list);
router.get('/:id', requirePermission('scheduling', 'read'), c.get);
router.post('/', requirePermission('scheduling', 'write'), validate(createAssignmentSchema), c.create);
router.patch('/:id', requirePermission('scheduling', 'write'), requireReasonForChange, validate(updateAssignmentSchema), c.update);
router.post('/:id/waive', requirePermission('scheduling', 'write'), requireReasonForChange, validate(waiveAssignmentSchema), c.waive);
// CR-57: activate a deferred (assign-later) assignment.
router.post('/:id/activate', requirePermission('scheduling', 'write'), c.activate);
// CR-56: supervisor sign-off on a past-due / completion assignment.
router.post('/:id/supervisor-decision', requirePermission('scheduling', 'approve'), requireReasonForChange, validate(supervisorDecisionSchema), c.supervisorDecision);

export default router;
