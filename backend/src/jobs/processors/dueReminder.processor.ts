import { prisma } from '../../config/prisma';
import { getList } from '../../services/systemConfig.service';
import { notifyTrainingDue, notifyTrainingOverdue, notifyTrainingAssigned } from '../../services/notification.service';
import { startOfDay, endOfDay, addDays } from '../../utils/dateUtils';
import { logger } from '../../config/logger';

/** Daily due/overdue reminders using configurable thresholds (Module 10). */
export async function runDueReminderCheck() {
  const now = new Date();

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
  const overdue = await prisma.trainingAssignment.findMany({
    where: { isDeleted: false, dueDate: { lt: startOfDay(now) }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
  });
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
  logger.info(`Due-reminder check: ${overdue.length} marked overdue.`);
  return { overdue: overdue.length };
}
