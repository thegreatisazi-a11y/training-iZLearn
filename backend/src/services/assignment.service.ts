import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { signFromRequest } from './eSignature.service';
import { notifyTrainingAssigned } from './notification.service';
import { hasCompletedRequiredReading } from './materialView.service';
import { startOfDay } from '../utils/dateUtils';
import { hasOrgWideScope } from '../utils/accessScope';
import type { PermissionMatrix } from '@izlearn/shared';
import type { Request } from 'express';
import type {
  CreateAssignmentInput,
  UpdateAssignmentInput,
  SupervisorDecisionInput,
  PaginationQuery,
} from '@izlearn/shared';

/** Resolve (userId, topicId) target pairs for the three assignment modes. */
async function resolveTargets(input: CreateAssignmentInput): Promise<Array<{ userId: string; topicId: string }>> {
  const pairs: Array<{ userId: string; topicId: string }> = [];
  if (input.assignmentType === 'COURSE_SPECIFIC' && input.topicId) {
    for (const u of input.userIds ?? []) pairs.push({ userId: u, topicId: input.topicId });
  } else if (input.assignmentType === 'PERSON_SPECIFIC' && input.userId) {
    for (const t of input.topicIds ?? []) pairs.push({ userId: input.userId, topicId: t });
  } else if (input.assignmentType === 'ROLE_SPECIFIC' && input.roleId && input.topicId) {
    const urs = await prisma.userRole.findMany({ where: { roleId: input.roleId, isActive: true } });
    for (const ur of urs) pairs.push({ userId: ur.userId, topicId: input.topicId });
  } else if (input.assignmentType === 'TNI_BASED' && input.userId && input.topicId) {
    pairs.push({ userId: input.userId, topicId: input.topicId });
  }
  return pairs;
}

/** Functional-role ids an entity holds: the primary designationId + the designationIds array. */
function functionalRoleIdsOf(u: { designationId?: string | null; designationIds?: unknown }): string[] {
  const arr = Array.isArray(u.designationIds) ? (u.designationIds as string[]) : [];
  const merged = [...arr];
  if (u.designationId && !merged.includes(u.designationId)) merged.unshift(u.designationId);
  return merged.filter(Boolean);
}

/**
 * Auto-assign to ONE user every training course their functional role(s) require per the TNI
 * matrix. This is the user-side counterpart to the publish-time assignToFunctionalRoleHolders
 * (which only reaches users that already exist when a course is published): called when a user
 * is created or their functional roles change, so a new/updated user immediately picks up the
 * courses already required for their role.
 *
 *  - source of truth = the TNI matrix (TniRequirement.isRequired), mirroring "Apply matrix".
 *  - only PUBLISHED, non-deleted courses are assigned (a draft/archived course is never assigned).
 *  - existing (non-waived) assignments are left untouched — idempotent and safe to re-run.
 *  - best-effort by design: the caller wraps this so a hiccup never blocks user creation/update.
 */
export async function assignRequiredCoursesToUser(userId: string, actorId: string): Promise<number> {
  const user = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    select: { id: true, designationId: true, designationIds: true },
  });
  if (!user) return 0;
  const roleIds = functionalRoleIdsOf(user);
  if (!roleIds.length) return 0;

  const required = await prisma.tniRequirement.findMany({
    where: { designationId: { in: roleIds }, isRequired: true, isDeleted: false },
    select: { topicId: true },
  });
  const topicIds = Array.from(new Set(required.map((r) => r.topicId)));
  if (!topicIds.length) return 0;

  const topics = await prisma.trainingTopic.findMany({
    where: { id: { in: topicIds }, isDeleted: false, status: 'PUBLISHED' },
    select: { id: true },
  });

  let created = 0;
  for (const t of topics) {
    const exists = await prisma.trainingAssignment.findFirst({
      where: { userId: user.id, topicId: t.id, isDeleted: false, status: { notIn: ['WAIVED'] } },
    });
    if (exists) continue;
    const a = await prisma.trainingAssignment.create({
      data: { userId: user.id, topicId: t.id, assignmentType: 'ROLE_SPECIFIC', status: 'PENDING', assignedBy: actorId, createdBy: actorId },
    });
    await notifyTrainingAssigned(a.userId, a.topicId, null).catch(() => undefined);
    created += 1;
  }
  return created;
}

