import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { validateUpload, scanFileForVirus } from '../utils/fileUtils';
import { getNumber } from './systemConfig.service';
import * as storage from './storage.service';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { recordEvent } from './auditTrail.service';
import { notifyScheduleCreated } from './notification.service';
import type {
  CreateScheduleInput,
  UpdateScheduleInput,
  OjtRecordInput,
  OfflineTrainingInput,
  PaginationQuery,
} from '@izlearn/shared';

/**
 * Training scheduling & delivery (Module 6). Soft-delete only; plain writes are
 * captured by the Prisma audit middleware automatically. Creating a schedule
 * also provisions one COURSE_SPECIFIC TrainingAssignment per trainee in the same
 * audited transaction. Authoritative time is always the server clock — client
 * timestamps are never trusted for "now".
 */

export interface ScheduleListFilter {
  topicId?: string;
  status?: string;
  from?: Date;
  to?: Date;
}

export async function listSchedules(q: PaginationQuery, filter: ScheduleListFilter = {}) {
  const where: Prisma.TrainingScheduleWhereInput = {
    isDeleted: false,
    ...(filter.topicId ? { topicId: filter.topicId } : {}),
    ...(filter.status ? { status: filter.status as Prisma.EnumScheduleStatusFilter['equals'] } : {}),
    ...(filter.from || filter.to
      ? {
          scheduledDate: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.trainingSchedule.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'scheduledDate']: q.sortDir },
    }),
    prisma.trainingSchedule.count({ where }),
  ]);
  const data = (await withTopicAndUserNames(rows, (r) => [r.topicId], (r) => [r.trainerId])).map((r) => ({
    ...r,
    // External trainer name (stored) takes precedence; otherwise resolve the internal trainer's name.
    trainerName: r.trainerName ?? (r.trainerId ? r.userNames[r.trainerId] ?? null : null),
  }));
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getSchedule(id: string) {
  const schedule = await prisma.trainingSchedule.findFirst({ where: { id, isDeleted: false } });
  if (!schedule) throw AppError.notFound('Training schedule not found');
  const rawTrainees = await prisma.trainingAssignment.findMany({
    where: { scheduleId: id, isDeleted: false },
  });
  // Resolve trainee names/codes and the topic title so the UI shows names, not raw ids.
  const userIds = Array.from(new Set(rawTrainees.map((t) => t.userId)));
  const [users, topic] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, employeeId: true } }) : [],
    prisma.trainingTopic.findUnique({ where: { id: schedule.topicId }, select: { title: true, topicNumber: true, topicCode: true } }),
  ]);
  const uMap = new Map(users.map((u) => [u.id, u]));
  const trainees = rawTrainees.map((t) => ({
    ...t,
    fullName: uMap.get(t.userId)?.fullName ?? null,
    employeeId: uMap.get(t.userId)?.employeeId ?? null,
  }));
  return {
    ...schedule,
    topicTitle: topic?.title ?? null,
    topicNumber: topic?.topicNumber ?? topic?.topicCode ?? null,
    trainees,
  };
}

