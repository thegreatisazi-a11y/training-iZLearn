import path from 'path';
import fs from 'fs';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { env } from '../config/env';
import { validateUpload, scanFileForVirus, ensureDir } from '../utils/fileUtils';
import { getNumber } from './systemConfig.service';
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
  const [data, total] = await Promise.all([
    prisma.trainingSchedule.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'scheduledDate']: q.sortDir },
    }),
    prisma.trainingSchedule.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getSchedule(id: string) {
  const schedule = await prisma.trainingSchedule.findFirst({ where: { id, isDeleted: false } });
  if (!schedule) throw AppError.notFound('Training schedule not found');
  const trainees = await prisma.trainingAssignment.findMany({
    where: { scheduleId: id, isDeleted: false },
  });
  return { ...schedule, trainees };
}

export async function createSchedule(input: CreateScheduleInput, createdBy: string) {
  // CRITICAL (Module 6): the trainer can never be a trainee in the same schedule.
  if (input.traineeIds.includes(input.trainerId)) {
    throw AppError.badRequest('The trainer cannot be a trainee in the same schedule.');
  }

  const schedule = await auditedTransaction(prisma, async (tx) => {
    const created = await tx.trainingSchedule.create({
      data: {
        topicId: input.topicId,
        scheduledDate: input.scheduledDate,
        trainerId: input.trainerId,
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
  const record = await prisma.ojtRecord.create({
    data: {
      topicId: input.topicId,
      userId: input.userId,
      evaluatorId: input.evaluatorId,
      evaluationDate: input.evaluationDate,
      evaluationScore: input.evaluationScore,
      remarks: input.remarks ?? null,
      createdBy,
    },
  });
  await recordEvent({
    action: 'CREATE',
    entityType: 'OjtRecord',
    entityId: record.id,
    newValue: { topicId: record.topicId, userId: record.userId, evaluationScore: record.evaluationScore },
  });
  return record;
}

export async function listOjtRecords(q: PaginationQuery, filter: { topicId?: string; userId?: string } = {}) {
  const where: Prisma.OjtRecordWhereInput = {
    isDeleted: false,
    ...(filter.topicId ? { topicId: filter.topicId } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.ojtRecord.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'evaluationDate']: q.sortDir },
    }),
    prisma.ojtRecord.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
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

    const assignments = [];
    for (const userId of input.traineeIds) {
      assignments.push(
        await tx.trainingAssignment.create({
          data: {
            userId,
            topicId: input.topicId,
            assignmentType: 'COURSE_SPECIFIC',
            status: 'PENDING',
            assignedBy: createdBy,
            createdBy,
          },
        }),
      );
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
          action: 'CREATE',
          entityType: 'TrainingAssignment',
          entityId: a.id,
          newValue: { userId: a.userId, topicId: a.topicId, assignmentType: a.assignmentType },
        })),
      ],
    };
  });
}

/**
 * Attach an uploaded attendance-sheet file to an offline training record. The
 * upload is validated + virus-scanned, then moved out of tmp into permanent
 * document storage (mirrors the training-material upload flow).
 */
export async function attachOfflineAttendanceSheet(id: string, file: Express.Multer.File) {
  const record = await prisma.offlineTrainingRecord.findFirst({ where: { id, isDeleted: false } });
  if (!record) throw AppError.notFound('Offline training record not found');

  const maxBytes = (await getNumber('upload.max_size_mb', 100)) * 1024 * 1024;
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  ensureDir(env.storage.documents);
  const filePath = path.join(env.storage.documents, file.filename);
  fs.renameSync(file.path, filePath);

  const updated = await prisma.offlineTrainingRecord.update({ where: { id }, data: { attendanceSheet: filePath } });
  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'OfflineTrainingRecord',
    entityId: id,
    newValue: { attendanceSheet: filePath, originalFileName: file.originalname },
  });
  return updated;
}
