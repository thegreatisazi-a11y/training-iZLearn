import { Router } from 'express';
import * as c from '../controllers/report.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('reports', 'read'), c.listTypes);
router.get('/:type', requirePermission('reports', 'read'), c.get);
// Print/export permission is enforced inside the handler (print vs export).
router.post('/:type/export', requirePermission('reports', 'read'), c.exportReportHandler);

export default router;
