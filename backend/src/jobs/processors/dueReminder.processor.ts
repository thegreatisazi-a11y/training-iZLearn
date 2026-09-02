import { prisma } from '../../config/prisma';
import { getList } from '../../services/systemConfig.service';
import { notifyTrainingDue, notifyTrainingOverdue, notifyTrainingAssigned } from '../../services/notification.service';
import { finalizeStaleAttempts } from '../../services/assessment.service';
import { startOfDay, endOfDay, addDays } from '../../utils/dateUtils';
import { logger } from '../../config/logger';

/** Daily due/overdue reminders using configurable thresholds (Module 10). */
export async function runDueReminderCheck() {
  const now = new Date();

  // Record the failure reason for any assessment that was started but never submitted
  // (system/power/network died mid-test) — so even when the learner never returns, the
  // attempt is finalized with its distinct reason in the audit trail and nothing is lost.
  const staleFinalized = await finalizeStaleAttempts().catch(() => 0);

  // CR-57: activate assign-later (DEFERRED) assignments whose activateOn has arrived.
  const toActivate = await prisma.trainingAssignment.findMany({
    where: { isDeleted: false, status: 'DEFERRED', activateOn: { not: null, lte: endOfDay(now) } },
  });
  for (const a of toActivate) {
    await prisma.trainingAssignment.update({ where: { id: a.id }, data: { status: 'PENDING', activateOn: null } });
    await notifyTrainingAssigned(a.userId, a.topicId, a.dueDate);
  }

  // Overdue: past due and still open → mark OVERDUE, require supervisor sign-off,
  // notify once (overdueNotifiedAt dedups repeat notifications). CR-56.
  //
  // A due date is OPTIONAL — a course created without one, and the new-joiner auto-assign flow,
  // both leave it unset. Such an assignment can never be overdue and must be left alone.
  //
  // MongoDB makes that easy to get wrong: in BSON sort order null (and a MISSING field) ranks
  // BELOW every Date, so `dueDate: { lt: <date> }` MATCHES the rows with no due date at all —
  // which silently marked every no-deadline assignment OVERDUE on the nightly sweep. The `not:
  // null` filter narrows the query, and the guard in the loop is what actually guarantees it,
  // since (per CLAUDE.md) Prisma's null filters do not match documents where the field is absent.
  const candidates = await prisma.trainingAssignment.findMany({
    where: { isDeleted: false, dueDate: { not: null, lt: startOfDay(now) }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
  });
  const overdue = candidates.filter((a) => a.dueDate != null && a.dueDate < startOfDay(now));
  for (const a of overdue) {
    await prisma.trainingAssignment.update({
      where: { id: a.id },
      data: { status: 'OVERDUE', requiresSupervisorApproval: true, overdueNotifiedAt: a.overdueNotifiedAt ?? now },
    });
    if (a.dueDate && !a.overdueNotifiedAt) await notifyTrainingOverdue(a.userId, a.topicId, a.dueDate);
  }

  // Due in N days for each configured threshold.
  const thresholds = (await getList('reminder.days_before_due')).map((n) => parseInt(n, 10)).filter(Number.isFinite);
  for (const days of thresholds) {
    const target = addDays(now, days);
    const due = await prisma.trainingAssignment.findMany({
      where: {
        isDeleted: false,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        dueDate: { gte: startOfDay(target), lte: endOfDay(target) },
      },
    });
    for (const a of due) {
      if (a.dueDate) await notifyTrainingDue(a.userId, a.topicId, a.dueDate);
    }
  }
  logger.info(`Due-reminder check: ${overdue.length} marked overdue; ${staleFinalized} stale attempt(s) finalized.`);
  return { overdue: overdue.length, staleFinalized };
}
