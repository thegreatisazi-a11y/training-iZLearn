import { Router } from 'express';
import * as c from '../controllers/jobDescription.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange, captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
import { createJDSchema, updateJDSchema, jdTransitionSchema, jdTemplateSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('jobDescription', 'read'), c.list);
router.get('/templates', requirePermission('jobDescription', 'read'), c.listTemplates);
router.post('/templates', requirePermission('jobDescription', 'write'), validate(jdTemplateSchema), c.createTemplate);
router.patch('/templates/:id', requirePermission('jobDescription', 'write'), requireReasonForChange, validate(jdTemplateSchema), c.updateTemplate);
router.get('/user/:userId/history', requirePermission('jobDescription', 'read'), c.history);
router.post('/from-template', requirePermission('jobDescription', 'write'), c.fromTemplate);
router.get('/:id', requirePermission('jobDescription', 'read'), c.get);
router.post('/', requirePermission('jobDescription', 'write'), validate(createJDSchema), c.create);
router.patch('/:id', requirePermission('jobDescription', 'write'), requireReasonForChange, validate(updateJDSchema), c.update);
router.post('/:id/transition', requirePermission('jobDescription', 'read'), captureReasonIfPresent, validate(jdTransitionSchema), c.transition);

export default router;
