import { Router } from 'express';
import * as c from '../controllers/announcement.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createAnnouncementSchema, updateAnnouncementSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Announcements
 *     description: Announcements (Module 14) — role-targeted broadcasts
 */
const router = Router();
router.use(authenticate);

// Personal feed — any authenticated user may read their own announcements.
router.get('/feed', c.feed);

// Granular verbs (view / create / edit / archive) so R&AC toggles apply independently.
router.get('/', requirePermission('announcements', 'view'), c.list);
router.get('/:id', requirePermission('announcements', 'view'), c.get);
router.post('/', requirePermission('announcements', 'create'), validate(createAnnouncementSchema), c.create);
router.patch(
  '/:id',
  requirePermission('announcements', 'edit'),
  requireReasonForChange,
  validate(updateAnnouncementSchema),
  c.update,
);
router.delete('/:id', requirePermission('announcements', 'archive'), requireReasonForChange, c.remove);

export default router;
