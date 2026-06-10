import fs from 'fs';
import puppeteer, { Browser } from 'puppeteer';
import { logger } from '../config/logger';

export interface PdfOptions {
  headerHtml?: string;
  footerHtml?: string;
  landscape?: boolean;
  format?: 'A4' | 'Letter';
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      // Use a system Chromium when provided (Docker / Windows); otherwise the bundled one.
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    // Never cache a rejected launch — otherwise a single transient failure (e.g.
    // a missing browser) would permanently break PDF generation until restart.
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

/** Render an HTML string to a PDF Buffer (used by reports & certificates). */
export async function renderPdfFromHtml(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Report/certificate HTML is self-contained — wait for DOM + a bounded settle
    // rather than 'networkidle0', which can hang for 30s on a missing logo/resource.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const displayHeaderFooter = Boolean(opts.headerHtml || opts.footerHtml);
    const pdf = await page.pdf({
      format: opts.format || 'A4',
      landscape: Boolean(opts.landscape),
      printBackground: true,
      displayHeaderFooter,
      headerTemplate: opts.headerHtml || '<span></span>',
      footerTemplate: opts.footerHtml || '<span></span>',
      margin: {
        top: opts.headerHtml ? '100px' : '40px',
        bottom: opts.footerHtml ? '80px' : '40px',
        left: '24px',
        right: '24px',
      },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function htmlToPdfFile(html: string, filePath: string, opts: PdfOptions = {}): Promise<void> {
  const buf = await renderPdfFromHtml(html, opts);
  fs.writeFileSync(filePath, buf);
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    try {
      (await browserPromise).close();
    } catch (e) {
      logger.warn('Failed to close puppeteer browser', { e: (e as Error).message });
    }
    browserPromise = null;
  }
}
