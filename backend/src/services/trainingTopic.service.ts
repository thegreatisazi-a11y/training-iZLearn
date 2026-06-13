import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { generateTopicCode } from '../utils/certificateNumber';
import { generateStoredName } from '../utils/fileUtils';
import { toCsv } from '../utils/csv';
import * as storage from './storage.service';
import { signFromRequest } from './eSignature.service';
import { snapshotVersion } from './topicVersionHistory.service';
import { notifyCourseRevised } from './notification.service';
import type {
  CreateTopicInput,
  UpdateTopicInput,
  UpdatePassingScoreInput,
  TopicStatus,
  PaginationQuery,
} from '@izlearn/shared';

/**
 * Training topics (Module 4) — the versioned definition of a training course.
 *
 *  - soft-delete only; reads filter isDeleted and default to active-only.
 *  - topicCode is generated once on creation and is PERMANENTLY locked — it is
 *    never accepted by any update path.
 *  - passingScorePercent is a controlled value: it is changed only through a
 *    dedicated e-signed endpoint, never via the plain update.
 *  - a "revision" creates a NEW topic row (currentVersion + 1) linked to the
 *    original via parentTopicId, and supersedes the prior version's materials.
 *  - plain CRUD writes are captured by the Prisma audit middleware automatically.
 */
