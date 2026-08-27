/**
 * Repair certificate template body text whose {{placeholders}} run together.
 *
 * BACKGROUND
 *   `bodyText` on a CertificateTemplate is admin-authored free text with {{placeholders}}.
 *   Templates authored as e.g. "{{employeeName}}{{employeeId}} has completed the training for
 *   {{topicName}}{{topicCode}}{{completionDate}}{{completionDate}} with {{score}}" render as
 *   "thatDarshit Sd has completed the training for test2TRN-2026-004966627/08/2627/08/26 with"
 *   — no spaces between substituted values, and a duplicated date.
 *
 * WHAT IT DOES (idempotent, dry-run by default)
 *   For every non-deleted CertificateTemplate it reports the current body and, when the body
 *   shows the run-together pattern (two adjacent placeholders with no separator) or a
 *   duplicated placeholder, proposes the standard well-formed sentence:
 *
 *     has successfully completed the training {{topicName}} [{{topicCode}}],
 *     version {{topicVersion}}, on {{completionDate}} with {{score}}%.
 *
 *   ({{score}} and its connector are removed automatically at render time for reading-only
 *   courses, so the sentence stays correct with or without an assessment.)
 *
 * SAFETY
 *   - Only `bodyText` is touched; colours, sizes, layout, header/footer and defaults are left
 *     alone. Nothing is deleted.
 *   - Templates whose body already looks well-formed are skipped (reported as OK).
 *   - Runs as a DRY RUN unless `--apply` is passed. Take an Atlas backup before applying.
 *   - `--all` also rewrites bodies that look fine, for a uniform house style.
 *
 * Usage:
 *   npx tsx backend/scripts/fix-certificate-template-body.ts            # dry run
 *   npx tsx backend/scripts/fix-certificate-template-body.ts --apply    # write
 *   npx tsx backend/scripts/fix-certificate-template-body.ts --all --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

const STANDARD_BODY =
  'has successfully completed the training {{topicName}} [{{topicCode}}], version {{topicVersion}}, on {{completionDate}} with {{score}}%.';

/** Two placeholders touching with no separator, e.g. "{{a}}{{b}}". */
const RUN_TOGETHER = /\}\}\s*\{\{/;

/** The same placeholder used more than once (e.g. {{completionDate}} twice). */
function hasDuplicatePlaceholder(body: string): boolean {
  const tokens = body.match(/\{\{\w+\}\}/g) ?? [];
  return new Set(tokens).size !== tokens.length;
}

async function main() {
  console.log(`\nFix certificate template body — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}${ALL ? ' · --all' : ''}\n`);

  const templates = await prisma.certificateTemplate.findMany({
    where: { isDeleted: false },
    select: { id: true, templateName: true, certificateType: true, isDefault: true, bodyText: true },
  });

  if (templates.length === 0) {
    console.log('No certificate templates found — the built-in default layout is in use.\n');
    return;
  }

  const toFix: typeof templates = [];
  for (const t of templates) {
    const body = t.bodyText ?? '';
    const malformed = !body.trim() || RUN_TOGETHER.test(body) || hasDuplicatePlaceholder(body);
    const label = `${t.templateName} (${t.certificateType}${t.isDefault ? ', default' : ''})`;
    if (malformed || ALL) {
      toFix.push(t);
      console.log(`  ${malformed ? 'FIX ' : 'ALL '} ${label}`);
      console.log(`        before: ${JSON.stringify(body)}`);
      console.log(`        after : ${JSON.stringify(STANDARD_BODY)}`);
    } else {
      console.log(`  OK   ${label}`);
    }
  }

  if (toFix.length === 0) {
    console.log('\nNothing to change.\n');
    return;
  }
  if (!APPLY) {
    console.log(`\nDRY RUN — ${toFix.length} template(s) would be updated. Re-run with --apply to write.\n`);
    return;
  }

  for (const t of toFix) {
    await prisma.certificateTemplate.update({ where: { id: t.id }, data: { bodyText: STANDARD_BODY } });
  }
  console.log(`\nDone — updated ${toFix.length} template(s).\n`);
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