/** Keep an individual exception visible and effective when a course gets a new topic row. */
export async function carryNotRequiredAssignmentsToRevision(oldTopicId: string, newTopicId: string, actorId: string): Promise<number> {
  const exceptions = await prisma.trainingAssignment.findMany({
    where: { topicId: oldTopicId, isDeleted: false, status: 'NOT_REQUIRED' },
  });
  let carried = 0;
  for (const exception of exceptions) {
    const exists = await prisma.trainingAssignment.findFirst({ where: { userId: exception.userId, topicId: newTopicId, isDeleted: false } });
    if (exists) continue;
    await prisma.trainingAssignment.create({
      data: {
        userId: exception.userId,
        topicId: newTopicId,
        assignmentType: exception.assignmentType,
        status: 'NOT_REQUIRED',
        assignedBy: actorId,
        createdBy: actorId,
        notRequiredReason: exception.notRequiredReason,
        notRequiredBy: exception.notRequiredBy,
        notRequiredAt: exception.notRequiredAt,
      },
    });
    carried++;
  }
  return carried;
}

export async function createAssignment(input: CreateAssignmentInput, assignedBy: string) {
  const targets = await resolveTargets(input);
  if (!targets.length) throw AppError.badRequest('No assignment targets could be resolved for this request.');

  // 4.3: only PUBLISHED courses may be assigned — draft/archived courses are not assignable.
  const topicIds = Array.from(new Set(targets.map((t) => t.topicId)));
  const assignable = await prisma.trainingTopic.findMany({
    where: { id: { in: topicIds }, isDeleted: false, status: 'PUBLISHED' },
    select: { id: true, dueDate: true },
  });
  const publishedIds = new Set(assignable.map((t) => t.id));
  // Course-level default due date, used when the assignment doesn't specify its own.
  const topicDueDate = new Map(assignable.map((t) => [t.id, t.dueDate]));
  const blocked = topicIds.filter((id) => !publishedIds.has(id));
  if (blocked.length) {
    throw AppError.badRequest('One or more selected courses are not published and cannot be assigned.');
  }
  // An individual exception is deliberate; a manual assignment must restore it first.
  for (const target of targets) {
    const exception = await prisma.trainingAssignment.findFirst({
      where: { userId: target.userId, topicId: target.topicId, isDeleted: false, status: 'NOT_REQUIRED' },
    });
    if (exception) throw AppError.conflict('This course is marked not required for a selected user. Restore it from My Team first.');
  }

  // CR-56: never stamp an already-expired due date (e.g. a user added to a
  // role-based course after the due date would have passed) — leave it open.
  const today = startOfDay(new Date());
  // An explicit due date wins; otherwise fall back to the course-level default. Either way a
  // past date is dropped so a new assignment never starts already-overdue.
  const safeDue = (d: Date | null | undefined) => (d && d >= today ? d : null);
  // CR-57: assign-later keeps the assignment DEFERRED (invisible to the trainee).
  const deferred = !!input.activateLater;
  const status = deferred ? 'DEFERRED' : 'PENDING';

  const created = await auditedTransaction(prisma, async (tx) => {
    const result = [];
    const audits = [];
    for (const t of targets) {
      const a = await tx.trainingAssignment.create({
        data: {
          userId: t.userId,
          topicId: t.topicId,
          assignmentType: input.assignmentType,
          scheduleId: input.scheduleId ?? null,
          dueDate: safeDue(input.dueDate ?? topicDueDate.get(t.topicId) ?? null),
          activateOn: deferred ? input.activateOn ?? null : null,
          tniId: input.tniId ?? null,
          assignedBy,
          status,
          createdBy: assignedBy,
        },
      });
      result.push(a);
      audits.push({ action: 'CREATE', entityType: 'TrainingAssignment', entityId: a.id, newValue: { userId: t.userId, topicId: t.topicId, status } });
    }
    return { result, audits };
  });

  // Deferred assignments are silent until activated.
  if (!deferred) for (const a of created) await notifyTrainingAssigned(a.userId, a.topicId, a.dueDate);
  return created;
}

