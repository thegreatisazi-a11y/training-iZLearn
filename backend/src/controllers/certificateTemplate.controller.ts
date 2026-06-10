import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated } from '../utils/response';
import { recordEvent } from '../services/auditTrail.service';
import * as svc from '../services/certificateTemplate.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const data = await svc.listTemplates({
    certificateType: typeof req.query.certificateType === 'string' ? req.query.certificateType : undefined,
    includeInactive: String(req.query.includeInactive ?? 'false') === 'true',
  });
  sendSuccess(res, data);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getTemplate(req.params.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const t = await svc.createTemplate(req.body, req.user!.id);
  sendCreated(res, t, 'Certificate template created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.updateTemplate(req.params.id, req.body), 'Certificate template updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.deleteTemplate(req.params.id), 'Certificate template deleted');
});

export const setDefault = asyncHandler(async (req: Request, res: Response) => {
  const t = await svc.setDefault(req.params.id);
  sendSuccess(res, t, 'Template set as default');
});

export const duplicate = asyncHandler(async (req: Request, res: Response) => {
  const t = await svc.duplicateTemplate(req.params.id, req.user!.id);
  sendCreated(res, t, 'Template duplicated');
});

export const preview = asyncHandler(async (req: Request, res: Response) => {
  const pdf = await svc.previewTemplatePdf(req.params.id);
  await recordEvent({ action: 'PRINT', entityType: 'CertificateTemplate', entityId: req.params.id, newValue: { preview: true } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="certificate-preview.pdf"');
  res.send(pdf);
});
