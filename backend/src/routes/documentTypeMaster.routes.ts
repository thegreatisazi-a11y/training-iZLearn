import { Router } from 'express';
import * as c from '../controllers/documentTypeMaster.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createDocumentTypeMasterSchema, updateDocumentTypeMasterSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('masterSetup', 'read'), c.list);
router.post('/', requirePermission('masterSetup', 'write'), validate(createDocumentTypeMasterSchema), c.create);
// CR-45: updates require both schema validation and a reason for change (21 CFR Part 11).
router.patch(
  '/:id',
  requirePermission('masterSetup', 'write'),
  requireReasonForChange,
  validate(updateDocumentTypeMasterSchema),
  c.update,
);
// 7.3: removal requires a reason for change.
router.delete('/:id', requirePermission('masterSetup', 'write'), requireReasonForChange, c.remove);

export default router;