export async function listAssignments(q: PaginationQuery & { userId?: string; topicId?: string; status?: string }) {
  const where: Prisma.TrainingAssignmentWhereInput = {
    isDeleted: false,
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.topicId ? { topicId: q.topicId } : {}),
    ...(q.status ? { status: q.status as Prisma.EnumAssignmentStatusFilter['equals'] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.trainingAssignment.findMany({ where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.trainingAssignment.count({ where }),
  ]);
  // BUG-03/04: resolve user + course so lists (e.g. Blocked Assignments) show the
  // employee name and "number – title" instead of raw ids.
  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const topicIds = Array.from(new Set(rows.map((r) => r.topicId)));
  const [users, topics] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, employeeId: true } }) : [],
    topicIds.length ? prisma.trainingTopic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true, topicNumber: true, topicCode: true } }) : [],
  ]);
  const uMap = new Map(users.map((u) => [u.id, u]));
  const tMap = new Map(topics.map((t) => [t.id, t]));
  const data = rows.map((r) => {
    const t = tMap.get(r.topicId);
    return {
      ...r,
      userFullName: uMap.get(r.userId)?.fullName ?? null,
      employeeId: uMap.get(r.userId)?.employeeId ?? null,
      topicTitle: t?.title ?? null,
      topicNumber: t?.topicNumber ?? t?.topicCode ?? null,
    };
  });
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getAssignment(id: string) {
  const a = await prisma.trainingAssignment.findFirst({ where: { id, isDeleted: false } });
  if (!a) throw AppError.notFound('Assignment not found');
  return a;
}

/**
 * Step 6: the signed-in user's trainings, enriched with full course details (name,
 * number, version, status, type, reading time) and their best attempt result, so
 * the "My Trainings" screen can show complete, human-readable training records.
 */
