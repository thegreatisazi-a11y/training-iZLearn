import { Router } from 'express';
import * as c from '../controllers/feedback.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createFeedbackFormSchema, updateFeedbackFormSchema, submitFeedbackSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

// Gate on the GRANULAR verbs (view / create / edit / archive) so the toggles configured in
// Roles & Access Control are enforced independently — not collapsed into a single coarse
// read/write (which let "create" unlock edit + delete too).
router.get('/forms', requirePermission('feedback', 'view'), c.listForms);
router.get('/forms/:id', requirePermission('feedback', 'view'), c.getForm);
router.post('/forms', requirePermission('feedback', 'create'), validate(createFeedbackFormSchema), c.createForm);
router.patch('/forms/:id', requirePermission('feedback', 'edit'), requireReasonForChange, validate(updateFeedbackFormSchema), c.updateForm);
router.delete('/forms/:id', requirePermission('feedback', 'archive'), requireReasonForChange, c.deactivateForm);
router.get('/forms/:id/analysis', requirePermission('feedback', 'view'), c.analysis);
// Submitting a response is open to any authenticated user (a trainee answering a form) —
// it needs no management permission.
router.post('/submit', validate(submitFeedbackSchema), c.submit);

export default router;
