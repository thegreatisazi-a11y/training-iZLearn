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

// Material-library / management read (managers only — controls the menu + library page).
router.get('/', requirePermission('materialManagement', 'read'), c.list);

// --- Personal training-reading endpoints (ANY authenticated user) ---
// Reading/viewing material for one's OWN assigned training is a personal action (like
// taking the assessment), NOT a material-management action. A basic trainee role does
// not have materialManagement:read, so gating these on it wrongly hid all reading
// material during training. Ownership + current-version-only (UR-16) + the no-download
// lock are still enforced in the controllers.
// NOTE: '/reading-status' must precede '/:id' so it isn't captured as an id param.
router.get('/reading-status', c.readingStatus);
// Global training instruction shown before reading on Start Training. GET is available
// to any authenticated user (they must see it before training). These literal paths MUST
// precede '/:id' and '/:id/replace' so they aren't captured as an id param.
router.get('/instruction', c.instruction);
router.post(
  '/instruction/replace',
  requirePermission('materialManagement', 'write'),
  uploadFile.single('file'),
  c.replaceInstruction,
);
router.get('/:id', requirePermission('materialManagement', 'read'), c.get);
router.get('/:id/download', c.download);
// Locked, view-only PDF for the in-app viewer (native PDFs pass through; Office docs are
// converted to PDF server-side and cached).
router.get('/:id/view-pdf', c.viewPdf);
router.post('/:id/view/start', c.startView);
router.post('/:id/view/complete', c.completeView);
// A4: auto-save reading progress so a session can resume where the user left off.
router.post('/:id/view/progress', c.saveViewProgress);
// Set per-material required reading time (course managers / material managers).
router.patch('/:id', requirePermission('materialManagement', 'write'), c.setViewTime);
// Flag/unflag a library material as the global training instruction (managers).
router.patch('/:id/set-instruction', requirePermission('materialManagement', 'write'), c.setInstruction);
// Trainee acknowledges the instruction before starting (personal action, any user).
router.post('/:id/acknowledge-instruction', c.acknowledgeInstruction);
// topicId is supplied in the multipart body alongside the file.
router.post('/', requirePermission('materialManagement', 'write'), uploadFile.single('file'), c.upload);
// CR-MAT2: bulk-upload multiple files (library-level when no topicId supplied).
router.post('/bulk', requirePermission('materialManagement', 'create'), uploadFile.array('files', 50), c.bulkUpload);
// 4.2: attach an existing library material to a topic as the current version.
router.post('/attach', requirePermission('materialManagement', 'write'), captureReasonIfPresent, c.attachFromLibrary);
// 4.1: replace/update a specific material with a new uploaded version. On a published
// course this STAGES the change; the reason (+ e-sign) is captured once at "Publish
// changes", so no reason is required here.
router.post(
  '/:id/replace',
  requirePermission('materialManagement', 'write'),
  uploadFile.single('file'),
  captureReasonIfPresent,
  c.replace,
);
// 4.1 (library variant): replace a specific material with an existing Material Library file.
router.post(
  '/:id/replace-from-library',
  requirePermission('materialManagement', 'write'),
  captureReasonIfPresent,
  c.replaceFromLibrary,
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
