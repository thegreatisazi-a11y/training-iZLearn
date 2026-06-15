import { prisma } from '../config/prisma';
import { hasPermission } from '../utils/permissions';
import type { AuthUser } from '../types';

const MY_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'BLOCKED', 'WAIVED'] as const;

/** Role-aware dashboard payload — the frontend renders only the sections the user has. */
export async function getDashboard(user: AuthUser) {
  // Personal training summary (every user has this).
  const myCounts: Record<string, number> = {};
  await Promise.all(
    MY_STATUSES.map(async (s) => {
      myCounts[s] = await prisma.trainingAssignment.count({ where: { userId: user.id, status: s, isDeleted: false } });
    }),
  );
  // CR-42: a refresher is "due" once its date has arrived on the COMPLETED assignment
  // (the new pending assignment is only created by the refresher job at that point).
  const refresherDue = await prisma.trainingAssignment.count({
    where: { userId: user.id, isDeleted: false, status: 'COMPLETED', refresherDueDate: { not: null, lte: new Date() } },
  });
  const myCertificates = await prisma.certificate.count({ where: { userId: user.id, isDeleted: false } });

  const payload: Record<string, unknown> = {
    me: {
      pending: myCounts.PENDING,
      inProgress: myCounts.IN_PROGRESS,
      completed: myCounts.COMPLETED,
      overdue: myCounts.OVERDUE,
      blocked: myCounts.BLOCKED,
      waived: myCounts.WAIVED,
      refresherDue,
      certificates: myCertificates,
    },
    roles: user.roleNames,
  };

  // Reporting Manager section: aggregate counts for the caller's direct reports.
  // Scoped strictly by supervisorId so a manager only sees their own team.
  if (hasPermission(user.permissions, 'team', 'read')) {
    const reports = await prisma.user.findMany({
      where: { isDeleted: false, isActive: true, supervisorId: user.id },
      select: { id: true },
    });
    const reportIds = reports.map((r) => r.id);
    if (reportIds.length) {
      const [teamPending, teamOverdue, teamBlocked] = await Promise.all([
        prisma.trainingAssignment.count({
          where: { userId: { in: reportIds }, isDeleted: false, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        }),
        prisma.trainingAssignment.count({
          where: { userId: { in: reportIds }, isDeleted: false, status: 'OVERDUE' },
        }),
        prisma.trainingAssignment.count({
          where: { userId: { in: reportIds }, isDeleted: false, status: 'BLOCKED' },
        }),
      ]);
      payload.team = {
        teamSize: reportIds.length,
        pending: teamPending,
        overdue: teamOverdue,
        blocked: teamBlocked,
      };
    } else {
      payload.team = { teamSize: 0, pending: 0, overdue: 0, blocked: 0 };
    }
  }

  // Organisation-wide section for users with reporting / admin visibility.
  const showOrg =
    hasPermission(user.permissions, 'reports', 'read') ||
    hasPermission(user.permissions, 'userManagement', 'read') ||
    hasPermission(user.permissions, 'auditTrail', 'read');

  if (showOrg) {
    const [
      totalUsers, activeUsers, totalTopics, pendingUserRequests, pendingTNI, overdueAssignments, pendingJD, blockedAssessments,
      draftTopics, underReviewTopics, publishedTopics, archivedTopics, totalBundles,
      assignedTrainings, pendingTrainings, completedTrainings,
    ] = await Promise.all([
      prisma.user.count({ where: { isDeleted: false } }),
      prisma.user.count({ where: { isDeleted: false, isActive: true } }),
      prisma.trainingTopic.count({ where: { isDeleted: false, isActive: true } }),
      prisma.userCreationRequest.count({ where: { status: 'PENDING_APPROVAL', isDeleted: false } }),
      prisma.tNI.count({ where: { status: 'PENDING', isDeleted: false } }),
      prisma.trainingAssignment.count({ where: { status: 'OVERDUE', isDeleted: false } }),
      prisma.jobDescription.count({ where: { status: 'UNDER_REVIEW', isDeleted: false } }),
      prisma.trainingAssignment.count({ where: { status: 'BLOCKED', isDeleted: false } }),
      prisma.trainingTopic.count({ where: { isDeleted: false, status: 'DRAFT' } }),
      prisma.trainingTopic.count({ where: { isDeleted: false, status: 'UNDER_REVIEW' } }),
      prisma.trainingTopic.count({ where: { isDeleted: false, status: 'PUBLISHED' } }),
      prisma.trainingTopic.count({ where: { isDeleted: false, status: 'ARCHIVED' } }),
      prisma.topicBundle.count({ where: { isDeleted: false } }),
      prisma.trainingAssignment.count({ where: { isDeleted: false } }),
      prisma.trainingAssignment.count({ where: { isDeleted: false, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
      prisma.trainingAssignment.count({ where: { isDeleted: false, status: 'COMPLETED' } }),
    ]);
    payload.org = {
      totalUsers,
      activeUsers,
      totalTopics,
      pendingUserRequests,
      pendingTNI,
      overdueAssignments,
      pendingJDApprovals: pendingJD,
      blockedAssessments,
      draftTopics,
      underReviewTopics,
      publishedTopics,
      archivedTopics,
      totalBundles,
      assignedTrainings,
      pendingTrainings,
      completedTrainings,
    };
  }

  // Announcements visible to the user.
  const announcements = await prisma.announcement.findMany({
    where: {
      isDeleted: false,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  payload.announcements = announcements.filter((a) => {
    const targets = (a.targetRoles as string[]) ?? [];
    return targets.length === 0 || targets.some((r) => user.roleIds.includes(r));
  });

  return payload;
}
