import { prisma } from '../config/prisma';
import { hasPermission } from '../utils/permissions';
import type { AuthUser } from '../types';
import type { PermissionAction } from '@izlearn/shared';

const MY_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'BLOCKED', 'WAIVED'] as const;

/** Role-aware dashboard payload — the frontend renders only the sections the user has. */
export async function getDashboard(user: AuthUser) {
  // A revised course supersedes its old version; the trainee gets a FRESH assignment to
  // the new version and the old assignment is hidden everywhere in the app (see
  // listMyTrainings). The dashboard must exclude those superseded-topic assignments too,
  // otherwise its counts are higher than what the user actually sees on My Trainings.
  // (Computed in JS — `supersededByTopicId` is optional and unreliable to filter on in Mongo.)
  const allTopics = await prisma.trainingTopic.findMany({ where: { isDeleted: false }, select: { id: true, supersededByTopicId: true, status: true } });
  const supersededTopicIds = allTopics.filter((t) => !!t.supersededByTopicId).map((t) => t.id);
  const currentOnly = supersededTopicIds.length ? { topicId: { notIn: supersededTopicIds } } : {};
  // Keep counts in lockstep with My Trainings: an UNPUBLISHED (archived/draft) course's
  // still-actionable assignments are hidden there, so exclude them from the actionable
  // counts here too. Completed/waived history is unaffected (uses `currentOnly`).
  const hiddenActionableTopicIds = allTopics.filter((t) => !!t.supersededByTopicId || t.status !== 'PUBLISHED').map((t) => t.id);
  const actionableOnly = hiddenActionableTopicIds.length ? { topicId: { notIn: hiddenActionableTopicIds } } : {};
  const ACTIONABLE = new Set(['PENDING', 'IN_PROGRESS', 'OVERDUE', 'BLOCKED']);

  // Personal training summary (every user has this). OVERDUE is authoritative on the
  // stored status (maintained by the daily due-reminder job); dueDate is optional and
  // null for most assignments, so it can't be used to derive overdue here.
  const myCounts: Record<string, number> = {};
  await Promise.all(
    MY_STATUSES.map(async (s) => {
      myCounts[s] = await prisma.trainingAssignment.count({
        where: { userId: user.id, status: s, isDeleted: false, ...(ACTIONABLE.has(s) ? actionableOnly : currentOnly) },
      });
    }),
  );
  // CR-42: a refresher is "due" once its date has arrived on the COMPLETED assignment
  // (the new pending assignment is only created by the refresher job at that point).
  const refresherDue = await prisma.trainingAssignment.count({
    where: { userId: user.id, isDeleted: false, status: 'COMPLETED', refresherDueDate: { not: null, lte: new Date() }, ...currentOnly },
  });
  const myCertificates = await prisma.certificate.count({ where: { userId: user.id, isDeleted: false } });
  // Per-user dashboard layout (which section-widgets are shown and their order).
  const prefRow = await prisma.user.findUnique({ where: { id: user.id }, select: { dashboardPrefs: true } });

  const payload: Record<string, unknown> = {
    preferences: prefRow?.dashboardPrefs ?? null,
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
          where: { userId: { in: reportIds }, isDeleted: false, status: { in: ['PENDING', 'IN_PROGRESS'] }, ...currentOnly },
        }),
        prisma.trainingAssignment.count({
          where: { userId: { in: reportIds }, isDeleted: false, status: 'OVERDUE', ...currentOnly },
        }),
        prisma.trainingAssignment.count({
          where: { userId: { in: reportIds }, isDeleted: false, status: 'BLOCKED', ...currentOnly },
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

  // Organisation-wide section — gated on the dedicated dashboard:view_org permission so a
  // supervisor/manager (who has broad read access but should only see THEIR TEAM on the
  // dashboard) can be limited by turning this off in Roles & Access Control. Managed
  // entirely from R&AC, not by role name.
  const showOrg = hasPermission(user.permissions, 'dashboard', 'view_org' as PermissionAction);

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
      prisma.trainingAssignment.count({ where: { status: 'OVERDUE', isDeleted: false, ...currentOnly } }),
      prisma.jobDescription.count({ where: { status: 'UNDER_REVIEW', isDeleted: false } }),
      prisma.trainingAssignment.count({ where: { status: 'BLOCKED', isDeleted: false, ...currentOnly } }),
      prisma.trainingTopic.count({ where: { isDeleted: false, status: 'DRAFT' } }),
      prisma.trainingTopic.count({ where: { isDeleted: false, status: 'UNDER_REVIEW' } }),
      prisma.trainingTopic.count({ where: { isDeleted: false, status: 'PUBLISHED' } }),
      prisma.trainingTopic.count({ where: { isDeleted: false, status: 'ARCHIVED' } }),
      prisma.topicBundle.count({ where: { isDeleted: false } }),
      prisma.trainingAssignment.count({ where: { isDeleted: false, ...currentOnly } }),
      prisma.trainingAssignment.count({ where: { isDeleted: false, status: { in: ['PENDING', 'IN_PROGRESS'] }, ...currentOnly } }),
      prisma.trainingAssignment.count({ where: { isDeleted: false, status: 'COMPLETED', ...currentOnly } }),
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

/**
 * Save the signed-in user's dashboard layout (which section-widgets are visible and their
 * order). Self-scoped personalization — no permission gate. Unknown/extra keys are dropped
 * and values are coerced to a safe { order: string[], hidden: string[] } shape.
 */
export async function saveDashboardPreferences(userId: string, prefs: unknown): Promise<{ order: string[]; hidden: string[] }> {
  const p = (prefs ?? {}) as { order?: unknown; hidden?: unknown };
  const toStrings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []);
  const clean = { order: toStrings(p.order), hidden: toStrings(p.hidden) };
  await prisma.user.update({ where: { id: userId }, data: { dashboardPrefs: clean } });
  return clean;
}
