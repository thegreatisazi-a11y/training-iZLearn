import { Router } from 'express';
import * as c from '../controllers/tni.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { captureReasonIfPresent, requireReasonForChange } from '../middlewares/reasonForChange.middleware';
import { createTNISchema, updateTNISchema, tniDecisionSchema, setTniRequirementSchema, applyTniMatrixSchema } from '@izlearn/shared';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('tni', 'read'), c.list);
// Export the filtered list (declared before "/:id" so "export" isn't parsed as an id).
router.get('/export', requirePermission('tni', 'export'), c.exportCsv);
// CR-46/47/49: requirement matrix (declared before "/:id" so "requirements" isn't parsed as an id).
router.get('/requirements/matrix', requirePermission('tni', 'read'), c.matrix);
router.post('/requirements', requirePermission('tni', 'edit'), validate(setTniRequirementSchema), c.setRequirement);
router.post('/requirements/apply', requirePermission('tni', 'assign'), captureReasonIfPresent, validate(applyTniMatrixSchema), c.applyMatrix);
router.get('/:id', requirePermission('tni', 'read'), c.get);
router.post('/', requirePermission('tni', 'write'), validate(createTNISchema), c.create);
// Edit a pending TNI's justification; withdraw/archive (soft-delete) a TNI.
// Both carry a MANDATORY reason for change (21 CFR Part 11 / Annex 11): every GMP-record
// update and delete must record why. Bundles already enforced this on its equivalent
// actions; TNI is now the primary path, so it must not be the weaker one.
router.patch('/:id', requirePermission('tni', 'write'), requireReasonForChange, validate(updateTNISchema), c.update);
router.delete('/:id', requirePermission('tni', 'write'), requireReasonForChange, c.archive);
router.post('/:id/restore', requirePermission('tni', 'write'), c.restore);
router.post('/:id/decision', requirePermission('tni', 'approve'), captureReasonIfPresent, validate(tniDecisionSchema), c.decide);

export default router;
