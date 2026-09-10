import { Router } from 'express';
import * as c from '../controllers/printDocument.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
router.use(authenticate);

// One route for every printable document. The permission is declared per document type in the
// registry (services/printDocument.service.ts) and enforced in the handler, because the route
// cannot know which document is being requested until it reads :docType.
router.get('/:docType', c.render);

export default router;
