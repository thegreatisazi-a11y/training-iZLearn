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
  /** Organisation name shown at the top. Blank → falls back to System Config `org.name`. */
  orgName: z.string().optional(),
  headerText: z.string().default('Certificate of Training Completion'),
  subHeaderText: z.string().default('This is to certify that'),
  bodyText: z.string().default(''),
  footerText: z.string().default('Certificate No: {{certificateNumber}}'),
  // Per-field text sizes (px). Each certificate field is independently sizable so
  // the layout can be tuned without touching the others.
  orgFontSize: z.coerce.number().int().min(6).max(96).default(15),
  headerFontSize: z.coerce.number().int().min(8).max(120).default(30),
  subHeaderFontSize: z.coerce.number().int().min(6).max(96).default(16),
  nameFontSize: z.coerce.number().int().min(8).max(120).default(30),
  bodyFontSize: z.coerce.number().int().min(6).max(96).default(18),
  footerFontSize: z.coerce.number().int().min(6).max(72).default(12),
  signatoryFontSize: z.coerce.number().int().min(6).max(72).default(13),
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

// The renderer is fed both validated form input (narrow enums, `undefined` for
// absent fields) and raw Prisma rows (enum columns surface as plain `string`,
// optional columns as `T | null`). It treats every field loosely
// (`t.fontFamily || 'Georgia'`, `isRenderableImage(t.logoPath)`, etc.), so this
// adapter type widens enums to `string` and allows `null` on every field to
// accept either source without a cast at the call site.
type Loosen<T> = { [K in keyof T]?: T[K] | null };
export type CertificateTemplateLike = Omit<
  Loosen<CertificateTemplateInput>,
  'certificateType' | 'orientation' | 'pageSize' | 'fontFamily'
> & {
  certificateType?: string | null;
  orientation?: string | null;
  pageSize?: string | null;
  fontFamily?: string | null;
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

function isRenderableImage(s?: string | null): boolean {
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
  // Organisation name: template override, else the System Config value passed in `data`.
  const orgName = (t.orgName && t.orgName.trim()) || data.orgName;
  const wmText = t.watermarkText || orgName;

  // Per-field text sizes (px), each with the built-in default when unset.
  const orgSize = t.orgFontSize ?? 15;
  const headerSize = t.headerFontSize ?? 30;
  const subHeaderSize = t.subHeaderFontSize ?? 16;
  const nameSize = t.nameFontSize ?? 30;
  const bodySize = t.bodyFontSize ?? 18;
  const footerSize = t.footerFontSize ?? 12;
  const sigSize = t.signatoryFontSize ?? 13;

  const logo = isRenderableImage(t.logoPath) ? `<img class="logo" src="${t.logoPath}" />` : '';
  const bg = isRenderableImage(t.backgroundImagePath)
    ? `background-image:url('${t.backgroundImagePath}');background-size:cover;background-position:center;`
    : '';

  const sigBlock = (name?: string | null, title?: string | null, img?: string | null) => {
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

  // Render each field only when it has content so the stack auto-reflows (no empty
  // gaps) when a field is left blank / removed. `name` is always present (the
  // recipient) and the signatures/footer keep their fixed anchor at the bottom.
  const headerHtml = applyPlaceholders(t.headerText || '', data);
  const subHtml = applyPlaceholders(t.subHeaderText || '', data);
  const bodyHtml = applyPlaceholders(t.bodyText || '', data);
  const footerHtml = applyPlaceholders(t.footerText || '', data);
  const orgHtml = esc(orgName);
  const block = (cls: string, html: string) => (html.trim() ? `<div class="${cls}">${html}</div>` : '');

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page { size: ${size} ${orientation.toLowerCase()}; margin: 0; }
    * { box-sizing:border-box; }
    html,body { margin:0; height:100%; overflow:hidden; }
    body { font-family: ${esc(font)}, 'Times New Roman', serif; }
    /* The frame is pinned to the page with a fixed 18px inset (absolute rather than
       height:calc + margin) so the content is always exactly one page — no stray
       blank second page from sub-pixel height rounding. overflow:hidden keeps the
       diagonal watermark clipped inside the border. */
    .frame {
      position:absolute; top:18px; left:18px; right:18px; bottom:18px;
      border:${border}; padding:48px 60px; text-align:center; overflow:hidden;
      /* Distribute the fields evenly down the page: org flush at the top, footer flush
         at the bottom, with an equal gap between every field. Removing a field simply
         re-balances the gaps. */
      display:flex; flex-direction:column; align-items:center; justify-content:space-between;
      ${bg}
    }
    .logo { max-height:60px; margin-bottom:12px; }
    /* Watermark: fixed size (identical in the live preview and the PDF) and clipped by
       the frame's overflow, so it never spills past the certificate border. */
    .wm { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-28deg);
      font-size:${orientation.toUpperCase() === 'PORTRAIT' ? 46 : 66}px; color:${primary}; opacity:.07; font-weight:bold;
      white-space:nowrap; pointer-events:none; }
    /* Flex children — vertical gaps come from the frame's space-between, so no margins. */
    .org { font-size:${orgSize}px; color:${secondary}; font-weight:bold; letter-spacing:1px; margin:0; }
    h1 { color:${primary}; font-size:${headerSize}px; margin:0; }
    .sub { font-size:${subHeaderSize}px; color:${secondary}; margin:0; }
    .name { font-size:${nameSize}px; color:${primary}; margin:0; border-bottom:2px solid ${secondary}; display:inline-block; padding:0 30px 8px; }
    .body { font-size:${bodySize}px; color:${secondary}; line-height:1.6; margin:0; max-width:78%; }
    .sigs { width:100%; display:flex; justify-content:space-around; padding:0 40px; }
    .sig { font-size:${sigSize}px; color:${secondary}; min-width:200px; }
    .footer { width:100%; font-size:${footerSize}px; color:${secondary}; }
    .sigimg { max-height:46px; display:block; margin:0 auto 2px; }
    .sigspace { height:46px; }
    .signame { border-top:1px solid ${secondary}; padding-top:4px; font-weight:bold; }
    .sigtitle { color:${secondary}; opacity:.8; }
  </style></head><body>
    <div class="frame">
      ${t.showWatermark === false ? '' : `<div class="wm">${esc(wmText)}</div>`}
      ${logo}
      ${block('org', orgHtml)}
      ${headerHtml.trim() ? `<h1>${headerHtml}</h1>` : ''}
      ${block('sub', subHtml)}
      <div class="name">${esc(data.employeeName)}</div>
      ${block('body', bodyHtml)}
      ${s1 || s2 ? `<div class="sigs">${s1}${s2}</div>` : ''}
      ${footerHtml.trim() ? `<div class="footer">${footerHtml}</div>` : ''}
    </div>
  </body></html>`;
}
