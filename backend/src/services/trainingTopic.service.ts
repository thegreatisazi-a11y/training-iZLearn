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
import { notifyCourseRevised, notifyTrainingAssigned } from './notification.service';
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
      trainingType: input.trainingTypes?.[0] ?? input.trainingType,
      trainingTypes: (input.trainingTypes ?? [input.trainingType]) as Prisma.InputJsonValue,
      status: input.status ?? 'DRAFT', // "Save as Draft" (default) vs "Create & Publish"
      departmentId: input.departmentId ?? null,
      designationId: input.designationId ?? input.designationIds?.[0] ?? null,
      designationIds: (input.designationIds ?? (input.designationId ? [input.designationId] : [])) as Prisma.InputJsonValue,
      roleId: input.roleId ?? null,
      roleIds: (input.roleIds ?? []) as Prisma.InputJsonValue,
      requiresAssessment: input.requiresAssessment ?? true,
      assessmentTimeMinutes: input.assessmentTimeMinutes ?? null,
      signatoryUserIds: (input.signatories?.length ? input.signatories.map((s) => s.userId) : input.signatoryUserIds ?? []) as Prisma.InputJsonValue,
      signatories: (input.signatories ?? []) as Prisma.InputJsonValue,
      sequenceIndex: input.sequenceIndex ?? null,
      durationMinutes: input.durationMinutes ?? 0, // Page 8: optional; defaults to 0 when omitted
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
 *
 * G4: if the topic is PUBLISHED, the edits are NOT applied to the live record — they
 * are staged in `draftMeta` (a draft working copy). The published version stays live
 * and unchanged until `publishDraftChanges` promotes the draft (e-signed, confirmed).
 */
export async function updateTopic(id: string, input: UpdateTopicInput) {
  const topic = await getTopic(id);
  const data: Prisma.TrainingTopicUpdateInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.topicNumber !== undefined ? { topicNumber: input.topicNumber ?? null } : {}),
      ...(input.sopNumber !== undefined ? { sopNumber: input.sopNumber ?? null } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.trainingTypes !== undefined
        ? { trainingTypes: input.trainingTypes as Prisma.InputJsonValue, ...(input.trainingTypes[0] ? { trainingType: input.trainingTypes[0] } : {}) }
        : input.trainingType !== undefined
          ? { trainingType: input.trainingType }
          : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
      ...(input.designationIds !== undefined
        ? { designationIds: input.designationIds as Prisma.InputJsonValue, designationId: input.designationIds[0] ?? null }
        : input.designationId !== undefined
          ? { designationId: input.designationId ?? null }
          : {}),
      ...(input.roleId !== undefined ? { roleId: input.roleId ?? null } : {}),
      ...(input.roleIds !== undefined ? { roleIds: (input.roleIds ?? []) as Prisma.InputJsonValue } : {}),
      ...(input.requiresAssessment !== undefined ? { requiresAssessment: input.requiresAssessment } : {}),
      ...(input.assessmentTimeMinutes !== undefined ? { assessmentTimeMinutes: input.assessmentTimeMinutes ?? null } : {}),
      ...(input.signatories !== undefined
        ? { signatories: input.signatories as Prisma.InputJsonValue, signatoryUserIds: input.signatories.map((s) => s.userId) as Prisma.InputJsonValue }
        : input.signatoryUserIds !== undefined
          ? { signatoryUserIds: (input.signatoryUserIds ?? []) as Prisma.InputJsonValue }
          : {}),
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
  };

  if (topic.status === 'PUBLISHED') {
    // G4: stage the edit as a draft working copy; do not touch the live published record.
    return prisma.trainingTopic.update({ where: { id }, data: { draftMeta: data as Prisma.InputJsonValue } });
  }
  return prisma.trainingTopic.update({ where: { id }, data });
}

/**
 * G2/G4: promote a published topic's pending draft changes to the live record — both
 * the staged metadata (draftMeta) AND any staged material files — then clear the draft.
 * This replaces the old full-course "Revise (new version)" clone: the published course
 * stays the same id and stays live; edits are applied in place only on this controlled,
 * e-signed publish. The caller confirms first.
 */
