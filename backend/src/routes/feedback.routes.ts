import { Router } from 'express';
import * as c from '../controllers/feedback.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createFeedbackFormSchema, updateFeedbackFormSchema, submitFeedbackSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/forms', requirePermission('feedback', 'read'), c.listForms);
router.get('/forms/:id', requirePermission('feedback', 'read'), c.getForm);
router.post('/forms', requirePermission('feedback', 'write'), validate(createFeedbackFormSchema), c.createForm);
router.patch('/forms/:id', requirePermission('feedback', 'write'), requireReasonForChange, validate(updateFeedbackFormSchema), c.updateForm);
router.delete('/forms/:id', requirePermission('feedback', 'write'), requireReasonForChange, c.deactivateForm);
router.get('/forms/:id/analysis', requirePermission('feedback', 'read'), c.analysis);
router.post('/submit', validate(submitFeedbackSchema), c.submit);

export default router;
