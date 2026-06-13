import { prisma } from '../../config/prisma';
import { notifyRefresherDue } from '../../services/notification.service';
import { logger } from '../../config/logger';

/**
 * Daily refresher check (Module 6 / CR-42).
 *
 * When a completed training's refresher date arrives, a fresh PENDING assignment
 * is materialized for the user+topic (only if no active assignment already exists),
 * and the refresher marker on the completed assignment is cleared so it is not
 * recreated. This keeps refreshers out of the "pending" counts until they are
 * genuinely due.
 */
export async function runRefresherCheck() {
  const now = new Date();
  const due = await prisma.trainingAssignment.findMany({
    where: {
      isDeleted: false,
      status: 'COMPLETED',
      refresherDueDate: { not: null, lte: now },
    },
  });

  let created = 0;
  for (const a of due) {
    const active = await prisma.trainingAssignment.findFirst({
      where: { userId: a.userId, topicId: a.topicId, isDeleted: false, status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] } },
    });
    if (!active) {
      await prisma.trainingAssignment.create({
        data: {
          userId: a.userId,
          topicId: a.topicId,
          assignmentType: 'COURSE_SPECIFIC',
          status: 'PENDING',
          dueDate: a.refresherDueDate,
          assignedBy: 'SYSTEM',
          createdBy: 'SYSTEM',
        },
      });
      if (a.refresherDueDate) await notifyRefresherDue(a.userId, a.topicId, a.refresherDueDate);
      created += 1;
    }
    // Clear the marker so the same refresher is not generated twice.
    await prisma.trainingAssignment.update({ where: { id: a.id }, data: { refresherDueDate: null } });
  }

  logger.info(`Refresher check: ${created} refresher assignment(s) created from ${due.length} due marker(s).`);
  return { checked: due.length, created };
}
