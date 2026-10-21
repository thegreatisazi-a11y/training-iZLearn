import { Router } from 'express';
import * as c from '../controllers/admin.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';

const router = Router();
router.use(authenticate);

// Permission-driven, not role-name-driven: the catalog already defines backup:create /
// backup:approve, and the sibling routes below already use them. The previous
// requireRole('SUPER_ADMIN') stopped matching once the role was renamed in the UI, which
// left manual backup and restore unreachable by anyone.
router.post('/backup/trigger', requirePermission('backup', 'create'), c.triggerBackup);
router.get('/backups', requirePermission('backup', 'view'), c.backups);
router.post('/backup/verify', requirePermission('backup', 'view'), c.verify);
router.get('/backup/download/:file', requirePermission('backup', 'approve'), c.download);
router.post('/backup/restore', requirePermission('backup', 'approve'), c.restore);

export default router;
