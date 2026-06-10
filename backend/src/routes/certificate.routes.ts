import { Router } from 'express';
import * as c from '../controllers/certificate.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { issueCertificateSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/mine', c.listMine);
router.get('/', requirePermission('certificates', 'read'), c.list);
router.get('/:id/download', c.download); // ownership / print-permission checked in controller
router.get('/:id', requirePermission('certificates', 'read'), c.get);
router.post('/issue', requirePermission('certificates', 'write'), validate(issueCertificateSchema), c.issue);

export default router;
