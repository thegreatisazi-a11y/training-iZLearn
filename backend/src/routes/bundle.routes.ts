import { Router } from 'express';
import * as c from '../controllers/bundle.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createBundleSchema, updateBundleSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Bundles
 *     description: Topic bundles — assignable collections of training topics
 */
const router = Router();
router.use(authenticate);

// Granular verbs (fall back to legacy read/write). /export precedes /:id.
router.get('/', requirePermission('bundleManagement', 'view'), c.list);
router.get('/export', requirePermission('bundleManagement', 'export'), c.exportCsv);
router.get('/:id/detail', requirePermission('bundleManagement', 'view'), c.detail);
router.get('/:id', requirePermission('bundleManagement', 'view'), c.get);
router.post('/', requirePermission('bundleManagement', 'create'), validate(createBundleSchema), c.create);
router.patch(
  '/:id',
  requirePermission('bundleManagement', 'edit'),
  requireReasonForChange,
  validate(updateBundleSchema),
  c.update,
);
// Archive / restore (toggle isActive) — distinct from edit and from delete.
router.patch('/:id/active', requirePermission('bundleManagement', 'archive'), requireReasonForChange, c.setActive);
router.delete('/:id', requirePermission('bundleManagement', 'archive'), requireReasonForChange, c.remove);
// 4.7: link a topic to one or more bundles (from the topic detail page).
router.post('/topics/:topicId', requirePermission('bundleManagement', 'edit'), c.addTopic);
// Phase 5: assign a bundle to its target users (expands to per-topic assignments).
// Controlled action: requires a reason for change + e-signature (enforced in the service).
router.post('/:id/assign', requirePermission('bundleManagement', 'assign'), requireReasonForChange, c.assign);

export default router;
