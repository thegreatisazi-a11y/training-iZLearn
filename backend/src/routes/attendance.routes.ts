import { Router } from 'express';
import * as c from '../controllers/attendance.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { uploadExcel } from '../middlewares/upload.middleware';
import { markAttendanceSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/schedule/:scheduleId', requirePermission('attendance', 'read'), c.list);
router.post('/', requirePermission('attendance', 'write'), validate(markAttendanceSchema), c.mark);
router.post('/upload/preview', requirePermission('attendance', 'write'), uploadExcel.single('file'), c.uploadPreview);
router.post('/upload/commit', requirePermission('attendance', 'write'), uploadExcel.single('file'), c.uploadCommit);

export default router;
