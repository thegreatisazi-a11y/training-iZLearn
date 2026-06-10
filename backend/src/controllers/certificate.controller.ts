import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, AppError } from '../utils/response';
import { hasPermission } from '../utils/permissions';
import { recordEvent } from '../services/auditTrail.service';
import * as svc from '../services/certificate.service';

export const listMine = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await svc.listCertificates({ userId: req.user!.id })),
);

export const list = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.listCertificates({ userId: req.query.userId as string | undefined })),
);

export const get = asyncHandler(async (req, res) => sendSuccess(res, await svc.getCertificate(req.params.id)));

export const download = asyncHandler(async (req, res) => {
  const cert = await svc.getCertificate(req.params.id);
  if (cert.userId !== req.user!.id && !hasPermission(req.user!.permissions, 'certificates', 'print')) {
    throw AppError.forbidden('You may only download your own certificates.');
  }
  await recordEvent({ action: 'FILE_DOWNLOAD', entityType: 'Certificate', entityId: cert.id });
  res.download(cert.filePath, `${cert.certificateNumber}.pdf`);
});

export const issue = asyncHandler(async (req, res) =>
  sendCreated(res, await svc.issueForAttempt(req.body.attemptId), 'Certificate issued'),
);
