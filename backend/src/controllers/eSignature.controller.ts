import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, AppError } from '../utils/response';
import { getSignaturesFor, verifyAndSign } from '../services/eSignature.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { recordType, recordId } = req.query as { recordType?: string; recordId?: string };
  if (!recordType || !recordId) throw AppError.badRequest('recordType and recordId are required.');
  sendSuccess(res, await getSignaturesFor(recordType, recordId));
});

/** Standalone signature (e.g. acknowledging a record). */
export const sign = asyncHandler(async (req, res) => {
  const sig = await verifyAndSign({
    actingUserId: req.user!.id,
    windowsUsername: req.body.windowsUsername,
    signaturePassword: req.body.signaturePassword,
    meaning: req.body.meaning,
    recordType: req.body.recordType,
    recordId: req.body.recordId,
  });
  sendCreated(res, { id: sig.id, signedAt: sig.signedAt, meaning: sig.meaning }, 'Signature recorded');
});
