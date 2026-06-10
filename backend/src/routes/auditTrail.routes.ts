import { Router } from 'express';
import * as c from '../controllers/auditTrail.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('auditTrail', 'read'), c.list);
router.post('/export', requirePermission('auditTrail', 'export'), c.exportAudit);

export default router;