export async function listMyTrainings(userId: string) {
  const assignments = await prisma.trainingAssignment.findMany({
    // CR-57: DEFERRED assignments are not yet visible to the trainee.
    where: { userId, isDeleted: false, status: { notIn: ['DEFERRED', 'NOT_REQUIRED'] } },
    orderBy: { createdAt: 'desc' },
  });
  const topicIds = Array.from(new Set(assignments.map((a) => a.topicId)));
  const [topics, attempts] = await Promise.all([
    topicIds.length
      ? prisma.trainingTopic.findMany({
          where: { id: { in: topicIds } },
          // trainingTypes: a course can carry several types (D6); the singular trainingType is
          // kept as the legacy/primary value so older callers keep working.
          select: { id: true, title: true, topicNumber: true, topicCode: true, currentVersion: true, status: true, trainingType: true, trainingTypes: true, durationMinutes: true, materialViewSeconds: true, requiresAssessment: true, supersededByTopicId: true },
        })
      : Promise.resolve([]),
    prisma.assessmentAttempt.findMany({ where: { userId, isDeleted: false }, orderBy: { attemptNumber: 'desc' } }),
  ]);
  const topicMap = new Map(topics.map((t) => [t.id, t]));
  type Res = { isPassed: boolean; score: number | null; attempts: number; passedVersion: number | null };
  const merge = (m: Map<string, Res>, key: string, at: (typeof attempts)[number]) => {
    const cur = m.get(key) ?? { isPassed: false, score: null as number | null, attempts: 0, passedVersion: null as number | null };
    cur.attempts += 1;
    if (at.score !== null && (cur.score === null || at.score > cur.score)) cur.score = at.score;
    if (at.isPassed) {
      cur.isPassed = true;
      // Remember the course version this pass was taken at, so a completed row keeps showing
      // the version it was actually completed at (not the course's newer current version).
      if (at.topicVersion != null && (cur.passedVersion === null || at.topicVersion > cur.passedVersion)) {
        cur.passedVersion = at.topicVersion;
      }
    }
    m.set(key, cur);
  };
  // Result is computed PER-ASSIGNMENT (attempts carry the assignmentId they were taken under),
  // so a fresh re-training assignment on a revised course shows NO prior pass even though an
  // earlier version was passed under a different assignment. The per-course map is kept only as a
  // fallback for legacy attempts that were recorded without a linked assignment.
  const bestByAssignment = new Map<string, Res>();
  const bestByTopic = new Map<string, Res>();
  for (const at of attempts) {
    if (at.assignmentId) merge(bestByAssignment, at.assignmentId, at);
    merge(bestByTopic, at.topicId, at);
  }
  const resultFor = (a: { id: string; topicId: string; status: string }): Res | null => {
    const own = bestByAssignment.get(a.id);
    if (own) return own;
    // No attempt linked to THIS assignment: only a COMPLETED assignment inherits the course's
    // result (legacy). A pending/re-training assignment must never inherit an old-version pass.
    return a.status === 'COMPLETED' ? bestByTopic.get(a.topicId) ?? null : null;
  };
  // A revised course shows ONLY the current version: hide assignments whose course has
  // been superseded by a newer version (the user gets a fresh assignment to it).
  // Also: when a course is UNPUBLISHED (archived/draft), remove its still-actionable
  // assignments from My Trainings instead of leaving a dead end where the user can open
  // the course but "Continue to assessment" is refused. Already-COMPLETED/WAIVED rows are
  // kept as the user's training history (their certificate stands); a pending row simply
  // disappears and reappears if the course is re-published.
  const visible = assignments.filter((a) => {
    const topic = topicMap.get(a.topicId);
    if (!topic) return true;
    if (topic.supersededByTopicId) return false;
    const done = a.status === 'COMPLETED' || a.status === 'WAIVED';
    if (topic.status !== 'PUBLISHED' && !done) return false;
    return true;
  });

  // Item B: compute reading completion for ACTIONABLE assignments so the Assessments page
  // can offer only courses whose materials are fully read and only the assessment remains.
  // (Skipped for non-actionable states — passed / no-assessment / not started — to avoid
  // unnecessary per-assignment reading-log lookups.)
  const readingByAssignment = new Map<string, boolean>();
  await Promise.all(
    visible.map(async (a) => {
      const topic = topicMap.get(a.topicId);
      const passed = resultFor(a)?.isPassed;
      const actionable = (a.status === 'PENDING' || a.status === 'IN_PROGRESS') && !passed && topic?.requiresAssessment !== false;
      readingByAssignment.set(
        a.id,
        actionable && topic ? await hasCompletedRequiredReading(userId, a.topicId, topic.currentVersion ?? 1) : false,
        // // resolvePageCounts: false — this runs once per visible assignment and must not
        // // trigger a document conversion per material just to decide a row's button state.
        // actionable && course
          // ? await hasCompletedRequiredReading(userId, a.topicId, course.currentVersion ?? 1, { resolvePageCounts: false })
          // : false,
      );
    }),
  );

  return visible.map((a) => {
    const topic = topicMap.get(a.topicId) ?? null;
    return {
      id: a.id,
      topicId: a.topicId,
      status: a.status,
      dueDate: a.dueDate,
      refresherDueDate: a.refresherDueDate,
      assignmentType: a.assignmentType,
      requiresSupervisorApproval: a.requiresSupervisorApproval,
      supervisorApprovalStatus: a.supervisorApprovalStatus,
      topic,
      // #7: flat, human-readable fields so no consumer ever falls back to the raw id.
      topicTitle: topic?.title ?? null,
      topicNumber: topic?.topicNumber ?? topic?.topicCode ?? null,
      // A COMPLETED row keeps the version it was actually completed at; an actionable row
      // shows the course's current version (the one the user will take).
      topicVersion:
        (a.status === 'COMPLETED' ? resultFor(a)?.passedVersion ?? null : null) ?? topic?.currentVersion ?? null,
      requiresAssessment: topic?.requiresAssessment ?? true,
      // Item B: only assessments with reading complete + assessment still pending appear
      // in the "Start Assessment" dropdown.
      readingComplete: readingByAssignment.get(a.id) ?? false,
      result: resultFor(a),
    };
  });
}

