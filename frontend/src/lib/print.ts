/**
 * Lightweight client-side print helper. Opens a clean, self-contained document in
 * a new window and triggers the browser's print dialog (which can "print to PDF").
 * No server-side PDF dependency. The caller supplies a title and the body markup
 * (already-escaped/sanitised); a minimal print stylesheet is injected.
 */
export function printHtml(title: string, bodyHtml: string, meta?: { printedBy?: string }): void {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return; // popup blocked — nothing we can do silently
  // CR-23: stamp every printout with title, printed-by and date/time. The repeating
  // footer reprints on each page; the browser adds page numbers in its print
  // header/footer, and the server-side report PDFs include explicit "Page X of Y".
  const stamp = new Date().toLocaleString();
  const printedBy = meta?.printedBy ? `Printed by ${escapeHtml(meta.printedBy)} · ` : '';
  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1e293b; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { color: #475569; font-weight: 600; background: #f8fafc; }
  .section { font-size: 13px; font-weight: 600; color: #334155; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .03em; }
  .meta { font-size: 12px; color: #475569; }
  .print-foot { position: fixed; bottom: 0; left: 0; right: 0; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding: 4px 0; }
  @media print { body { margin: 0; } @page { margin: 16mm; } }
</style>
</head>
<body>
<div class="print-foot">${printedBy}Generated ${escapeHtml(stamp)}</div>
${bodyHtml}
<script>window.onload = function(){ window.focus(); window.print(); };</script>
</body>
</html>`);
  win.document.close();
}

/** Escape a string for safe insertion into the printable HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build a simple `<table>` from headers + rows for the printable view. */
export function printTable(headers: string[], rows: Array<Array<unknown>>): string {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
