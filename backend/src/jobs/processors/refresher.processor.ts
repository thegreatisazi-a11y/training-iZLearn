import { prisma } from '../../config/prisma';
import { addDays } from '../../utils/dateUtils';
import { notifyRefresherDue } from '../../services/notification.service';
import { logger } from '../../config/logger';

/** Daily check for refresher assignments coming due (Module 6). */
export async function runRefresherCheck() {
  const horizon = addDays(new Date(), 30);
  const assignments = await prisma.trainingAssignment.findMany({
    where: {
      isDeleted: false,
      refresherDueDate: { not: null, lte: horizon },
      status: { notIn: ['COMPLETED', 'WAIVED'] },
    },
  });
  for (const a of assignments) {
    if (a.refresherDueDate) await notifyRefresherDue(a.userId, a.topicId, a.refresherDueDate);
  }
  logger.info(`Refresher check: ${assignments.length} assignment(s) notified.`);
  return { checked: assignments.length };
}
