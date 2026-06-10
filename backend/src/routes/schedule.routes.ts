import { Router } from 'express';
import * as c from '../controllers/schedule.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { uploadFile } from '../middlewares/upload.middleware';
import { createScheduleSchema, updateScheduleSchema, ojtRecordSchema, offlineTrainingSchema } from '@izlearn/shared';

/**
 * @openapi
 * tags:
 *   - name: Scheduling
 *     description: Training scheduling & delivery (Module 6) — schedules, OJT, offline records
 */
const router = Router();
router.use(authenticate);

// OJT (specific routes before '/:id')
router.post('/ojt', requirePermission('scheduling', 'write'), validate(ojtRecordSchema), c.createOjt);
router.get('/ojt/list', requirePermission('scheduling', 'read'), c.listOjt);

// Offline / classroom records
router.post('/offline', requirePermission('scheduling', 'write'), validate(offlineTrainingSchema), c.createOffline);
router.post(
  '/offline/:id/attendance-sheet',
  requirePermission('scheduling', 'write'),
  uploadFile.single('file'),
  c.uploadOfflineSheet,
);

// Schedules
router.get('/', requirePermission('scheduling', 'read'), c.list);
router.get('/:id', requirePermission('scheduling', 'read'), c.get);
router.post('/', requirePermission('scheduling', 'write'), validate(createScheduleSchema), c.create);
router.patch(
  '/:id',
  requirePermission('scheduling', 'write'),
  requireReasonForChange,
  validate(updateScheduleSchema),
  c.update,
);
router.post('/:id/cancel', requirePermission('scheduling', 'write'), requireReasonForChange, c.cancel);

export default router;
