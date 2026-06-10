import { z } from 'zod';
import { certificateType } from './enums';

/**
 * Certificate Template Manager (Admin) — a fully configurable certificate layout.
 * The same pure renderer (`renderCertificateTemplateHtml`) is used by the backend
 * for PDF generation (Puppeteer) AND by the frontend for the live preview, so the
 * preview always matches the generated PDF byte-for-byte in layout.
 */

export const pageOrientation = z.enum(['PORTRAIT', 'LANDSCAPE']);
export type PageOrientation = z.infer<typeof pageOrientation>;

export const pageSize = z.enum(['A4', 'LETTER']);
export type PageSize = z.infer<typeof pageSize>;

export const FONT_FAMILIES = ['Arial', 'Times New Roman', 'Georgia', 'Calibri', 'Helvetica'] as const;

/** Placeholders that can be inserted into any text field via the toolbar. */
export const CERT_PLACEHOLDERS = [
  { token: '{{employeeName}}', label: 'Employee Name' },
  { token: '{{employeeId}}', label: 'Employee ID' },
  { token: '{{topicName}}', label: 'Topic Name' },
  { token: '{{topicCode}}', label: 'Topic Code' },
  { token: '{{topicVersion}}', label: 'Topic Version' },
  { token: '{{completionDate}}', label: 'Completion Date' },
  { token: '{{score}}', label: 'Score' },
  { token: '{{certificateNumber}}', label: 'Certificate No.' },
  { token: '{{orgName}}', label: 'Organisation Name' },
] as const;

const colorString = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: 'Must be a hex colour, e.g. #0f766e' });

/** A string that may hold a URL, a data: URI (uploaded image), or be empty. */
const imageRef = z.string().max(5_000_000).optional().or(z.literal('').transform(() => undefined));

export const certificateTemplateSchema = z.object({
  templateName: z.string().min(1, { message: 'Template name is required' }),
  certificateType,
  isActive: z.boolean().default(true),
  orientation: pageOrientation.default('LANDSCAPE'),
  pageSize: pageSize.default('A4'),
  backgroundImagePath: imageRef,
  logoPath: imageRef,
  primaryColor: colorString.default('#0f766e'),
  secondaryColor: colorString.default('#334155'),
  fontFamily: z.enum(FONT_FAMILIES).default('Georgia'),
  headerText: z.string().default('Certificate of Training Completion'),
  subHeaderText: z.string().default('This is to certify that'),
  bodyText: z.string().default(''),
  footerText: z.string().default('Certificate No: {{certificateNumber}}'),
  signatory1Name: z.string().optional(),
  signatory1Title: z.string().optional(),
  signatory1SignatureImagePath: imageRef,
  signatory2Name: z.string().optional(),
  signatory2Title: z.string().optional(),
  signatory2SignatureImagePath: imageRef,
  showBorder: z.boolean().default(true),
  borderColor: colorString.default('#0f766e'),
  borderWidth: z.coerce.number().int().min(0).max(40).default(6),
  watermarkText: z.string().optional(),
  showWatermark: z.boolean().default(true),
});
export type CertificateTemplateInput = z.infer<typeof certificateTemplateSchema>;

/** Update is a partial of the create schema (every field optional). */
export const updateCertificateTemplateSchema = certificateTemplateSchema.partial();
export type UpdateCertificateTemplateInput = z.infer<typeof updateCertificateTemplateSchema>;

// ---- Rendering -------------------------------------------------------------

export interface CertificatePlaceholderData {
  employeeName: string;
  employeeId: string;
  topicName: string;
  topicCode: string;
  topicVersion: string;
  completionDate: string;
  score: string;
  certificateNumber: string;
  orgName: string;
}

/** Sample data used for the live preview / preview PDF. */
export const SAMPLE_CERT_DATA: CertificatePlaceholderData = {
  employeeName: 'Jordan Sample',
  employeeId: 'EMP-1024',
  topicName: 'Good Documentation Practices',
  topicCode: 'TRN-2026-0001',
  topicVersion: '1',
  completionDate: '03/06/2026',
  score: '92',
  certificateNumber: 'CERT-20260603-AB12CD34',
  orgName: 'izLearn Pharmaceuticals',
};

export type CertificateTemplateLike = Partial<CertificateTemplateInput> & {
  certificateType?: string;
};

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replace {{placeholders}} with data, escaping the substituted values. */
export function applyPlaceholders(text: string, data: CertificatePlaceholderData): string {
  return esc(text ?? '').replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = (data as unknown as Record<string, string>)[key];
    return v === undefined ? `{{${key}}}` : esc(v);
  });
}

