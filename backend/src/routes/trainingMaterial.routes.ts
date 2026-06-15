import { Router } from 'express';
import * as c from '../controllers/trainingMaterial.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { requireReasonForChange, captureReasonIfPresent } from '../middlewares/reasonForChange.middleware';
import { uploadFile } from '../middlewares/upload.middleware';

/**
 * @openapi
 * tags:
 *   - name: Training Materials
 *     description: Training content (Module 4) — uploaded course materials & library
 */
const router = Router();
router.use(authenticate);

router.get('/', requirePermission('materialManagement', 'read'), c.list);
// Reading-gate: a user's per-material reading status for a topic, and start/complete.
router.get('/reading-status', requirePermission('materialManagement', 'read'), c.readingStatus);
router.get('/:id', requirePermission('materialManagement', 'read'), c.get);
router.get('/:id/download', requirePermission('materialManagement', 'read'), c.download);
router.post('/:id/view/start', requirePermission('materialManagement', 'read'), c.startView);
router.post('/:id/view/complete', requirePermission('materialManagement', 'read'), c.completeView);
// Set per-material required reading time (course managers / material managers).
router.patch('/:id', requirePermission('materialManagement', 'write'), c.setViewTime);
// topicId is supplied in the multipart body alongside the file.
router.post('/', requirePermission('materialManagement', 'write'), uploadFile.single('file'), c.upload);
// CR-MAT2: bulk-upload multiple files (library-level when no topicId supplied).
router.post('/bulk', requirePermission('materialManagement', 'create'), uploadFile.array('files', 50), c.bulkUpload);
// 4.2: attach an existing library material to a topic as the current version.
router.post('/attach', requirePermission('materialManagement', 'write'), captureReasonIfPresent, c.attachFromLibrary);
// 4.1: replace/update a specific material with a new uploaded version (multipart; reason required).
router.post(
  '/:id/replace',
  requirePermission('materialManagement', 'write'),
  uploadFile.single('file'),
  requireReasonForChange,
  c.replace,
);
router.delete(
  '/:id',
  requirePermission('materialManagement', 'write'),
  requireReasonForChange,
  c.remove,
);
// Discard a staged (pending) file before it goes live — no reason required.
router.delete('/:id/staged', requirePermission('materialManagement', 'write'), c.discardStaged);

export default router;
