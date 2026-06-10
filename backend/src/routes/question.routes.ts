import { Router } from 'express';
import * as c from '../controllers/question.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createQuestionSchema, updateQuestionSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Questions
 *     description: Question bank (Module 7) — assessment questions per topic version
 */
const router = Router();
router.use(authenticate);

router.get('/', requirePermission('questionBank', 'read'), c.list);
router.get('/:id', requirePermission('questionBank', 'read'), c.get);
router.post('/', requirePermission('questionBank', 'write'), validate(createQuestionSchema), c.create);
router.patch(
  '/:id',
  requirePermission('questionBank', 'write'),
  requireReasonForChange,
  validate(updateQuestionSchema),
  c.update,
);
router.delete(
  '/:id',
  requirePermission('questionBank', 'write'),
  requireReasonForChange,
  c.remove,
);

export default router;