export async function updateAssignment(id: string, input: UpdateAssignmentInput) {
  const existing = await getAssignment(id);
  if (existing.status === 'NOT_REQUIRED' || input.status === 'NOT_REQUIRED') {
    throw AppError.conflict('Use My Team to manage a not-required training exception.');
  }
  return prisma.trainingAssignment.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    },
  });
}

/** CR-57: activate a DEFERRED (assign-later) assignment so the trainee can begin. */
export async function activateAssignment(id: string) {
  const a = await getAssignment(id);
  if (a.status !== 'DEFERRED') throw AppError.conflict('Only a deferred assignment can be activated.');
  const updated = await prisma.trainingAssignment.update({
    where: { id },
    data: { status: 'PENDING', activateOn: null },
  });
  await notifyTrainingAssigned(updated.userId, updated.topicId, updated.dueDate);
  return updated;
}

/**
 * CR-56: a supervisor signs off on an assignment whose completion fell past the due
 * date (requiresSupervisorApproval). Two-component e-signature; records the decision.
 */
export async function supervisorDecision(id: string, input: SupervisorDecisionInput, req: Request) {
  await getAssignment(id);
  const approved = input.decision === 'APPROVE';
  await signFromRequest(req, 'TrainingAssignment', id, approved ? 'Approved' : 'Rejected');
  return prisma.trainingAssignment.update({
    where: { id },
    data: {
      supervisorApprovalStatus: approved ? 'APPROVED' : 'REJECTED',
      supervisorApprovedBy: req.user!.id,
      supervisorApprovedAt: new Date(),
    },
  });
}

/** Waiving an assignment is a controlled action — requires an e-signature + reason. */
export async function waiveAssignment(id: string, req: Request) {
  const existing = await getAssignment(id);
  if (existing.status === 'NOT_REQUIRED') throw AppError.conflict('This training is not required; restore it before changing its status.');
  await signFromRequest(req, 'TrainingAssignment', id, 'Approved');
  return prisma.trainingAssignment.update({ where: { id }, data: { status: 'WAIVED' } });
}

async function scopedTeamAssignment(id: string, req: Request) {
  const assignment = await getAssignment(id);
  const target = await prisma.user.findFirst({ where: { id: assignment.userId, isDeleted: false }, select: { supervisorId: true } });
  if (!target) throw AppError.notFound('User not found');
  const orgWide = hasOrgWideScope(req.user!.permissions as PermissionMatrix, 'team');
  if (!orgWide && target.supervisorId !== req.user!.id) {
    throw AppError.forbidden('You may only manage training exceptions for your direct reports.');
  }
  return assignment;
}

