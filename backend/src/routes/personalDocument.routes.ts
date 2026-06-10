import { Router } from 'express';
import * as c from '../controllers/personalDocument.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { uploadFile } from '../middlewares/upload.middleware';

const router = Router();
router.use(authenticate);

router.get('/me', c.listMine);
router.get('/user/:userId', c.listByUser);
router.post('/', uploadFile.single('file'), c.upload);
router.get('/:id/download', c.download);
router.delete('/:id', requireReasonForChange, c.remove);

export default router;
