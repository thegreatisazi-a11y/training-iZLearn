import { Router } from 'express';
import * as c from '../controllers/dashboard.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
router.use(authenticate);
router.get('/', c.get);
// Personal dashboard layout — any authenticated user manages their own.
router.put('/preferences', c.savePreferences);

export default router;
