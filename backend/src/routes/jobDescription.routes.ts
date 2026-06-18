import { Router } from 'express';
import * as c from '../controllers/jobDescription.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange, captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
import { createJDSchema, updateJDSchema, jdTransitionSchema, jdTemplateSchema, assignFunctionalRoleSchema, assignJDFromTemplateSchema, acknowledgeJDSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('jobDescription', 'read'), c.list);
// CR-50: a user's own JD + self-acknowledge are self-scoped (no module read needed).
router.get('/mine', c.mine);
// B1: the full list of the user's own (non-obsolete) assigned JDs.
router.get('/mine/list', c.mineList);
router.post('/assign-functional-role', requirePermission('jobDescription', 'assign'), validate(assignFunctionalRoleSchema), c.assignFunctionalRole);
// I4/I5: assign a JD to a user from a template (editable copy), approved on create.
router.post('/assign-from-template', requirePermission('jobDescription', 'assign'), validate(assignJDFromTemplateSchema), c.assignFromTemplate);
router.get('/templates', requirePermission('jobDescription', 'read'), c.listTemplates);
router.post('/templates', requirePermission('jobDescription', 'write'), validate(jdTemplateSchema), c.createTemplate);
router.patch('/templates/:id', requirePermission('jobDescription', 'write'), requireReasonForChange, validate(jdTemplateSchema), c.updateTemplate);
router.get('/user/:userId/history', requirePermission('jobDescription', 'read'), c.history);
router.post('/from-template', requirePermission('jobDescription', 'write'), c.fromTemplate);
router.get('/:id', requirePermission('jobDescription', 'read'), c.get);
router.post('/', requirePermission('jobDescription', 'write'), validate(createJDSchema), c.create);
router.patch('/:id', requirePermission('jobDescription', 'write'), requireReasonForChange, validate(updateJDSchema), c.update);
// CR-48: state-changing transitions must NOT be gated on the read verb. The route
// requires a write-level permission; APPROVE/REJECT additionally require the
// approve verb (enforced in the service).
router.post('/:id/transition', requirePermission('jobDescription', 'edit'), captureReasonIfPresent, validate(jdTransitionSchema), c.transition);
// CR-50 / D-JD3: acknowledge own JD (ownership enforced in the service).
router.post('/:id/acknowledge', validate(acknowledgeJDSchema), c.acknowledge);

export default router;
