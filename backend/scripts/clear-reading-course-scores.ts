/**
 * Clear the placeholder score on reading-only (read & acknowledge) completions.
 *
 * BACKGROUND
 *   A course with `requiresAssessment = false` is completed via read + acknowledge. That path
 *   used to record its marker attempt with `score: 100`, which then surfaced as a real result
 *   on certificates, team records and reports even though NO assessment was taken. The code now
 *   stores `score: null` for these completions (see completeByAcknowledgement); this script
 *   cleans up the rows created before that change.
 *
 * WHAT IT DOES (idempotent, dry-run by default)
 *   Finds AssessmentAttempt rows that are reading-only completions — identified by an EMPTY
 *   `questionsUsed` snapshot (no questions were ever served) — that still carry a non-null
 *   score, and sets `score = null`.
 *
 * SAFETY
 *   - Only the `score` field is touched. `isPassed`, `completedAt`, answers, certificates and
 *     audit rows are all left exactly as they are, so completion evidence is preserved.
 *   - Graded attempts (questionsUsed non-empty) are never matched, so real assessment scores
 *     cannot be affected.
 *   - Runs as a DRY RUN unless `--apply` is passed. Take an Atlas backup before applying.
 *
 * Usage:
 *   npx tsx backend/scripts/clear-reading-course-scores.ts           # dry run (default)
 *   npx tsx backend/scripts/clear-reading-course-scores.ts --apply   # write
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
  console.log(`\nClear reading-course placeholder scores — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  // Candidates: completed attempts that still have a score recorded. The reading-only test
  // (empty questionsUsed) is applied in JS because `questionsUsed` is a JSON column.
  const candidates = await prisma.assessmentAttempt.findMany({
    where: { score: { not: null }, completedAt: { not: null } },
    select: { id: true, userId: true, topicId: true, score: true, questionsUsed: true, completedAt: true },
  });

  const readingOnly = candidates.filter((a) => ((a.questionsUsed as unknown[] | null) ?? []).length === 0);

  if (readingOnly.length === 0) {
    console.log('Nothing to do — no reading-only completions carry a score.\n');
    return;
  }

  // Resolve course titles purely for a readable report.
  const topicIds = Array.from(new Set(readingOnly.map((a) => a.topicId)));
  const topics = await prisma.trainingTopic.findMany({
    where: { id: { in: topicIds } },
    select: { id: true, title: true, topicCode: true, requiresAssessment: true },
  });
  const tMap = new Map(topics.map((t) => [t.id, t]));

  console.log(`Found ${readingOnly.length} reading-only completion(s) with a stored score:\n`);
  for (const a of readingOnly) {
    const t = tMap.get(a.topicId);
    console.log(
      `  attempt ${a.id}  score ${a.score} → null  ·  course: ${t?.topicCode ?? a.topicId} ${t?.title ?? ''}` +
        `${t && t.requiresAssessment ? '  [note: course currently requires an assessment]' : ''}`,
    );
  }

  if (!APPLY) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to update these rows.\n');
    return;
  }

  let updated = 0;
  for (const a of readingOnly) {
    await prisma.assessmentAttempt.update({ where: { id: a.id }, data: { score: null } });
    updated += 1;
  }
  console.log(`\nDone — cleared the score on ${updated} attempt(s).\n`);
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
