import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, AppError } from '../utils/response';
import { hasPermission } from '../utils/permissions';
import { contentTypeForExt, getExtension } from '../utils/fileUtils';
import { streamDownload } from '../utils/fileDownload';
import { recordEvent } from '../services/auditTrail.service';
import * as svc from '../services/personalDocument.service';

function canRead(req: Request, userId: string) {
  return req.user!.id === userId || hasPermission(req.user!.permissions, 'userManagement', 'read');
}
function canWrite(req: Request, userId: string) {
  return req.user!.id === userId || hasPermission(req.user!.permissions, 'userManagement', 'write');
}

export const listMine = asyncHandler(async (req, res) => sendSuccess(res, await svc.listByUser(req.user!.id)));

export const listByUser = asyncHandler(async (req, res) => {
  if (!canRead(req, req.params.userId)) throw AppError.forbidden();
  sendSuccess(res, await svc.listByUser(req.params.userId));
});

export const upload = asyncHandler(async (req, res) => {
  const userId = (req.body.userId as string) || req.user!.id;
  if (!canWrite(req, userId)) throw AppError.forbidden();
  if (!req.file) throw AppError.badRequest('A file is required.');
  const doc = await svc.uploadPersonalDoc(
    { userId, documentType: req.body.documentType, title: req.body.title },
    req.file,
    req.user!.id,
  );
  sendCreated(res, doc, 'Document uploaded');
});

export const download = asyncHandler(async (req, res) => {
  const doc = await svc.getDoc(req.params.id);
  if (!canRead(req, doc.userId)) throw AppError.forbidden();
  await recordEvent({ action: 'FILE_DOWNLOAD', entityType: 'PersonalDocument', entityId: doc.id });
  await streamDownload(res, doc.filePath, doc.originalFileName, contentTypeForExt(getExtension(doc.originalFileName)), { inline: true });
});

export const remove = asyncHandler(async (req, res) => {
  const doc = await svc.getDoc(req.params.id);
  if (!canWrite(req, doc.userId)) throw AppError.forbidden();
  sendSuccess(res, await svc.deletePersonalDoc(req.params.id), 'Document deleted');
});
