import { Router } from 'express';
import * as c from '../controllers/trainingTopic.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange, captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
import {
  createTopicSchema,
  updateTopicSchema,
  updateTopicStatusSchema,
  reviseTopicSchema,
} from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Training Topics
 *     description: Training content (Module 4) — versioned course definitions
 */
const router = Router();
router.use(authenticate);

// Granular verbs (fall back to legacy read/write via hasPermission, so existing
// roles keep working). /export must precede /:id so it is not captured as an id.
router.get('/', requirePermission('courseManagement', 'view'), c.list);
router.get('/export', requirePermission('courseManagement', 'export'), c.exportCsv);
router.get('/:id', requirePermission('courseManagement', 'view'), c.get);
router.get('/:id/history', requirePermission('courseManagement', 'view'), c.history);
router.post('/', requirePermission('courseManagement', 'create'), validate(createTopicSchema), c.create);
// Publish/archive: 'edit' covers publish; archiving is additionally gated on the
// 'archive' verb inside the controller.
router.patch(
  '/:id/status',
  requirePermission('courseManagement', 'edit'),
  requireReasonForChange,
  validate(updateTopicStatusSchema),
  c.updateStatus,
);
// Editing course details on a published course STAGES the change; the reason (+ e-sign)
// is collected once at "Publish changes", so no reason is required here.
router.patch(
  '/:id',
  requirePermission('courseManagement', 'edit'),
  captureReasonIfPresent,
  validate(updateTopicSchema),
  c.update,
);
// G4: publish a published topic's staged draft edits to the live record (e-signed).
router.post(
  '/:id/publish-draft',
  requirePermission('courseManagement', 'edit'),
  requireReasonForChange,
  c.publishDraftChanges,
);
router.post(
  '/:id/revise',
  requirePermission('courseManagement', 'revise'),
  requireReasonForChange,
  validate(reviseTopicSchema),
  c.revise,
);
router.delete(
  '/:id',
  requirePermission('courseManagement', 'archive'),
  requireReasonForChange,
  c.remove,
);

export default router;
