import { Router } from 'express';
import * as c from '../controllers/admin.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission, requireRole } from '../middlewares/rbac.middleware';

const router = Router();
router.use(authenticate);

router.post('/backup/trigger', requireRole('SUPER_ADMIN'), c.triggerBackup);
router.get('/backups', requirePermission('backup', 'read'), c.backups);
router.post('/backup/verify', requirePermission('backup', 'read'), c.verify);
router.post('/backup/restore', requireRole('SUPER_ADMIN'), c.restore);

export default router;
