/**
 * Stamp `extraAttemptsVersion` on retake grants written before that field existed.
 *
 * BACKGROUND
 *   `TrainingAssignment.extraAttempts` is a HIGH-WATER OFFSET, not a count of spare attempts:
 *   an approved retake sets it to the attempts used so far, so `maxAttempts + extraAttempts`
 *   grants a fresh full allowance. But the allowance RESETS on every course revision
 *   (startAttempt scopes its limit to topicVersion), so an unversioned offset kept applying
 *   after a revision and handed the new version a fresh allowance PLUS the stale offset —
 *   i.e. double. `extraAttemptsVersion` records which version a grant was made for, and a
 *   grant now applies only while it matches the course's currentVersion.
 *
 *   Grants written before the field exist with no stamp, so they no longer apply. For
 *   ENFORCEMENT that is the correct and safe outcome — the learner still receives the new
 *   version's full fresh allowance, so nobody is locked out. But for DISPLAY it makes a
 *   completed history look impossible: a learner who really was granted a retake on the
 *   current version and used 4 of 4 now reads as "Attempt 4 of 2".
 *
 * WHAT IT DOES (idempotent, dry-run by default)
 *   Stamps a legacy grant with the course's CURRENT version only where there is proof the
 *   grant was in force for that version: the learner has MORE completed attempts on the
 *   current version than the course's raw maxAttempts. That can only have happened with a
 *   grant applying to that version, because the start-time gate blocks at
 *   maxAttempts + extraAttempts. Anything short of that proof is left unstamped (and so
 *   stays inapplicable) — which is the right answer for a grant made on an older version.
 *
 * SAFETY
 *   - Only `extraAttemptsVersion` is written. `extraAttempts` itself is never changed.
 *   - Only rows that ALREADY have extraAttempts > 0 and NO stamp are considered.
 *   - Never grants anyone an attempt they did not already have: stamping only recognises an
 *     allowance the learner has demonstrably already consumed.
 *   - Assessment attempts, assignments' status, certificates, signatures and audit rows are
 *     not touched.
 *   - Runs as a DRY RUN unless `--apply` is passed. Take an Atlas backup before applying.
 *
 * Usage:
 *   npx tsx backend/scripts/stamp-extra-attempts-version.ts           # dry run (default)
 *   npx tsx backend/scripts/stamp-extra-attempts-version.ts --apply   # write
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
  console.log(`\nStamp legacy retake grants with their course version — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  // A `extraAttemptsVersion: null` filter would not match documents where the field is
  // ABSENT (see CLAUDE.md), which is the whole population here — so decide in JS.
  const candidates = (
    await prisma.trainingAssignment.findMany({
      where: { isDeleted: false, extraAttempts: { not: null, gt: 0 } },
      select: { id: true, userId: true, topicId: true, status: true, extraAttempts: true, extraAttemptsVersion: true },
    })
  ).filter((a) => a.extraAttemptsVersion == null);

  console.log(`${candidates.length} unstamped grant(s) found.\n`);
  let stamped = 0;
  let left = 0;

  for (const a of candidates) {
    const [topic, user] = await Promise.all([
      prisma.trainingTopic.findUnique({
        where: { id: a.topicId },
        select: { topicNumber: true, topicCode: true, currentVersion: true, maxAttempts: true },
      }),
      prisma.user.findUnique({ where: { id: a.userId }, select: { fullName: true } }),
    ]);
    const label = `${user?.fullName ?? a.userId} / ${topic?.topicNumber ?? topic?.topicCode ?? a.topicId}`;

    // An orphaned assignment (its course was hard-deleted) has nothing to stamp against.
    if (!topic || topic.currentVersion == null || topic.maxAttempts == null) {
      console.log(`  SKIP   ${label} — course missing or incomplete; left unstamped`);
      left += 1;
      continue;
    }

    const usedOnCurrent = await prisma.assessmentAttempt.count({
      where: {
        userId: a.userId,
        topicId: a.topicId,
        topicVersion: topic.currentVersion,
        isDeleted: false,
        completedAt: { not: null },
      },
    });

    // The proof: exceeding the raw maximum on this version is only possible if a grant was
    // applying to this version.
    if (usedOnCurrent > topic.maxAttempts) {
      console.log(
        `  STAMP  ${label} v${topic.currentVersion} — ${usedOnCurrent} attempts used > max ${topic.maxAttempts}, ` +
        `so the grant (extra=${a.extraAttempts}) was in force for v${topic.currentVersion}`,
      );
      if (APPLY) {
        await prisma.trainingAssignment.update({
          where: { id: a.id },
          data: { extraAttemptsVersion: topic.currentVersion },
        });
      }
      stamped += 1;
    } else {
      console.log(
        `  LEAVE  ${label} v${topic.currentVersion} — only ${usedOnCurrent} attempts on the current version ` +
        `(max ${topic.maxAttempts}); no evidence the grant was for it, so it stays inapplicable`,
      );
      left += 1;
    }
  }

  console.log(`\n${APPLY ? 'Stamped' : 'Would stamp'} ${stamped}; left ${left} unstamped.`);
  if (!APPLY) console.log('Re-run with --apply to write.\n');
  else console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
