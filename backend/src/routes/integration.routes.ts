import { Router } from 'express';
import * as c from '../controllers/integration.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();
router.use(authenticate, requireRole('SUPER_ADMIN', 'IT_ADMIN'));

router.post('/dms/sync', c.dmsSync);
router.post('/hr/user-sync', c.hrUserSync);
router.post('/instrument/training-trigger', c.instrumentTrainingTrigger);

export default router;
