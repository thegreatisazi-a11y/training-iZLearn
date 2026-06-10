import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { signFromRequest } from './eSignature.service';
import { notifyTrainingAssigned } from './notification.service';
import type { Request } from 'express';
import type { CreateAssignmentInput, UpdateAssignmentInput, PaginationQuery } from '@izlearn/shared';

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

export async function createAssignment(input: CreateAssignmentInput, assignedBy: string) {
  const targets = await resolveTargets(input);
  if (!targets.length) throw AppError.badRequest('No assignment targets could be resolved for this request.');

  // 4.3: only PUBLISHED topics may be assigned — draft/archived topics are not assignable.
  const topicIds = Array.from(new Set(targets.map((t) => t.topicId)));
  const assignable = await prisma.trainingTopic.findMany({
    where: { id: { in: topicIds }, isDeleted: false, status: 'PUBLISHED' },
    select: { id: true },
  });
  const publishedIds = new Set(assignable.map((t) => t.id));
  const blocked = topicIds.filter((id) => !publishedIds.has(id));
  if (blocked.length) {
    throw AppError.badRequest('One or more selected topics are not published and cannot be assigned.');
  }

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
          dueDate: input.dueDate ?? null,
          tniId: input.tniId ?? null,
          assignedBy,
          status: 'PENDING',
          createdBy: assignedBy,
        },
      });
      result.push(a);
      audits.push({ action: 'CREATE', entityType: 'TrainingAssignment', entityId: a.id, newValue: { userId: t.userId, topicId: t.topicId } });
    }
    return { result, audits };
  });

  for (const a of created) await notifyTrainingAssigned(a.userId, a.topicId, a.dueDate);
  return created;
}

export async function listAssignments(q: PaginationQuery & { userId?: string; topicId?: string; status?: string }) {
  const where: Prisma.TrainingAssignmentWhereInput = {
    isDeleted: false,
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.topicId ? { topicId: q.topicId } : {}),
    ...(q.status ? { status: q.status as Prisma.EnumAssignmentStatusFilter['equals'] } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.trainingAssignment.findMany({ where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.trainingAssignment.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getAssignment(id: string) {
  const a = await prisma.trainingAssignment.findFirst({ where: { id, isDeleted: false } });
  if (!a) throw AppError.notFound('Assignment not found');
  return a;
}

/**
 * Step 6: the signed-in user's trainings, enriched with full topic details (name,
 * number, version, status, type, reading time) and their best attempt result, so
 * the "My Trainings" screen can show complete, human-readable training records.
 */
export async function listMyTrainings(userId: string) {
  const assignments = await prisma.trainingAssignment.findMany({
    where: { userId, isDeleted: false },
    orderBy: { createdAt: 'desc' },
  });
  const topicIds = Array.from(new Set(assignments.map((a) => a.topicId)));
  const [topics, attempts] = await Promise.all([
    topicIds.length
      ? prisma.trainingTopic.findMany({
          where: { id: { in: topicIds } },
          select: { id: true, title: true, topicNumber: true, topicCode: true, currentVersion: true, status: true, trainingType: true, materialViewSeconds: true },
        })
      : Promise.resolve([]),
    prisma.assessmentAttempt.findMany({ where: { userId, isDeleted: false }, orderBy: { attemptNumber: 'desc' } }),
  ]);
  const topicMap = new Map(topics.map((t) => [t.id, t]));
  const bestByTopic = new Map<string, { isPassed: boolean; score: number | null; attempts: number }>();
  for (const at of attempts) {
    const cur = bestByTopic.get(at.topicId) ?? { isPassed: false, score: null as number | null, attempts: 0 };
    cur.attempts += 1;
    if (at.isPassed) cur.isPassed = true;
    if (at.score !== null && (cur.score === null || at.score > cur.score)) cur.score = at.score;
    bestByTopic.set(at.topicId, cur);
  }
  return assignments.map((a) => ({
    id: a.id,
    topicId: a.topicId,
    status: a.status,
    dueDate: a.dueDate,
    refresherDueDate: a.refresherDueDate,
    assignmentType: a.assignmentType,
    topic: topicMap.get(a.topicId) ?? null,
    result: bestByTopic.get(a.topicId) ?? null,
  }));
}

export async function updateAssignment(id: string, input: UpdateAssignmentInput) {
  await getAssignment(id);
  return prisma.trainingAssignment.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    },
  });
}

/** Waiving an assignment is a controlled action — requires an e-signature + reason. */
export async function waiveAssignment(id: string, req: Request) {
  await getAssignment(id);
  await signFromRequest(req, 'TrainingAssignment', id, 'Approved');
  return prisma.trainingAssignment.update({ where: { id }, data: { status: 'WAIVED' } });
}
