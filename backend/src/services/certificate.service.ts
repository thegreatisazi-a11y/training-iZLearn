import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { renderPdfFromHtml } from '../utils/pdfGenerator';
import * as storage from './storage.service';
import { generateCertificateNumber } from '../utils/certificateNumber';
import { formatDate } from '../utils/dateUtils';
import { escapeHtml } from '../utils/reportHeader';
import { getOrgInfo } from './systemConfig.service';
import { getDefaultTemplate } from './certificateTemplate.service';
import { recordEvent } from './auditTrail.service';
import { renderCertificateTemplateHtml, type CertificatePlaceholderData } from '@izlearn/shared';

interface CertContext {
  isInduction: boolean;
  orgName: string;
  logoPath: string;
  signatoryName: string;
  signatoryTitle: string;
  fullName: string;
  employeeId: string;
  topicTitle: string;
  topicCode: string;
  topicVersion: number | null;
  score: number | null;
  completionDate: string;
  certificateNumber: string;
}

function renderCertificateHtml(c: CertContext): string {
  const accent = c.isInduction ? '#7c3aed' : '#0f766e';
  const heading = c.isInduction ? 'Induction Training Certificate' : 'Certificate of Training Completion';
  const logo = /^(https?:|data:)/.test(c.logoPath) ? `<img src="${c.logoPath}" style="height:48px;" />` : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page { size: A4 landscape; margin: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; margin:0; }
    .frame { margin:18px; border:6px double ${accent}; padding:40px 60px; height:calc(100% - 36px); position:relative; text-align:center; }
    .wm { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); font-size:120px; color:${accent}; opacity:.06; font-weight:bold; }
    h1 { color:${accent}; font-size:30px; margin:18px 0 4px; }
    .name { font-size:34px; margin:18px 0; border-bottom:2px solid #999; display:inline-block; padding:0 30px 6px; }
    .meta { font-size:15px; color:#333; margin:6px 0; }
    .sig { margin-top:60px; display:flex; justify-content:space-between; font-size:13px; }
    .sig div { border-top:1px solid #333; padding-top:6px; width:240px; }
    .cn { position:absolute; bottom:18px; right:24px; font-size:11px; color:#666; }
  </style></head><body>
    <div class="frame">
      <div class="wm">${escapeHtml(c.orgName)}</div>
      ${logo}
      <div class="meta"><strong>${escapeHtml(c.orgName)}</strong></div>
      <h1>${heading}</h1>
      <div class="meta">This is to certify that</div>
      <div class="name">${escapeHtml(c.fullName)} (${escapeHtml(c.employeeId)})</div>
      <div class="meta">has successfully completed the training</div>
      <div class="meta"><strong>${escapeHtml(c.topicTitle)}</strong> &nbsp;[${escapeHtml(c.topicCode)}]${c.topicVersion !== null ? ` &nbsp;<span style="color:#666;">Version ${c.topicVersion}</span>` : ''}</div>
      ${c.score !== null ? `<div class="meta">Score achieved: <strong>${c.score}%</strong></div>` : ''}
      <div class="meta">Completion Date: ${escapeHtml(c.completionDate)}</div>
      <div class="sig">
        <div>${escapeHtml(c.signatoryName)}<br/><span style="color:#666;">${escapeHtml(c.signatoryTitle)}</span></div>
        <div>Authorised Signatory</div>
      </div>
      <div class="cn">Certificate No: ${escapeHtml(c.certificateNumber)}</div>
    </div>
  </body></html>`;
}

/** Generate (idempotently) the PDF certificate for a passed attempt. */
export async function issueForAttempt(attemptId: string) {
  const existing = await prisma.certificate.findFirst({ where: { attemptId, isDeleted: false } });
  if (existing) return existing;

  const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) throw AppError.notFound('Attempt not found');
  if (!attempt.isPassed) throw AppError.badRequest('A certificate can only be issued for a passed attempt.');

  const [user, topic, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: attempt.userId } }),
    prisma.trainingTopic.findUnique({ where: { id: attempt.topicId } }),
    getOrgInfo(),
  ]);
  if (!user || !topic) throw AppError.notFound('User or topic not found');

  const certificateNumber = generateCertificateNumber();
  const isInduction = topic.trainingType === 'INDUCTION';
  const key = `certificates/${certificateNumber}.pdf`;

  const completionDate = formatDate(attempt.completedAt ?? new Date(), org.timezone);

  // Use the admin-configured default template for this certificate type when one
  // exists; otherwise fall back to the built-in default layout (UR-36 / Module 8).
  const template = await getDefaultTemplate(isInduction ? 'INDUCTION' : 'TRAINING');
  let html: string;
  let landscape = true;
  let pageFormat: 'A4' | 'Letter' = 'A4';

  if (template) {
    const data: CertificatePlaceholderData = {
      employeeName: user.fullName,
      employeeId: user.employeeId,
      topicName: topic.title,
      topicCode: topic.topicCode,
      topicVersion: String(attempt.topicVersion ?? topic.currentVersion),
      completionDate,
      score: attempt.score !== null && attempt.score !== undefined ? String(attempt.score) : '',
      certificateNumber,
      orgName: org.name,
    };
    html = renderCertificateTemplateHtml(template, data);
    landscape = template.orientation === 'LANDSCAPE';
    pageFormat = template.pageSize === 'LETTER' ? 'Letter' : 'A4';
  } else {
    html = renderCertificateHtml({
      isInduction,
      orgName: org.name,
      logoPath: org.logoPath,
      signatoryName: org.signatoryName,
      signatoryTitle: org.signatoryTitle,
      fullName: user.fullName,
      employeeId: user.employeeId,
      topicTitle: topic.title,
      topicCode: topic.topicCode,
      topicVersion: attempt.topicVersion ?? topic.currentVersion,
      score: attempt.score ?? null,
      completionDate,
      certificateNumber,
    });
  }

  const pdf = await renderPdfFromHtml(html, { landscape, format: pageFormat });
  await storage.putBuffer(key, pdf, 'application/pdf');

  const cert = await prisma.certificate.create({
    data: {
      userId: user.id,
      topicId: topic.id,
      topicVersion: attempt.topicVersion ?? topic.currentVersion,
      attemptId,
      certificateNumber,
      filePath: key,
      certificateType: isInduction ? 'INDUCTION' : 'TRAINING',
      createdBy: user.id,
    },
  });
  await recordEvent({ action: 'CERTIFICATE_GENERATED', entityType: 'Certificate', entityId: cert.id, newValue: { certificateNumber } });
  return cert;
}

export async function listCertificates(filters: { userId?: string }) {
  return prisma.certificate.findMany({
    where: { isDeleted: false, ...(filters.userId ? { userId: filters.userId } : {}) },
    orderBy: { issuedAt: 'desc' },
  });
}

export async function getCertificate(id: string) {
  const cert = await prisma.certificate.findFirst({ where: { id, isDeleted: false } });
  if (!cert) throw AppError.notFound('Certificate not found');
  return cert;
}