export async function createSchedule(input: CreateScheduleInput, createdBy: string) {
  // CRITICAL (Module 6): an INTERNAL trainer can never be a trainee in the same schedule.
  // (An external trainer has no user id, so this check does not apply to them.)
  if (input.trainerId && input.traineeIds.includes(input.trainerId)) {
    throw AppError.badRequest('The trainer cannot be a trainee in the same schedule.');
  }

  // L-S2: sanity checks for a NEW schedule.
  //  - Not in the past (a session is scheduled for today or later).
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (new Date(input.scheduledDate) < start) {
    throw AppError.badRequest('The scheduled date cannot be in the past.');
  }
  //  - Trainee count within the venue capacity.
  if (input.maxTrainees != null && input.traineeIds.length > input.maxTrainees) {
    throw AppError.badRequest(`This schedule allows at most ${input.maxTrainees} trainees (${input.traineeIds.length} selected).`);
  }
  //  - The trainer isn't already running another session on the same day (double-booking).
  if (input.trainerId) {
    const dayStart = new Date(input.scheduledDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const clash = await prisma.trainingSchedule.findFirst({
      where: { trainerId: input.trainerId, isDeleted: false, scheduledDate: { gte: dayStart, lt: dayEnd } },
    });
    if (clash) throw AppError.badRequest('This trainer already has a schedule on the selected day.');
  }

  const schedule = await auditedTransaction(prisma, async (tx) => {
    const created = await tx.trainingSchedule.create({
      data: {
        topicId: input.topicId,
        scheduledDate: input.scheduledDate,
        trainerId: input.trainerId ?? null,
        trainerName: input.trainerName?.trim() || null, // external trainer name (when no user picked)
        trainingType: input.trainingType,
        methodology: input.methodology ?? null,
        venue: input.venue ?? null,
        maxTrainees: input.maxTrainees ?? null,
        createdBy,
      },
    });

    const assignments = [];
    for (const userId of input.traineeIds) {
      assignments.push(
        await tx.trainingAssignment.create({
          data: {
            userId,
            topicId: input.topicId,
            scheduleId: created.id,
            assignmentType: 'COURSE_SPECIFIC',
            status: 'PENDING',
            assignedBy: createdBy,
            createdBy,
          },
        }),
      );
    }

    return {
      result: created,
      audits: [
        {
          action: 'CREATE',
          entityType: 'TrainingSchedule',
          entityId: created.id,
          newValue: { topicId: created.topicId, scheduledDate: created.scheduledDate, trainerId: created.trainerId },
        },
        ...assignments.map((a) => ({
          action: 'CREATE',
          entityType: 'TrainingAssignment',
          entityId: a.id,
          newValue: { userId: a.userId, topicId: a.topicId, scheduleId: a.scheduleId, assignmentType: a.assignmentType },
        })),
      ],
    };
  });

  await notifyScheduleCreated(input.traineeIds, input.topicId, input.scheduledDate, input.venue);
  return schedule;
}

export async function updateSchedule(id: string, input: UpdateScheduleInput) {
  await getSchedule(id);
  // L-S1: enforce the trainer-cannot-be-trainee rule on UPDATE too (not just create) —
  // a trainer can't be set to someone already enrolled as a trainee on this schedule.
  if (input.trainerId) {
    const enrolled = await prisma.trainingAssignment.findFirst({
      where: { scheduleId: id, userId: input.trainerId, isDeleted: false },
    });
    if (enrolled) throw AppError.badRequest('The trainer cannot be a trainee in the same schedule.');
  }
  return prisma.trainingSchedule.update({
    where: { id },
    data: {
      ...(input.scheduledDate !== undefined ? { scheduledDate: input.scheduledDate } : {}),
      ...(input.trainerId !== undefined ? { trainerId: input.trainerId } : {}),
      ...(input.methodology !== undefined ? { methodology: input.methodology } : {}),
      ...(input.venue !== undefined ? { venue: input.venue } : {}),
      ...(input.maxTrainees !== undefined ? { maxTrainees: input.maxTrainees } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
}

export async function cancelSchedule(id: string) {
  await getSchedule(id);
  return prisma.trainingSchedule.update({ where: { id }, data: { status: 'CANCELLED' } });
}

// ---- OJT records ------------------------------------------------------------

export async function createOjtRecord(input: OjtRecordInput, createdBy: string) {
  // evaluationDate is constrained to past/present by the shared schema.
  // An OJT record is evidence of training that ALREADY happened, so it is recorded
  // together with a COMPLETED training assignment for the trainee (visible in their
  // My Training as completed), in one audited transaction.
  return auditedTransaction(prisma, async (tx) => {
    const record = await tx.ojtRecord.create({
      data: {
        topicId: input.topicId,
        userId: input.userId,
        evaluatorId: input.evaluatorId ?? null,
        evaluatorName: input.evaluatorName?.trim() || null, // external evaluator name (when no user picked)
        evaluationDate: input.evaluationDate,
        evaluationScore: input.evaluationScore,
        content: input.content ?? null,
        remarks: input.remarks ?? null,
        createdBy,
      },
    });
    const assignment = await completeAssignmentTx(tx, input.userId, input.topicId, createdBy);
    return {
      result: record,
      audits: [
        {
          action: 'CREATE',
          entityType: 'OjtRecord',
          entityId: record.id,
          newValue: { topicId: record.topicId, userId: record.userId, evaluationScore: record.evaluationScore },
        },
        {
          action: 'UPDATE',
          entityType: 'TrainingAssignment',
          entityId: assignment.id,
          newValue: { userId: assignment.userId, topicId: assignment.topicId, status: 'COMPLETED', via: 'OJT' },
        },
      ],
    };
  });
}

/**
 * Mark a (user, topic) training as COMPLETED: complete an existing active assignment if
 * present, otherwise create a COMPLETED one. Used by OJT and offline records, which
 * document training that has already taken place. Runs inside an audited transaction.
 */
async function completeAssignmentTx(
  tx: Prisma.TransactionClient,
  userId: string,
  topicId: string,
  assignedBy: string,
) {
  const existing = await tx.trainingAssignment.findFirst({
    where: { userId, topicId, isDeleted: false, status: { notIn: ['WAIVED'] } },
  });
  if (existing) {
    if (existing.status === 'COMPLETED') return existing;
    return tx.trainingAssignment.update({ where: { id: existing.id }, data: { status: 'COMPLETED' } });
  }
  return tx.trainingAssignment.create({
    data: { userId, topicId, assignmentType: 'COURSE_SPECIFIC', status: 'COMPLETED', assignedBy, createdBy: assignedBy },
  });
}

export async function listOjtRecords(q: PaginationQuery, filter: { topicId?: string; userId?: string } = {}) {
  const where: Prisma.OjtRecordWhereInput = {
    isDeleted: false,
    ...(filter.topicId ? { topicId: filter.topicId } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.ojtRecord.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'evaluationDate']: q.sortDir },
    }),
    prisma.ojtRecord.count({ where }),
  ]);
  const data = await withTopicAndUserNames(rows, (r) => [r.topicId], (r) => [r.userId, r.evaluatorId]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

/**
 * Attach topicTitle / topicNumber and user full names to a set of records for display
 * in the Scheduling window (MongoDB has no relational join). `topicOf`/`usersOf` extract
 * the ids to resolve from each row; the result adds topicTitle, topicNumber, and a
 * `userNames` map (userId → fullName) plus convenience `userFullName`/`evaluatorName`.
 */
async function withTopicAndUserNames<T extends Record<string, unknown>>(
  rows: T[],
  topicOf: (r: T) => (string | null | undefined)[],
  usersOf: (r: T) => (string | null | undefined)[],
): Promise<Array<T & { topicTitle: string | null; topicNumber: string | null; userNames: Record<string, string>; userFullName: string | null; evaluatorName: string | null }>> {
  const topicIds = Array.from(new Set(rows.flatMap((r) => topicOf(r)).filter(Boolean) as string[]));
  const userIds = Array.from(new Set(rows.flatMap((r) => usersOf(r)).filter(Boolean) as string[]));
  const [topics, users] = await Promise.all([
    topicIds.length ? prisma.trainingTopic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true, topicNumber: true, topicCode: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [],
  ]);
  const tMap = new Map(topics.map((t) => [t.id, t]));
  const uMap = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => {
    const t = tMap.get(topicOf(r)[0] ?? '');
    const names: Record<string, string> = {};
    for (const id of usersOf(r)) if (id && uMap.has(id)) names[id] = uMap.get(id)!;
    return {
      ...r,
      topicTitle: t?.title ?? null,
      topicNumber: t?.topicNumber ?? t?.topicCode ?? null,
      userNames: names,
      userFullName: (r.userId ? uMap.get(r.userId as string) : null) ?? null,
      // External evaluator name (stored) takes precedence; otherwise resolve the internal one.
      evaluatorName:
        (r.evaluatorName as string | null | undefined) ?? (r.evaluatorId ? uMap.get(r.evaluatorId as string) ?? null : null),
    };
  });
}

// ---- Offline / classroom training -------------------------------------------

export async function createOfflineTraining(input: OfflineTrainingInput, createdBy: string) {
  return auditedTransaction(prisma, async (tx) => {
    const record = await tx.offlineTrainingRecord.create({
      data: {
        topicId: input.topicId,
        venue: input.venue,
        trainerName: input.trainerName,
        durationMinutes: input.durationMinutes,
        trainingDate: input.trainingDate,
        traineeIds: input.traineeIds as Prisma.InputJsonValue,
        createdBy,
      },
    });

    // Offline training is a record of training that already occurred, so each trainee's
    // assignment is marked COMPLETED (shown in their My Training as completed).
    const assignments = [];
    for (const userId of input.traineeIds) {
      assignments.push(await completeAssignmentTx(tx, userId, input.topicId, createdBy));
    }

    return {
      result: record,
      audits: [
        {
          action: 'CREATE',
          entityType: 'OfflineTrainingRecord',
          entityId: record.id,
          newValue: { topicId: record.topicId, venue: record.venue, trainingDate: record.trainingDate },
        },
        ...assignments.map((a) => ({
          action: 'UPDATE',
          entityType: 'TrainingAssignment',
          entityId: a.id,
          newValue: { userId: a.userId, topicId: a.topicId, status: 'COMPLETED', via: 'OFFLINE' },
        })),
      ],
    };
  });
}

/** List offline training records (Module 6) — shown in the Scheduling window. */
export async function listOfflineRecords(q: PaginationQuery, filter: { topicId?: string } = {}) {
  const where: Prisma.OfflineTrainingRecordWhereInput = {
    isDeleted: false,
    ...(filter.topicId ? { topicId: filter.topicId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.offlineTrainingRecord.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'trainingDate']: q.sortDir },
    }),
    prisma.offlineTrainingRecord.count({ where }),
  ]);
  const data = await withTopicAndUserNames(rows, (r) => [r.topicId], () => []);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

/**
 * Attach an uploaded attendance-sheet file to an offline training record. The
 * upload is validated + virus-scanned, then moved out of tmp into permanent
 * document storage (mirrors the training-material upload flow).
 */
export async function attachOfflineAttendanceSheet(id: string, file: Express.Multer.File) {
  const record = await prisma.offlineTrainingRecord.findFirst({ where: { id, isDeleted: false } });
  if (!record) throw AppError.notFound('Offline training record not found');

  const maxBytes = (await getNumber('upload.max_size_mb', 0)) * 1024 * 1024;
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  const key = `attendance/${file.filename}`;
  await storage.putFile(key, file.path, file.mimetype);

  const updated = await prisma.offlineTrainingRecord.update({ where: { id }, data: { attendanceSheet: key } });
  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'OfflineTrainingRecord',
    entityId: id,
    newValue: { attendanceSheet: key, originalFileName: file.originalname },
  });
  return updated;
}
