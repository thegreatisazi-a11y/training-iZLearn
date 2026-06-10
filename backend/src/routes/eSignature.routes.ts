import { Router } from 'express';
import * as c from '../controllers/eSignature.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { eSignatureSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/', c.list);
router.post('/', validate(eSignatureSchema), c.sign);

export default router;
