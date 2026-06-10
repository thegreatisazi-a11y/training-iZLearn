import { Router } from 'express';
import * as c from '../controllers/documentTypeMaster.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('masterSetup', 'read'), c.list);
router.post('/', requirePermission('masterSetup', 'write'), c.create);
router.patch('/:id', requirePermission('masterSetup', 'write'), c.update);
// 7.3: removal requires a reason for change.
router.delete('/:id', requirePermission('masterSetup', 'write'), requireReasonForChange, c.remove);

export default router;