export async function publishDraftChanges(id: string, req: Request) {
  const topic = await getTopic(id);
  if (topic.status !== 'PUBLISHED') throw AppError.conflict('Only a published course can publish draft changes.');
  const [stagedCount, stagedQuestionCount] = await Promise.all([
    prisma.trainingMaterial.count({ where: { topicId: id, isDeleted: false, isStaged: true } }),
    prisma.question.count({ where: { topicId: id, isDeleted: false, isStaged: true } }),
  ]);
  if (!topic.draftMeta && stagedCount === 0 && stagedQuestionCount === 0) {
    throw AppError.badRequest('There are no pending draft changes to publish.');
  }
  await signFromRequest(req, 'TrainingTopic', id, 'Approved');
  auditContext.setActionOverride('UPDATE');

  // G3/G4: promote staged material files to live. A staged REPLACEMENT supersedes the
  // file it replaces (old → obsolete/version-history); the staged file becomes current.
  if (stagedCount > 0) {
    const staged = await prisma.trainingMaterial.findMany({
      where: { topicId: id, isDeleted: false, isStaged: true },
      select: { id: true, replacesMaterialId: true },
    });
    const replacedIds = staged.map((s) => s.replacesMaterialId).filter((v): v is string => !!v);
    if (replacedIds.length) {
      await prisma.trainingMaterial.updateMany({
        where: { id: { in: replacedIds }, isDeleted: false },
        data: { isCurrentVersion: false, isObsolete: true, archivedAt: new Date(), archivedBy: req.user!.id },
      });
    }
    await prisma.trainingMaterial.updateMany({
      where: { topicId: id, isDeleted: false, isStaged: true },
      data: { isStaged: false, isCurrentVersion: true },
    });
  }

  // G4: promote staged questions to live. A staged EDIT supersedes the live question it
  // replaces (old → soft-deleted); the staged question becomes a live assessment question.
  if (stagedQuestionCount > 0) {
    const stagedQs = await prisma.question.findMany({
      where: { topicId: id, isDeleted: false, isStaged: true },
      select: { id: true, supersedesQuestionId: true },
    });
    const supersededIds = stagedQs.map((q) => q.supersedesQuestionId).filter((v): v is string => !!v);
    if (supersededIds.length) {
      await prisma.question.updateMany({
        where: { id: { in: supersededIds }, isDeleted: false },
        data: { isActive: false, isDeleted: true },
      });
    }
    await prisma.question.updateMany({
      where: { topicId: id, isDeleted: false, isStaged: true },
      data: { isStaged: false },
    });
  }

  const draft = (topic.draftMeta ?? {}) as Prisma.TrainingTopicUpdateInput;
  const promoted = await prisma.trainingTopic.update({ where: { id }, data: { ...draft, draftMeta: null } });
  // After promoting the draft, refresh the signatory completion records (so signatories
  // added/changed during the edit get their COMPLETED record), and assign any newly-
  // matching functional-role users.
  await markSignatoriesComplete(id, req.user!.id);
  await assignToFunctionalRoleHolders(promoted, req.user!.id);
  return promoted;
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
  if (status === 'PUBLISHED') {
    await markSignatoriesComplete(updated.id, req.user!.id);
    // Auto-assign the published course to everyone holding its functional role(s).
    await assignToFunctionalRoleHolders(updated, req.user!.id);
  }
  return updated;
}

/** Merge a user's functional roles (primary designationId + designationIds array). */
function functionalRoleIdsOf(u: { designationId?: string | null; designationIds?: unknown }): string[] {
  const arr = Array.isArray(u.designationIds) ? (u.designationIds as string[]) : [];
  return u.designationId && !arr.includes(u.designationId) ? [...arr, u.designationId] : arr;
}

/**
 * On publish (and re-publish), auto-assign the course to every active user whose
 * functional role(s) match the topic's target functional role(s) (designationIds).
 * Creates a PENDING ROLE_SPECIFIC assignment per user, skipping anyone who already has
 * an active/completed assignment for the topic. TNI remains the separate planned flow.
 * Best-effort — never blocks the publish transition.
 */