function isRenderableImage(s?: string): boolean {
  return !!s && /^(https?:|data:)/.test(s);
}

/**
 * Render a complete, self-contained HTML document for a certificate template.
 * Pure & isomorphic — used by the backend (Puppeteer → PDF) and the frontend
 * (iframe live preview). No DOM / Node APIs are used.
 */
export function renderCertificateTemplateHtml(
  t: CertificateTemplateLike,
  data: CertificatePlaceholderData,
): string {
  const orientation = t.orientation ?? 'LANDSCAPE';
  const size = (t.pageSize ?? 'A4').toLowerCase();
  const primary = t.primaryColor || '#0f766e';
  const secondary = t.secondaryColor || '#334155';
  const font = t.fontFamily || 'Georgia';
  const border =
    t.showBorder === false
      ? 'none'
      : `${t.borderWidth ?? 6}px double ${t.borderColor || primary}`;
  const wmText = t.watermarkText || data.orgName;

  const logo = isRenderableImage(t.logoPath) ? `<img class="logo" src="${t.logoPath}" />` : '';
  const bg = isRenderableImage(t.backgroundImagePath)
    ? `background-image:url('${t.backgroundImagePath}');background-size:cover;background-position:center;`
    : '';

  const sigBlock = (name?: string, title?: string, img?: string) => {
    if (!name && !title && !isRenderableImage(img)) return '';
    const sigImg = isRenderableImage(img) ? `<img class="sigimg" src="${img}" />` : '<div class="sigspace"></div>';
    return `<div class="sig">
      ${sigImg}
      <div class="signame">${esc(name || '')}</div>
      <div class="sigtitle">${esc(title || '')}</div>
    </div>`;
  };

  const s1 = sigBlock(t.signatory1Name, t.signatory1Title, t.signatory1SignatureImagePath);
  const s2 = sigBlock(t.signatory2Name, t.signatory2Title, t.signatory2SignatureImagePath);

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page { size: ${size} ${orientation.toLowerCase()}; margin: 0; }
    html,body { margin:0; height:100%; }
    body { font-family: ${esc(font)}, 'Times New Roman', serif; }
    .frame {
      box-sizing:border-box; margin:18px; border:${border};
      padding:36px 56px; height:calc(100% - 36px); position:relative; text-align:center;
      ${bg}
    }
    .logo { max-height:60px; margin-bottom:8px; }
    .wm { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg);
      font-size:110px; color:${primary}; opacity:.07; font-weight:bold; white-space:nowrap; pointer-events:none; }
    .org { font-size:15px; color:${secondary}; font-weight:bold; letter-spacing:1px; }
    h1 { color:${primary}; font-size:30px; margin:14px 0 6px; }
    .sub { font-size:16px; color:${secondary}; margin:6px 0; }
    .body { font-size:18px; color:${secondary}; line-height:1.5; margin:18px auto; max-width:80%; }
    .name { font-size:30px; color:${primary}; margin:10px 0; border-bottom:2px solid ${secondary}; display:inline-block; padding:0 26px 6px; }
    .footer { position:absolute; bottom:22px; left:0; right:0; font-size:12px; color:${secondary}; }
    .sigs { position:absolute; bottom:54px; left:0; right:0; display:flex; justify-content:space-around; padding:0 40px; }
    .sig { font-size:13px; color:${secondary}; min-width:200px; }
    .sigimg { max-height:46px; display:block; margin:0 auto 2px; }
    .sigspace { height:46px; }
    .signame { border-top:1px solid ${secondary}; padding-top:4px; font-weight:bold; }
    .sigtitle { color:${secondary}; opacity:.8; }
  </style></head><body>
    <div class="frame">
      ${t.showWatermark === false ? '' : `<div class="wm">${esc(wmText)}</div>`}
      ${logo}
      <div class="org">${esc(data.orgName)}</div>
      <h1>${applyPlaceholders(t.headerText || '', data)}</h1>
      <div class="sub">${applyPlaceholders(t.subHeaderText || '', data)}</div>
      <div class="name">${esc(data.employeeName)}</div>
      <div class="body">${applyPlaceholders(t.bodyText || '', data)}</div>
      <div class="sigs">${s1}${s2}</div>
      <div class="footer">${applyPlaceholders(t.footerText || '', data)}</div>
    </div>
  </body></html>`;
}
