const path = require('path');

/**
 * Puppeteer configuration — where the Chrome download lives.
 *
 * WHY THIS FILE EXISTS
 *   Puppeteer defaults to caching Chrome in the HOME directory (`~/.cache/puppeteer`). On hosts
 *   that build and run in separate filesystem layers — Render's native Node runtime among them —
 *   anything outside the project directory is discarded after the build, so the browser downloaded
 *   by `npm install` is gone at runtime and every PDF render fails with:
 *
 *     Could not find Chrome (ver. …). … your cache path is incorrectly configured
 *     (which is: /opt/render/.cache/puppeteer)
 *
 *   That took out PDF export for the audit trail and reports, certificate generation, and the
 *   certificate-template preview — everything that renders through headless Chrome.
 *
 *   Pinning the cache INSIDE the repo puts it in the directory that is preserved, so the browser
 *   installed at build time is the one found at run time. The path is derived from this file's own
 *   location, so it resolves the same whether npm runs at the repo root or the app runs from
 *   backend/ (npm workspaces install to the root, but the API's working directory is backend/).
 *
 * NOTE
 *   The PUPPETEER_CACHE_DIR environment variable overrides this. The Docker image
 *   (backend/Dockerfile) takes a different route entirely: it installs a SYSTEM Chromium via apt
 *   and sets PUPPETEER_EXECUTABLE_PATH, with PUPPETEER_SKIP_DOWNLOAD=true so no download happens
 *   at all — this file is inert there.
 */
module.exports = {
  cacheDirectory: path.join(__dirname, '.cache', 'puppeteer'),
};
