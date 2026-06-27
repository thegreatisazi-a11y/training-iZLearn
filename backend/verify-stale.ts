/* eslint-disable */
import { prisma } from './src/config/prisma';
import { startAttempt, submitAttempt, finalizeStaleAttempts } from './src/services/assessment.service';

async function mkUser(tag: string) {
  const dept = await prisma.department.findFirst(); const loc = await prisma.location.findFirst();
  const u = await prisma.user.create({ data: { employeeId: `ST-${tag}-${Date.now()}`, windowsUsername: `st_${tag}_${Date.now()}`, fullName: `Stale ${tag}`, email: `st_${tag}@x.com`, departmentId: dept!.id, locationId: loc!.id, userType: 'INTERNAL', passwordHash: 'x', createdBy: 'SYSTEM' } as any });
  await prisma.jobDescription.create({ data: { userId: u.id, departmentId: dept!.id, title: 'JD', content: '<p>x</p>', version: 1, status: 'APPROVED', createdBy: 'SYSTEM' } as any });
  await prisma.curriculumVitae.create({ data: { userId: u.id, createdBy: 'SYSTEM' } as any });
  return u;
}
async function mkTopic(maxAttempts: number) {
  const t = await prisma.trainingTopic.create({ data: { topicCode: `TRN-ST-${Date.now()}-${maxAttempts}`, title: 'Stale Course', trainingType: 'SOP', status: 'PUBLISHED', passingScorePercent: 50, maxAttempts, durationMinutes: 0, currentVersion: 1, requiresAssessment: true, blockAfterMaxAttempts: true, createdBy: 'SYSTEM' } as any });
  const q = await prisma.question.create({ data: { topicId: t.id, topicVersion: 1, questionText: 'Q', questionType: 'TRUE_FALSE', options: [] as any, correctAnswer: 'true', isMandatory: true, createdBy: 'SYSTEM' } as any });
  return { t, q };
}

async function main() {
  // 1) Stale sweep finalizes an open attempt that was never submitted.
  const { t, q } = await mkTopic(5);
  const u1 = await mkUser('1');
  const a1 = await prisma.trainingAssignment.create({ data: { userId: u1.id, topicId: t.id, assignmentType: 'COURSE_SPECIFIC', status: 'PENDING', assignedBy: 'SYSTEM', createdBy: 'SYSTEM' } as any });
  const s1 = await startAttempt(u1.id, t.id, a1.id);
  await prisma.assessmentAttempt.update({ where: { id: s1.attemptId }, data: { startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) } }); // 5h ago
  const n = await finalizeStaleAttempts({ userId: u1.id });
  const fin = await prisma.assessmentAttempt.findUnique({ where: { id: s1.attemptId } });
  console.log(`1) STALE SWEEP    -> finalized=${n} completedAt set=${!!fin?.completedAt} reason=${fin?.submissionReason} (expected ABANDONED)`);

  // 2) Fairness: an ABANDONED (no-submission) attempt must NOT consume the only attempt.
  const { t: t2 } = await mkTopic(1);
  const u2 = await mkUser('2');
  const a2 = await prisma.trainingAssignment.create({ data: { userId: u2.id, topicId: t2.id, assignmentType: 'COURSE_SPECIFIC', status: 'PENDING', assignedBy: 'SYSTEM', createdBy: 'SYSTEM' } as any });
  const s2 = await startAttempt(u2.id, t2.id, a2.id); // attempt #1, leave open
  await prisma.assessmentAttempt.update({ where: { id: s2.attemptId }, data: { startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) } });
  await finalizeStaleAttempts({ userId: u2.id }); // -> ABANDONED
  try {
    const s2b = await startAttempt(u2.id, t2.id, a2.id); // should be ALLOWED (abandoned didn't count)
    const r = await submitAttempt(s2b.attemptId, { [q.id]: 'true' }, u2.id, false, 'USER_SUBMITTED');
    console.log(`2) FAIRNESS       -> retry allowed after ABANDONED on maxAttempts=1; passed=${r.isPassed} reasonLabel="${r.submissionReasonLabel}"`);
  } catch (e) {
    console.log(`2) FAIRNESS       -> BLOCKED (BUG): ${(e as Error).message}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