export async function listTopics(q: PaginationQuery & { status?: string }, canManage = true) {
  // Status visibility (managers):
  //   ARCHIVED → the Archived / Obsolete history view (read-only).
  //   ALL      → every topic regardless of status/active flag.
  //   default  → the active catalogue: active AND not archived/obsolete.
  // Trainees always see only the active, PUBLISHED catalogue.
  let statusWhere: Prisma.TrainingTopicWhereInput = {};
  if (!canManage) {
    statusWhere = { isActive: true, status: 'PUBLISHED' };
  } else if (q.status === 'ARCHIVED') {
    statusWhere = { status: 'ARCHIVED' };
  } else if (q.status === 'ALL') {
    statusWhere = {};
  } else {
    statusWhere = { isActive: true, status: { not: 'ARCHIVED' } };
  }
  const where: Prisma.TrainingTopicWhereInput = {
    isDeleted: false,
    ...statusWhere,
    ...(q.search
      ? {
          OR: [
            { title: { contains: q.search, mode: 'insensitive' } },
            { topicCode: { contains: q.search, mode: 'insensitive' } },
            { topicNumber: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.trainingTopic.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir },
    }),
    prisma.trainingTopic.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

/** Build a CSV export of the (filtered) topic catalogue. */
export async function exportTopicsCsv(
  filter: { status?: string; search?: string },
  canManage = true,
): Promise<string> {
  // Reuse the same visibility rules as the list (large page so we get everything).
  const { data } = await listTopics(
    { page: 1, pageSize: 100000, sortBy: 'createdAt', sortDir: 'desc', search: filter.search, status: filter.status } as PaginationQuery & { status?: string },
    canManage,
  );
  const headers = ['Topic No.', 'Title', 'Type', 'Duration (min)', 'Pass %', 'Max Attempts', 'Version', 'Status', 'Effective Date', 'Review Date'];
  const rows = data.map((t) => [
    t.topicNumber || t.topicCode,
    t.title,
    t.trainingType,
    t.durationMinutes,
    t.passingScorePercent,
    t.maxAttempts,
    `v${t.currentVersion}`,
    t.status,
    t.effectiveDate ? t.effectiveDate.toISOString().slice(0, 10) : '',
    t.reviewDate ? t.reviewDate.toISOString().slice(0, 10) : '',
  ]);
  return toCsv(headers, rows);
}

export async function getTopic(id: string, canManage = true) {
  const topic = await prisma.trainingTopic.findFirst({ where: { id, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training topic not found');
  // 4.3: a trainee may not open a DRAFT/ARCHIVED topic by id.
  if (!canManage && topic.status !== 'PUBLISHED') throw AppError.notFound('Training topic not found');
  const [materials, questionCount] = await Promise.all([
    prisma.trainingMaterial.findMany({
      // Trainees only ever see the current, non-staged, non-obsolete files.
      where: {
        topicId: id,
        isDeleted: false,
        ...(canManage ? {} : { isCurrentVersion: true, isObsolete: false, isStaged: false }),
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.question.count({ where: { topicId: id, isDeleted: false } }),
  ]);
  return { ...topic, materials, questionCount };
}

export async function createTopic(input: CreateTopicInput, createdBy: string) {
  const sequence = (await prisma.trainingTopic.count()) + 1;
  const topicCode = generateTopicCode(sequence);
  return prisma.trainingTopic.create({
    data: {
      topicCode,
      topicNumber: input.topicNumber ?? null,
      sopNumber: input.sopNumber ?? null,
      title: input.title,
      description: input.description ?? null,
      trainingType: input.trainingType,
      status: input.status ?? 'DRAFT', // "Save as Draft" (default) vs "Create & Publish"
      departmentId: input.departmentId ?? null,
      designationId: input.designationId ?? null,
      roleId: input.roleId ?? null,
      roleIds: (input.roleIds ?? []) as Prisma.InputJsonValue,
      requiresAssessment: input.requiresAssessment ?? true,
      assessmentTimeMinutes: input.assessmentTimeMinutes ?? null,
      signatoryUserIds: (input.signatoryUserIds ?? []) as Prisma.InputJsonValue,
      sequenceIndex: input.sequenceIndex ?? null,
      durationMinutes: input.durationMinutes,
      passingScorePercent: input.passingScorePercent,
      maxAttempts: input.maxAttempts,
      questionLimit: input.questionLimit ?? null,
      ...(input.randomizeQuestions !== undefined ? { randomizeQuestions: input.randomizeQuestions } : {}),
      ...(input.showExplanations !== undefined ? { showExplanations: input.showExplanations } : {}),
      ...(input.blockAfterMaxAttempts !== undefined ? { blockAfterMaxAttempts: input.blockAfterMaxAttempts } : {}),
      refresherIntervalMonths: input.refresherIntervalMonths ?? null,
      materialViewSeconds: input.materialViewSeconds ?? null,
      effectiveDate: input.effectiveDate ?? null,
      reviewDate: input.reviewDate ?? null,
      currentVersion: 1,
      createdBy,
    },
  });
}

/**
 * Plain metadata update. topicCode and passingScorePercent are intentionally
 * NOT updatable here (passing score has its own e-signed endpoint).
 */
export async function updateTopic(id: string, input: UpdateTopicInput) {
  await getTopic(id);
  return prisma.trainingTopic.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.topicNumber !== undefined ? { topicNumber: input.topicNumber ?? null } : {}),
      ...(input.sopNumber !== undefined ? { sopNumber: input.sopNumber ?? null } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.trainingType !== undefined ? { trainingType: input.trainingType } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
      ...(input.designationId !== undefined ? { designationId: input.designationId ?? null } : {}),
      ...(input.roleId !== undefined ? { roleId: input.roleId ?? null } : {}),
      ...(input.roleIds !== undefined ? { roleIds: (input.roleIds ?? []) as Prisma.InputJsonValue } : {}),
      ...(input.requiresAssessment !== undefined ? { requiresAssessment: input.requiresAssessment } : {}),
      ...(input.assessmentTimeMinutes !== undefined ? { assessmentTimeMinutes: input.assessmentTimeMinutes ?? null } : {}),
      ...(input.signatoryUserIds !== undefined ? { signatoryUserIds: (input.signatoryUserIds ?? []) as Prisma.InputJsonValue } : {}),
      ...(input.sequenceIndex !== undefined ? { sequenceIndex: input.sequenceIndex ?? null } : {}),
      ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
      ...(input.refresherIntervalMonths !== undefined
        ? { refresherIntervalMonths: input.refresherIntervalMonths }
        : {}),
      ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
      ...(input.questionLimit !== undefined ? { questionLimit: input.questionLimit ?? null } : {}),
      ...(input.randomizeQuestions !== undefined ? { randomizeQuestions: input.randomizeQuestions } : {}),
      ...(input.showExplanations !== undefined ? { showExplanations: input.showExplanations } : {}),
      ...(input.blockAfterMaxAttempts !== undefined ? { blockAfterMaxAttempts: input.blockAfterMaxAttempts } : {}),
      ...(input.materialViewSeconds !== undefined ? { materialViewSeconds: input.materialViewSeconds ?? null } : {}),
      ...(input.effectiveDate !== undefined ? { effectiveDate: input.effectiveDate ?? null } : {}),
      ...(input.reviewDate !== undefined ? { reviewDate: input.reviewDate ?? null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

/**
 * 4.3 / Step 3: change a topic's lifecycle status (publish / archive / submit for
 * review). Publishing and archiving are controlled GMP transitions and require a
 * two-component e-signature; the reason is captured by the route middleware.
 * When publishing, the effective date is stamped if not already set.
 */
export async function updateTopicStatus(id: string, status: TopicStatus, req: Request) {
  const topic = await getTopic(id);
  // Every controlled lifecycle transition is e-signed (publish / unpublish / archive).
  const meaning = status === 'PUBLISHED' ? 'Approved' : status === 'ARCHIVED' ? 'Performed' : 'Reviewed';
  await signFromRequest(req, 'TrainingTopic', id, meaning);
  const updated = await prisma.trainingTopic.update({
    where: { id },
    data: {
      status,
      ...(status === 'PUBLISHED' && !topic.effectiveDate ? { effectiveDate: new Date() } : {}),
      // CR-26: Unpublish (→ DRAFT / UNDER_REVIEW) must NOT archive — it returns the
      // topic to an editable, active state. Only an explicit Archive deactivates it.
      isActive: status !== 'ARCHIVED',
    },
  });
  // CR-51: on publish, the prepared/reviewed/approved signatories are deemed trained
  // on this course — record a COMPLETED assignment so it shows in their records.
  if (status === 'PUBLISHED') await markSignatoriesComplete(updated.id, req.user!.id);
  return updated;
}

/**
 * CR-51: ensure each signatory user has a COMPLETED training record for this topic.
 * Best-effort — never blocks the publish transition.
 */
async function markSignatoriesComplete(topicId: string, actorId: string) {
  try {
    const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId } });
    const signatoryIds = Array.from(new Set(((topic?.signatoryUserIds as string[]) ?? []).filter(Boolean)));
    if (!signatoryIds.length) return;
    const now = new Date();
    for (const userId of signatoryIds) {
      const existing = await prisma.trainingAssignment.findFirst({ where: { userId, topicId, isDeleted: false } });
      if (existing) {
        if (existing.status !== 'COMPLETED') {
          await prisma.trainingAssignment.update({ where: { id: existing.id }, data: { status: 'COMPLETED' } });
        }
      } else {
        await prisma.trainingAssignment.create({
          data: {
            userId,
            topicId,
            assignmentType: 'PERSON_SPECIFIC',
            status: 'COMPLETED',
            assignedBy: actorId,
            createdBy: actorId,
          },
        });
      }
    }
  } catch {
    /* signatory auto-completion is best-effort */
  }
}

/** Controlled change — changing the passing score requires an e-signature. */
export async function updatePassingScore(id: string, input: UpdatePassingScoreInput, req: Request) {
  await getTopic(id);
  await signFromRequest(req, 'TrainingTopic', id, 'Approved');
  return prisma.trainingTopic.update({
    where: { id },
    data: { passingScorePercent: input.passingScorePercent },
  });
}

/**
 * Create a new content version of a topic. A NEW TrainingTopic row is written
 * (currentVersion + 1, parentTopicId = original); the OLD version is archived and
 * its materials/questions are snapshotted, preserving completed-training links to
 * the old version. Material migration to the new version:
 *
 *  - STAGED files on the old topic (added/replaced/attached while published) are
 *    PROMOTED onto the new version as the current files.
 *  - UNCHANGED current files (not targeted by a staged Replace) are CARRIED
 *    FORWARD (file copied on disk → independent lineage) onto the new version.
 *  - the old version's current files are ARCHIVED (isObsolete + archivedAt/By +
 *    changeReason) and remain visible only in Archived Materials / history.
 *  - the live question set is COPIED to the new version so it is usable.
 */
export async function reviseTopic(id: string, req: Request) {
  const old = await prisma.trainingTopic.findFirst({ where: { id, isDeleted: false } });
  if (!old) throw AppError.notFound('Training topic not found');

  // Controlled GMP change — a revision requires a two-component e-signature.
  await signFromRequest(req, 'TrainingTopic', id, 'Approved');

  const actorId = req.user!.id;
  const reason = auditContext.getStore()?.reasonForChange ?? null;
  const nextVersion = old.currentVersion + 1;
  // topicCode is @unique; a revision keeps the base code (the part before any
  // "-vN" suffix) and appends the new version so traceability is preserved
  // without colliding with the prior row.
  const baseCode = old.topicCode.replace(/-v\d+$/, '');
  // The revised version carries forward all SOP metadata and becomes the active
  // version (inherits the old status; a previously-archived topic re-publishes).
  const created = await prisma.trainingTopic.create({
    data: {
      topicCode: `${baseCode}-v${nextVersion}`,
      topicNumber: old.topicNumber,
      sopNumber: old.sopNumber,
      title: old.title,
      description: old.description,
      trainingType: old.trainingType,
      status: old.status === 'ARCHIVED' ? 'PUBLISHED' : old.status,
      departmentId: old.departmentId,
      designationId: old.designationId,
      roleId: old.roleId,
      roleIds: old.roleIds as Prisma.InputJsonValue,
      requiresAssessment: old.requiresAssessment,
      assessmentTimeMinutes: old.assessmentTimeMinutes,
      signatoryUserIds: old.signatoryUserIds as Prisma.InputJsonValue,
      sequenceIndex: old.sequenceIndex,
      durationMinutes: old.durationMinutes,
      passingScorePercent: old.passingScorePercent,
      maxAttempts: old.maxAttempts,
      questionLimit: old.questionLimit,
      randomizeQuestions: old.randomizeQuestions,
      showExplanations: old.showExplanations,
      blockAfterMaxAttempts: old.blockAfterMaxAttempts,
      refresherIntervalMonths: old.refresherIntervalMonths,
      materialViewSeconds: old.materialViewSeconds,
      effectiveDate: new Date(),
      reviewDate: old.reviewDate,
      currentVersion: nextVersion,
      parentTopicId: old.id, // links this revision back to its immediate predecessor
      createdBy: actorId,
    },
  });

  // Gather the old topic's staged + current materials.
  const [staged, current] = await Promise.all([
    prisma.trainingMaterial.findMany({ where: { topicId: old.id, isDeleted: false, isStaged: true } }),
    prisma.trainingMaterial.findMany({
      where: { topicId: old.id, isDeleted: false, isStaged: false, isCurrentVersion: true, isObsolete: false },
    }),
  ]);
  const replacedIds = new Set(staged.map((s) => s.replacesMaterialId).filter(Boolean) as string[]);

  // Carry forward unchanged current files (those not superseded by a staged Replace).
  for (const m of current) {
    if (replacedIds.has(m.id)) continue;
    const storedFileName = generateStoredName(m.originalFileName);
    const destKey = `materials/${storedFileName}`;
    if (await storage.objectExists(m.filePath)) await storage.copyObject(m.filePath, destKey);
    await prisma.trainingMaterial.create({
      data: {
        topicId: created.id,
        originalFileName: m.originalFileName,
        storedFileName,
        filePath: destKey,
        fileType: m.fileType,
        fileSize: m.fileSize,
        requiredViewSeconds: m.requiredViewSeconds,
        version: m.version,
        isCurrentVersion: true,
        createdBy: actorId,
      },
    });
  }

  // Promote staged files onto the new version (the file is already on disk).
  for (const s of staged) {
    await prisma.trainingMaterial.update({
      where: { id: s.id },
      data: { topicId: created.id, isStaged: false, isCurrentVersion: true, isObsolete: false, replacesMaterialId: null },
    });
  }

  // Copy the live question set onto the new version so it is immediately usable.
  const questions = await prisma.question.findMany({ where: { topicId: old.id, isDeleted: false } });
  for (const q of questions) {
    await prisma.question.create({
      data: {
        topicId: created.id,
        topicVersion: nextVersion,
        questionText: q.questionText,
        questionType: q.questionType,
        options: q.options === null ? null : (q.options as Prisma.InputJsonValue),
        correctAnswer: q.correctAnswer as Prisma.InputJsonValue,
        explanation: q.explanation,
        helpText: q.helpText,
        isMandatory: q.isMandatory,
        createdBy: actorId,
      },
    });
  }

  // 4.4: snapshot the SUPERSEDED version (its current materials + question set as
  // they were) BEFORE archiving its materials, so history shows the old files.
  await snapshotVersion({
    topicId: old.id,
    version: old.currentVersion,
    changedBy: actorId,
    reason,
    note: `Revised to v${nextVersion}`,
  });

  // Archive the old version's current files → Archived Materials / version history,
  // stamping who/when/why so the archive view shows the full change context.
  await prisma.trainingMaterial.updateMany({
    where: { topicId: old.id, isDeleted: false, isCurrentVersion: true },
    data: { isCurrentVersion: false, isObsolete: true, archivedAt: new Date(), archivedBy: actorId, changeReason: reason },
  });

  // Auto-archive the superseded version: it moves to Version History and is no
  // longer active, visible to trainees, or assignable. Completed records and the
  // history snapshot keep it fully traceable (no hard delete).
  await prisma.trainingTopic.update({
    where: { id: old.id },
    data: { status: 'ARCHIVED', isActive: false, supersededByTopicId: created.id },
  });

  // 7.5: notify assigned trainees (and their supervisors) that the course was revised.
  await notifyCourseRevised(old.id, reason);

  return created;
}

/** Soft-delete (the only kind of delete in izLearn). */
export async function deactivateTopic(id: string) {
  await prisma.trainingTopic.findFirst({ where: { id, isDeleted: false } }).then((t) => {
    if (!t) throw AppError.notFound('Training topic not found');
  });
  return prisma.trainingTopic.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}
