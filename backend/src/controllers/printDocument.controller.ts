import type { Request, Response } from 'express';
import { asyncHandler, AppError } from '../utils/response';
import { exportFilename } from '@izlearn/shared';
import { hasPermission } from '../utils/permissions';
import { recordEvent } from '../services/auditTrail.service';
import { getOrgInfo } from '../services/systemConfig.service';
import { renderDocumentPdf } from '../utils/printDocument';
import { PRINT_DOCUMENTS } from '../services/printDocument.service';
import type { PermissionAction } from '@izlearn/shared';

/**
 * Render one printable document as a PDF.
 *
 * `GET /api/print/:docType` - the single entry point for every print and "Export PDF" button
 * in the app. The document type selects a builder from the registry, which re-reads the record
 * under this caller's permissions; the caller supplies identifiers and filters only, never
 * content.
 *
 * `?download=true` sends it as an attachment (Export PDF); otherwise it is served inline so
 * the browser's PDF viewer can open and print it. Printing an already-rendered PDF is what
 * removes the browser's own header/footer - Chrome only draws those for HTML print jobs, so
 * they cannot be suppressed from a page that the browser itself lays out.
 */
export const render = asyncHandler(async (req: Request, res: Response) => {
  const docType = req.params.docType;
  const def = PRINT_DOCUMENTS[docType];
  if (!def) throw AppError.notFound(`Unknown document type "${docType}".`);

  // Permission is declared per document type, so it is checked here rather than as route
  // middleware (the route cannot know which document is being asked for).
  const [module, action] = def.permission;
  if (!hasPermission(req.user!.permissions, module, action as PermissionAction)) {
    await recordEvent({
      action: 'ACCESS_DENIED',
      entityType: 'Module',
      entityId: module,
      newValue: { requiredAction: action, document: docType, roles: req.user!.roleNames },
    });
    throw AppError.forbidden(`You do not have "${action}" permission on ${module}.`);
  }

  // Only strings are forwarded; arrays (?a=1&a=2) and nested objects are dropped rather than
  // reaching a builder that expects a scalar.
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') params[k] = v;
  }

  const [doc, org] = await Promise.all([
    def.build({ requester: req.user!, params }),
    getOrgInfo(),
  ]);

  const pdf = await renderDocumentPdf({
    title: doc.title,
    bodyHtml: doc.bodyHtml,
    orgName: org.name,
    orgLogoPath: org.logoPath,
    generatedByName: req.user!.fullName,
    generatedByEmployeeId: req.user!.employeeId,
    timezone: org.timezone,
    landscape: doc.landscape,
  });

  // 21 CFR 11.10(e): the act of producing the record is itself recorded. This is the only
  // trace a printed document leaves, so it is written for print and download alike.
  await recordEvent({
    action: 'PRINT',
    entityType: doc.entityType,
    entityId: doc.entityId,
    newValue: { document: docType, title: doc.title, download: req.query.download === 'true' },
  });

  const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${exportFilename(docType, 'pdf')}"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.end(pdf);
});
