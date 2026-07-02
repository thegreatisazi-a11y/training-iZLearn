import { Router } from 'express';
import * as c from '../controllers/question.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
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
// Question add/edit/remove on a published course STAGES the change; the reason (+ e-sign)
// is collected once at "Publish changes", so no reason is required on these edits.
router.patch(
  '/:id',
  requirePermission('questionBank', 'write'),
  captureReasonIfPresent,
  validate(updateQuestionSchema),
  c.update,
);
router.delete(
  '/:id',
  requirePermission('questionBank', 'write'),
  captureReasonIfPresent,
  c.remove,
);

export default router;
