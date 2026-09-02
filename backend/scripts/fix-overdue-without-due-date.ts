/**
 * Repair assignments wrongly marked OVERDUE despite having NO due date.
 *
 * BACKGROUND
 *   A due date is optional (a course created without one, and the new-joiner auto-assign flow,
 *   both leave it unset), and such an assignment can never be overdue. The nightly sweep filtered
 *   on `dueDate: { lt: today }` — but in MongoDB's BSON sort order null and a MISSING field rank
 *   BELOW every Date, so that predicate also matched every assignment with no due date and marked
 *   it OVERDUE (setting requiresSupervisorApproval at the same time). The sweep now excludes them
 *   (see dueReminder.processor.ts); this script repairs the rows written before that fix.
 *
 * WHAT IT DOES (idempotent, dry-run by default)
 *   For each assignment with status OVERDUE and no dueDate, restores the status it should have:
 *     - IN_PROGRESS when the trainee has started (a reading log or an assessment attempt exists)
 *     - PENDING otherwise
 *   and clears the overdue side effects (requiresSupervisorApproval, overdueNotifiedAt).
 *
 * SAFETY
 *   - Only assignments with status OVERDUE **and no due date** are touched; a genuinely overdue
 *     assignment (one that has a due date in the past) is never matched.
 *   - COMPLETED / BLOCKED / WAIVED / DEFERRED assignments are never matched.
 *   - Assessment attempts, reading logs, certificates, signatures and audit rows are not touched.
 *   - Runs as a DRY RUN unless `--apply` is passed. Take an Atlas backup before applying.
 *
 * Usage:
 *   npx tsx backend/scripts/fix-overdue-without-due-date.ts           # dry run (default)
 *   npx tsx backend/scripts/fix-overdue-without-due-date.ts --apply   # write
 */
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Same lookup as src/config/env.ts: backend/.env first, then the repo-root .env.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`\nRepair OVERDUE assignments with no due date — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  // Fetch every OVERDUE assignment and decide in JS: a `dueDate: null` filter would not match
  // documents where the field is ABSENT (see CLAUDE.md), which is exactly the population here.
  const overdue = await prisma.trainingAssignment.findMany({
    where: { isDeleted: false, status: 'OVERDUE' },
    select: { id: true, userId: true, topicId: true, dueDate: true, requiresSupervisorApproval: true, overdueNotifiedAt: true },
  });
  const wrong = overdue.filter((a) => a.dueDate == null);

  console.log(`OVERDUE assignments: ${overdue.length}`);
  console.log(`  ...of which have NO due date (wrongly overdue): ${wrong.length}\n`);
  if (!wrong.length) {
    console.log('Nothing to repair.\n');
    return;
  }

  const users = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(wrong.map((a) => a.userId))] } }, select: { id: true, windowsUsername: true } })).map((u) => [u.id, u.windowsUsername]),
  );
  const topics = new Map(
    (await prisma.trainingTopic.findMany({ where: { id: { in: [...new Set(wrong.map((a) => a.topicId))] } }, select: { id: true, topicCode: true, topicNumber: true, title: true } })).map((t) => [t.id, t]),
  );

  let pending = 0;
  let inProgress = 0;
  for (const a of wrong) {
    // "Started" = any recorded reading or assessment activity for this course.
    const [reads, attempts] = await Promise.all([
      prisma.materialViewLog.count({ where: { userId: a.userId, topicId: a.topicId } }),
      prisma.assessmentAttempt.count({ where: { userId: a.userId, topicId: a.topicId, isDeleted: false } }),
    ]);
    const status = reads > 0 || attempts > 0 ? 'IN_PROGRESS' : 'PENDING';
    if (status === 'PENDING') pending += 1;
    else inProgress += 1;

    const t = topics.get(a.topicId);
    console.log(`  ${users.get(a.userId) ?? a.userId}  ${t ? `${t.topicNumber ?? t.topicCode} – ${t.title}` : a.topicId}  →  ${status}`);

    if (APPLY) {
      await prisma.trainingAssignment.update({
        where: { id: a.id },
        data: { status, requiresSupervisorApproval: false, overdueNotifiedAt: null },
      });
    }
  }

  console.log(`\n${APPLY ? 'Repaired' : 'Would repair'} ${wrong.length}: ${pending} → PENDING, ${inProgress} → IN_PROGRESS.`);
  if (!APPLY) console.log('Re-run with --apply to write.\n');
  else console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
