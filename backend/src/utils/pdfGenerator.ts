import fs from 'fs';
import puppeteer, { Browser } from 'puppeteer';
import { logger } from '../config/logger';

export interface PdfOptions {
  headerHtml?: string;
  footerHtml?: string;
  landscape?: boolean;
  format?: 'A4' | 'Letter';
  /** Override page margins. Pass all-'0' for full-bleed designs (certificates). */
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  /** Honour the HTML's own `@page` size/margins (full-bleed certificates) instead of format+margin. */
  preferCSSPageSize?: boolean;
}

let browserPromise: Promise<Browser> | null = null;

/** True when this browser handle is still usable (puppeteer ≥22 exposes `connected`). */
function isAlive(b: Browser): boolean {
  const withConnected = b as unknown as { connected?: boolean; isConnected?: () => boolean };
  if (typeof withConnected.connected === 'boolean') return withConnected.connected;
  if (typeof withConnected.isConnected === 'function') return withConnected.isConnected();
  return true;
}

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    // A CRASHED browser must not be reused. The instance is cached for the process lifetime, and
    // Chromium dies for reasons that have nothing to do with the next caller — an OOM kill while
    // rendering a large table is the common one on a small container. The cached handle then stays
    // resolved but disconnected, so every later render failed with "Target closed" and the API
    // reported "PDF export is unavailable on this server" forever, until the process restarted.
    try {
      const existing = await browserPromise;
      if (isAlive(existing)) return existing;
    } catch {
      /* fall through and relaunch */
    }
    browserPromise = null;
  }

  browserPromise = puppeteer.launch({
    headless: true,
    // Use a system Chromium when provided (Docker / Windows); otherwise the bundled one.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    // Trimmed for a small container: the API runs on a 512 MB instance, where Chromium's default
    // extras (GPU/rasteriser, background networking, sync, default apps) are pure overhead and the
    // difference between rendering a report and being OOM-killed.
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-background-networking',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
    ],
  });
  // Never cache a rejected launch — otherwise a single transient failure (e.g.
  // a missing browser) would permanently break PDF generation until restart.
  browserPromise.catch(() => {
    browserPromise = null;
  });
  // Drop the handle as soon as the browser goes away, so the next call relaunches instead of
  // waiting to discover the corpse.
  browserPromise
    .then((b) => {
      b.once('disconnected', () => {
        browserPromise = null;
        logger.warn('Puppeteer browser disconnected — it will be relaunched on the next PDF render.');
      });
    })
    .catch(() => undefined);
  return browserPromise;
}

/** Errors that mean "the browser went away" rather than "this document is bad". */
function isBrowserGone(e: unknown): boolean {
  const m = (e as Error)?.message ?? '';
  return /Target closed|Session closed|Protocol error|Connection closed|browser has disconnected|socket hang up/i.test(m);
}

/**
 * Render an HTML string to a PDF Buffer (used by reports & certificates).
 *
 * Retried once when the browser dies: Chromium can be killed mid-render (memory pressure on a
 * small container), and that is a transient condition — the second attempt gets a freshly launched
 * browser. Anything else fails immediately, so a genuinely broken document is not retried.
 */
export async function renderPdfFromHtml(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  try {
    return await renderOnce(html, opts);
  } catch (e) {
    if (!isBrowserGone(e)) throw e;
    logger.warn(`PDF render lost the browser (${(e as Error).message}); relaunching and retrying once.`);
    browserPromise = null;
    return renderOnce(html, opts);
  }
}

/**
 * Shut the browser down once it has been idle for a while.
 *
 * A resident Chromium costs on the order of a hundred megabytes even with no page open. On a
 * 512 MB instance that is memory the API needs, and PDFs are generated rarely (an export, a
 * certificate) rather than continuously — so the browser is kept warm only long enough to serve a
 * burst, then released. Renders in progress hold it open via `activeRenders`.
 */
const IDLE_SHUTDOWN_MS = parseInt(process.env.PDF_BROWSER_IDLE_MS || '60000', 10);
let activeRenders = 0;
let idleTimer: NodeJS.Timeout | null = null;

function cancelIdleShutdown() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleShutdown() {
  cancelIdleShutdown();
  if (IDLE_SHUTDOWN_MS <= 0) return; // opt out with PDF_BROWSER_IDLE_MS=0 (keeps it warm)
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (activeRenders > 0) return;
    void closeBrowser();
  }, IDLE_SHUTDOWN_MS);
  // Never hold the process open just for this timer.
  idleTimer.unref?.();
}

async function renderOnce(html: string, opts: PdfOptions): Promise<Buffer> {
  activeRenders += 1;
  cancelIdleShutdown();
  try {
    return await renderPage(html, opts);
  } finally {
    activeRenders -= 1;
    if (activeRenders === 0) scheduleIdleShutdown();
  }
}

async function renderPage(html: string, opts: PdfOptions): Promise<Buffer> {
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
      preferCSSPageSize: Boolean(opts.preferCSSPageSize),
      displayHeaderFooter,
      headerTemplate: opts.headerHtml || '<span></span>',
      footerTemplate: opts.footerHtml || '<span></span>',
      margin: opts.margin ?? {
        top: opts.headerHtml ? '100px' : '40px',
        bottom: opts.footerHtml ? '80px' : '40px',
        left: '24px',
        right: '24px',
      },
    });
    return Buffer.from(pdf);
  } finally {
    // Closing a page whose browser has already died throws; that must not mask the real error.
    await page.close().catch(() => undefined);
  }
}

export async function htmlToPdfFile(html: string, filePath: string, opts: PdfOptions = {}): Promise<void> {
  const buf = await renderPdfFromHtml(html, opts);
  fs.writeFileSync(filePath, buf);
}

export async function closeBrowser(): Promise<void> {
  cancelIdleShutdown();
  if (browserPromise) {
    const pending = browserPromise;
    // Cleared FIRST: the close is awaited below, and a caller arriving meanwhile must launch a new
    // browser rather than receive the one being torn down.
    browserPromise = null;
    try {
      await (await pending).close();
    } catch (e) {
      logger.warn('Failed to close puppeteer browser', { e: (e as Error).message });
    }
  }
}
