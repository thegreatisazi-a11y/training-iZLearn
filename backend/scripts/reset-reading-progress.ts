/**
 * Clear a user's reading progress for one course, so the reading gate can be re-tested from a
 * genuinely clean slate.
 *
 * BACKGROUND
 *   A leaked client-side reading timer used to keep banking seconds for a document that was no
 *   longer on screen. It inflated `MaterialViewLog.elapsedSeconds` past the required time, which
 *   auto-completed the material and made the next visit show "0s left · resumed". The client no
 *   longer accumulates time by ticking and the server now rejects implausible jumps, but rows
 *   written while the bug was live still carry the inflated figures — and a course cannot be
 *   re-tested while a material is already marked read.
 *
 * WHAT IT DOES (idempotent, dry-run by default)
 *   Deletes the `MaterialViewLog` rows for one user + one course. This is exactly what the
 *   application itself does when it resets unacknowledged reading (see resetUnacknowledgedReading),
 *   so it introduces no new kind of write.
 *
 * SAFETY
 *   - Only `MaterialViewLog` rows are removed. Assessment attempts, completions, certificates,
 *     electronic signatures and audit rows are never touched, so completion evidence and the
 *     21 CFR Part 11 trail are fully preserved.
 *   - Scoped to a single user and a single course; both must be given explicitly.
 *   - Runs as a DRY RUN unless `--apply` is passed. Take an Atlas backup before applying.
 *
 * Usage:
 *   npx tsx backend/scripts/reset-reading-progress.ts --user <username|email|id> --course <code|id>
 *   npx tsx backend/scripts/reset-reading-progress.ts --user d --course RT-01 --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const userArg = arg('user');
  const courseArg = arg('course');
  if (!userArg || !courseArg) {
    console.error('\nBoth --user and --course are required.\n  e.g. --user d --course RT-01\n');
    process.exit(1);
  }

  console.log(`\nReset reading progress — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  const user = await prisma.user.findFirst({
    where: { OR: [{ id: userArg }, { windowsUsername: userArg }, { employeeId: userArg }, { email: userArg }] },
    select: { id: true, windowsUsername: true, fullName: true, email: true },
  });
  if (!user) {
    console.error(`No user matched "${userArg}".`);
    process.exit(1);
  }

  // The course may be given as its code (what a user reads) or its id.
  const topic = await prisma.trainingTopic.findFirst({
    where: { OR: [{ id: courseArg }, { topicCode: courseArg }, { topicNumber: courseArg }] },
    select: { id: true, topicCode: true, topicNumber: true, title: true, currentVersion: true },
  });
  if (!topic) {
    console.error(`No course matched "${courseArg}".`);
    process.exit(1);
  }

  const logs = await prisma.materialViewLog.findMany({
    where: { userId: user.id, topicId: topic.id },
    select: {
      id: true,
      materialId: true,
      topicVersion: true,
      requiredSeconds: true,
      elapsedSeconds: true,
      isCompleted: true,
      reachedLastPage: true,
      ackAvailableAt: true,
    },
  });

  console.log(`User:   ${user.windowsUsername} — ${user.fullName}`);
  console.log(`Course: ${topic.topicNumber ?? topic.topicCode} – ${topic.title} (v${topic.currentVersion})`);
  console.log(`Reading logs found: ${logs.length}\n`);
  for (const l of logs) {
    console.log(
      `  v${l.topicVersion} material=${l.materialId.slice(0, 8)} required=${l.requiredSeconds}s ` +
        `elapsed=${l.elapsedSeconds ?? 0}s read=${l.isCompleted} end=${l.reachedLastPage} ` +
        `ackShownAt=${l.ackAvailableAt ? l.ackAvailableAt.toISOString() : '—'}`,
    );
  }

  if (!logs.length) {
    console.log('\nNothing to clear — this user already has no reading progress for this course.\n');
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — would delete ${logs.length} reading log(s). Re-run with --apply to write.\n`);
    return;
  }

  const { count } = await prisma.materialViewLog.deleteMany({ where: { userId: user.id, topicId: topic.id } });
  console.log(`\nDeleted ${count} reading log(s). The course will start from the beginning on the next visit.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