/** Individual exception: not a completion or waiver; retained for re-assignment checks. */
export async function markNotRequired(id: string, req: Request) {
  const assignment = await scopedTeamAssignment(id, req);
  if (!['PENDING', 'DEFERRED', 'OVERDUE', 'IN_PROGRESS'].includes(assignment.status)) {
    throw AppError.conflict('Only incomplete training may be marked not required.');
  }
  const [topic, attempts, activeAssignments] = await Promise.all([
    prisma.trainingTopic.findFirst({ where: { id: assignment.topicId, isDeleted: false }, select: { status: true, supersededByTopicId: true } }),
    prisma.assessmentAttempt.count({ where: { userId: assignment.userId, topicId: assignment.topicId, isDeleted: false } }),
    prisma.trainingAssignment.findMany({ where: { userId: assignment.userId, topicId: assignment.topicId, isDeleted: false, status: { in: ['PENDING', 'DEFERRED', 'OVERDUE', 'IN_PROGRESS'] } } }),
  ]);
  if (!topic || topic.status !== 'PUBLISHED' || topic.supersededByTopicId) throw AppError.conflict('Only a current published course can be marked not required.');
  if (attempts) throw AppError.conflict('This training already has assessment attempts and cannot be marked not required.');
  if (!activeAssignments.length) throw AppError.conflict('This assignment changed while you were reviewing it. Refresh and try again.');
  const scheduledIds = activeAssignments.map((row) => row.scheduleId).filter((value): value is string => !!value);
  if (scheduledIds.length) {
    const attendance = await prisma.attendance.count({ where: { userId: assignment.userId, scheduleId: { in: scheduledIds }, isDeleted: false } });
    if (attendance) throw AppError.conflict('Attendance has already been recorded for this training and cannot be marked not required.');
  }
  await signFromRequest(req, 'TrainingAssignment', id, 'Approved');
  const reason = req.auditReason!;
  const at = new Date();
  return auditedTransaction(prisma, async (tx) => {
    const updated = [];
    const audits = [];
    for (const row of activeAssignments) {
      updated.push(await tx.trainingAssignment.update({
        where: { id: row.id },
        data: { status: 'NOT_REQUIRED', notRequiredReason: reason, notRequiredBy: req.user!.id, notRequiredAt: at, activateOn: null },
      }));
      audits.push({ action: 'UPDATE', entityType: 'TrainingAssignment', entityId: row.id, oldValue: row, newValue: { status: 'NOT_REQUIRED', notRequiredReason: reason }, reasonForChange: reason });
    }
    return { result: updated, audits };
  });
}

export async function restoreRequired(id: string, req: Request) {
  const assignment = await scopedTeamAssignment(id, req);
  if (assignment.status !== 'NOT_REQUIRED') throw AppError.conflict('This training is not marked not required.');
  const topic = await prisma.trainingTopic.findFirst({ where: { id: assignment.topicId, isDeleted: false }, select: { status: true, supersededByTopicId: true } });
  if (!topic || topic.status !== 'PUBLISHED' || topic.supersededByTopicId) throw AppError.conflict('Only a current published course can be restored.');
  const rows = await prisma.trainingAssignment.findMany({ where: { userId: assignment.userId, topicId: assignment.topicId, isDeleted: false, status: 'NOT_REQUIRED' } });
  if (!rows.length) throw AppError.conflict('This assignment changed while you were reviewing it. Refresh and try again.');
  await signFromRequest(req, 'TrainingAssignment', id, 'Approved');
  const reason = req.auditReason!;
  const restored = await auditedTransaction(prisma, async (tx) => {
    const updated = [];
    const audits = [];
    for (const row of rows) {
      updated.push(await tx.trainingAssignment.update({
        where: { id: row.id },
        data: { status: 'PENDING', dueDate: row.dueDate && row.dueDate < startOfDay(new Date()) ? null : row.dueDate, notRequiredReason: null, notRequiredBy: null, notRequiredAt: null },
      }));
      audits.push({ action: 'UPDATE', entityType: 'TrainingAssignment', entityId: row.id, oldValue: row, newValue: { status: 'PENDING' }, reasonForChange: reason });
    }
    return { result: updated, audits };
  });
  await notifyTrainingAssigned(assignment.userId, assignment.topicId, restored[0]?.dueDate ?? null).catch(() => undefined);
  return restored;
}
