/** Shared HTML email layout. Keeps every notification visually consistent. */
export function baseLayout(opts: { orgName: string; title: string; bodyHtml: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
        <strong style="font-size:18px;">${escape(opts.orgName)}</strong>
        <div style="font-size:12px;opacity:.85;">izLearn — Learning Management System</div>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <h2 style="margin-top:0;font-size:16px;">${escape(opts.title)}</h2>
        ${opts.bodyHtml}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
        <p style="font-size:11px;color:#6b7280;">
          This is an automated message from izLearn. Please do not reply to this email.
          This notification and its delivery are recorded for GxP compliance.
        </p>
      </div>
    </div>
  </body>
</html>`;
}

export function escape(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function paragraph(text: string): string {
  return `<p style="font-size:14px;line-height:1.5;">${text}</p>`;
}

export function infoTable(rows: Array<[string, string]>): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 8px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold;width:40%;">${escape(
            k,
          )}</td><td style="padding:6px 8px;border:1px solid #e5e7eb;">${escape(v)}</td></tr>`,
      )
      .join('')}
  </table>`;
}
