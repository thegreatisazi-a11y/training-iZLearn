import { Router } from 'express';
import * as c from '../controllers/integration.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';

const router = Router();
// integrations:edit in Roles & Access Control — replaces requireRole('SUPER_ADMIN',
// 'IT_ADMIN'), which matched role NAMES and so broke when those roles were renamed.
router.use(authenticate, requirePermission('integrations', 'edit'));

router.post('/dms/sync', c.dmsSync);
router.post('/hr/user-sync', c.hrUserSync);
router.post('/instrument/training-trigger', c.instrumentTrainingTrigger);

export default router;
