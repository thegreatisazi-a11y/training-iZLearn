import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { AppError } from '../utils/response';
import { renderPdfFromHtml } from '../utils/pdfGenerator';
import { getOrgInfo } from './systemConfig.service';
import {
  renderCertificateTemplateHtml,
  SAMPLE_CERT_DATA,
  type CertificateTemplateInput,
  type UpdateCertificateTemplateInput,
  type CertificatePlaceholderData,
} from '@izlearn/shared';

/**
 * Certificate Template Manager (Admin). Templates are versionable, soft-deleted,
 * and one default per certificate type. All mutations are captured automatically
 * by the Prisma audit middleware (CertificateTemplate is an audited model).
 */

export async function listTemplates(filters: { certificateType?: string; includeInactive?: boolean }) {
  const where: Prisma.CertificateTemplateWhereInput = {
    isDeleted: false,
    ...(filters.certificateType ? { certificateType: filters.certificateType as never } : {}),
    ...(filters.includeInactive ? {} : {}),
  };
  return prisma.certificateTemplate.findMany({ where, orderBy: [{ certificateType: 'asc' }, { createdAt: 'desc' }] });
}

export async function getTemplate(id: string) {
  const t = await prisma.certificateTemplate.findFirst({ where: { id, isDeleted: false } });
  if (!t) throw AppError.notFound('Certificate template not found');
  return t;
}

export async function createTemplate(input: CertificateTemplateInput, createdBy: string) {
  return prisma.certificateTemplate.create({ data: { ...sanitize(input), createdBy } });
}

export async function updateTemplate(id: string, input: UpdateCertificateTemplateInput) {
  await getTemplate(id);
  return prisma.certificateTemplate.update({ where: { id }, data: sanitize(input) });
}

/** Soft-delete (never hard-delete). A default template cannot be deleted. */
export async function deleteTemplate(id: string) {
  const t = await getTemplate(id);
  if (t.isDefault) throw AppError.badRequest('A default template cannot be deleted. Set another default first.');
  return prisma.certificateTemplate.update({ where: { id }, data: { isDeleted: true, isActive: false } });
}

/** One default per certificate type — atomically clears the prior default. */
export async function setDefault(id: string) {
  const t = await getTemplate(id);
  return auditedTransaction(prisma, async (tx) => {
    await tx.certificateTemplate.updateMany({
      where: { certificateType: t.certificateType, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
    const updated = await tx.certificateTemplate.update({
      where: { id },
      data: { isDefault: true, isActive: true },
    });
    return {
      result: updated,
      audits: [
        {
          action: 'CONFIG_CHANGE',
          entityType: 'CertificateTemplate',
          entityId: id,
          newValue: { isDefault: true, certificateType: t.certificateType },
        },
      ],
    };
  });
}

export async function duplicateTemplate(id: string, createdBy: string) {
  const t = await getTemplate(id);
  const { id: _id, createdAt: _c, updatedAt: _u, isDeleted: _d, isDefault: _df, createdBy: _cb, ...rest } = t;
  return prisma.certificateTemplate.create({
    data: { ...rest, templateName: `Copy of ${t.templateName}`, isDefault: false, createdBy },
  });
}

/** Render a preview PDF for a template using sample placeholder data. */
export async function previewTemplatePdf(id: string): Promise<Buffer> {
  const t = await getTemplate(id);
  const org = await getOrgInfo();
  const data: CertificatePlaceholderData = { ...SAMPLE_CERT_DATA, orgName: org.name };
  const html = renderCertificateTemplateHtml(t, data);
  return renderPdfFromHtml(html, { landscape: t.orientation === 'LANDSCAPE', format: t.pageSize as 'A4' | 'Letter' });
}

/** Resolve the default template for a certificate type (null → built-in fallback). */
export async function getDefaultTemplate(certificateType: 'TRAINING' | 'INDUCTION') {
  return prisma.certificateTemplate.findFirst({
    where: { certificateType, isDefault: true, isActive: true, isDeleted: false },
  });
}

/** Strip cross-cutting fields and undefineds before persistence. */
function sanitize<T extends Record<string, unknown>>(input: T) {
  const { reasonForChange: _r, signature: _s, ...rest } = input as Record<string, unknown>;
  return rest as Omit<T, 'reasonForChange' | 'signature'>;
}