async function assignToFunctionalRoleHolders(
  topic: { id: string; designationId?: string | null; designationIds?: unknown },
  actorId: string,
) {
  try {
    const targets = new Set(functionalRoleIdsOf(topic));
    if (!targets.size) return; // no target functional role → nothing to auto-assign.
    const users = await prisma.user.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true, designationId: true, designationIds: true },
    });
    for (const u of users) {
      if (!functionalRoleIdsOf(u).some((r) => targets.has(r))) continue;
      const exists = await prisma.trainingAssignment.findFirst({
        where: { userId: u.id, topicId: topic.id, isDeleted: false, status: { notIn: ['WAIVED'] } },
      });
      if (exists) continue;
      const a = await prisma.trainingAssignment.create({
        data: { userId: u.id, topicId: topic.id, assignmentType: 'ROLE_SPECIFIC', status: 'PENDING', assignedBy: actorId, createdBy: actorId },
      });
      await notifyTrainingAssigned(a.userId, a.topicId, null);
    }
  } catch {
    /* best-effort: a notification/assignment hiccup must not block publish */
  }
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

  // Only the CURRENT version may be revised. Revising an already-superseded version
  // would create a parallel "published" version (two live versions of one course)
  // and is almost always a mistake — point the user at the active version instead.
  if (old.supersededByTopicId) {
    throw AppError.badRequest('This version has already been superseded by a newer revision. Open the current version of the course and revise that instead.');
  }

  // Controlled GMP change — a revision requires a two-component e-signature.
  await signFromRequest(req, 'TrainingTopic', id, 'Approved');

  const actorId = req.user!.id;
  const reason = auditContext.getStore()?.reasonForChange ?? null;
  // topicCode is @unique; a revision keeps the base code (the part before any
  // "-vN" suffix) and appends the new version so traceability is preserved.
  // Earlier revisions in this family may already occupy some "-vN" codes (e.g. a
  // version was revised more than once), so advance past any existing code to
  // guarantee uniqueness — otherwise the create hits a P2002 (409) collision.
  const baseCode = old.topicCode.replace(/-v\d+$/, '');
  // The new version is exactly ONE past the highest version anywhere in this topic
  // family (the base code itself = v1, plus every "<base>-vN" revision). This keeps
  // the increment a consistent +1 from the true latest — never +2 or backwards —
  // regardless of which version was revised, and the topicCode stays unique.
  const family = await prisma.trainingTopic.findMany({
    where: { OR: [{ topicCode: baseCode }, { topicCode: { startsWith: `${baseCode}-v` } }] },
    select: { currentVersion: true },
  });
  const maxVersion = family.reduce((m, t) => Math.max(m, t.currentVersion), old.currentVersion);
  let nextVersion = maxVersion + 1;
  // Safety against any pre-existing code/version drift in the data: never collide.
  while (await prisma.trainingTopic.findUnique({ where: { topicCode: `${baseCode}-v${nextVersion}` } })) {
    nextVersion++;
  }
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
      trainingTypes: (old.trainingTypes ?? [old.trainingType]) as Prisma.InputJsonValue,
      status: old.status === 'ARCHIVED' ? 'PUBLISHED' : old.status,
      departmentId: old.departmentId,
      designationId: old.designationId,
      designationIds: (old.designationIds ?? []) as Prisma.InputJsonValue,
      roleId: old.roleId,
      roleIds: old.roleIds as Prisma.InputJsonValue,
      requiresAssessment: old.requiresAssessment,
      assessmentTimeMinutes: old.assessmentTimeMinutes,
      signatoryUserIds: old.signatoryUserIds as Prisma.InputJsonValue,
      signatories: old.signatories as Prisma.InputJsonValue,
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

  // GMP re-training: a revised SOP/course must be re-completed on the new version.
  // Auto-assign the new version (PENDING) to every user who had the previous version
  // (any status except WAIVED/DEFERRED). Their old, completed v1 assignment is kept
  // for history; the new PENDING v2 assignment reflects the current requirement.
  const priorHolders = await prisma.trainingAssignment.findMany({
    where: { topicId: old.id, isDeleted: false, status: { notIn: ['WAIVED', 'DEFERRED'] } },
    select: { userId: true },
  });
  const holderIds = Array.from(new Set(priorHolders.map((a) => a.userId)));
  for (const uid of holderIds) {
    const exists = await prisma.trainingAssignment.findFirst({ where: { userId: uid, topicId: created.id, isDeleted: false } });
    if (exists) continue;
    await prisma.trainingAssignment.create({
      data: {
        userId: uid,
        topicId: created.id,
        assignmentType: 'COURSE_SPECIFIC',
        status: 'PENDING',
        assignedBy: actorId,
        createdBy: actorId,
      },
    });
  }

  // 7.5: notify assigned trainees (and their supervisors) that the course was revised.
  await notifyCourseRevised(old.id, reason);

  return created;
}

/**
 * Soft-delete (the only kind of delete in izLearn).
 * G5: a course may be deleted only BEFORE it is published. Once published it is part
 * of the controlled record and can only be archived (a separate, e-signed lifecycle
 * action), never deleted.
 */
export async function deactivateTopic(id: string) {
  const topic = await prisma.trainingTopic.findFirst({ where: { id, isDeleted: false }, select: { status: true } });
  if (!topic) throw AppError.notFound('Training topic not found');
  if (topic.status === 'PUBLISHED') {
    throw AppError.conflict('A published course cannot be deleted. Archive it instead.');
  }
  return prisma.trainingTopic.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}
