import { Router } from 'express';
import * as c from '../controllers/certificateTemplate.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { certificateTemplateSchema, updateCertificateTemplateSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: CertificateTemplates
 *     description: Admin certificate template manager (Module 8 extension)
 */
const router = Router();
router.use(authenticate);

// Certificate Templates are their own permission module now (split from Certificates)
// so the menu item / manager can be granted independently.
const canRead = requirePermission('certificateTemplates', 'view');
const canWrite = requirePermission('certificateTemplates', 'edit');

router.get('/', canRead, c.list);
router.post('/', canWrite, validate(certificateTemplateSchema), c.create);
router.get('/:id', canRead, c.get);
router.put('/:id', canWrite, validate(updateCertificateTemplateSchema), c.update);
router.delete('/:id', canWrite, c.remove);
router.post('/:id/set-default', canWrite, c.setDefault);
router.post('/:id/preview', canRead, c.preview);
router.post('/:id/duplicate', canWrite, c.duplicate);

export default router;
