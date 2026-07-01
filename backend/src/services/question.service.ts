import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type { CreateQuestionInput, UpdateQuestionInput, PaginationQuery } from '@izlearn/shared';

/**
 * Question changes on a PUBLISHED course follow the staged-draft flow (like materials
 * and course details): an add/edit/remove is STAGED and does not touch the live
 * assessment. The staged changes go live only via `publishDraftChanges` (e-signed),
 * which bumps the course version ONCE and writes a single version-history entry. On a
 * DRAFT course (still being authored, nothing live yet) changes apply in place.
 */
function isPublishedTopic(status?: string): boolean {
  return status === 'PUBLISHED';
}

/**
 * Question bank (Module 7) — the pool of assessment questions per training
 * topic version.
 *
 *  - a question is pinned to the topic's CURRENT version at creation time
 *    (topicVersion) so revising a topic does not silently change old questions.
 *  - options carry stable ids; for MATCH_THE_WORDS the left/right pairs are
 *    stored inside the options JSON. correctAnswer is stored as JSON (an array
 *    of option ids or an answer string per question type).
 *  - soft-delete only; plain CRUD is captured by the Prisma audit middleware.
 */

/** Ensure every option has a stable id (generate one when absent). */
function normalizeOptions(options?: { id?: string; text: string }[]) {
  return (options ?? []).map((o) => ({ id: o.id && o.id.length ? o.id : randomUUID(), text: o.text }));
}

/** Build the options JSON payload, folding MATCH_THE_WORDS pairs in. */
function buildOptionsPayload(
  questionType: CreateQuestionInput['questionType'],
  options?: { id?: string; text: string }[],
  matchPairs?: { left: string; right: string }[],
): Prisma.InputJsonValue | undefined {
  if (questionType === 'MATCH_THE_WORDS') {
    return { matchPairs: matchPairs ?? [] } as Prisma.InputJsonValue;
  }
  const normalized = normalizeOptions(options);
  return normalized.length ? (normalized as unknown as Prisma.InputJsonValue) : undefined;
}

export async function createQuestion(input: CreateQuestionInput, createdBy: string) {
  const topic = await prisma.trainingTopic.findFirst({ where: { id: input.topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training topic not found');

  // CR-36: for MATCH_THE_WORDS the answer key IS the set of pairs, so derive it
  // from matchPairs (never trust a separately-supplied answer that could drift).
  const correctAnswer =
    input.questionType === 'MATCH_THE_WORDS'
      ? ((input.matchPairs ?? []) as Prisma.InputJsonValue)
      : (input.correctAnswer as Prisma.InputJsonValue);

  // On a published course a new question is STAGED (inert) until the changes are
  // published; on a draft course it is live immediately.
  const staged = isPublishedTopic(topic.status);
  const question = await prisma.question.create({
    data: {
      topicId: input.topicId,
      topicVersion: topic.currentVersion,
      questionText: input.questionText,
      questionType: input.questionType,
      options: buildOptionsPayload(input.questionType, input.options, input.matchPairs),
      correctAnswer,
      explanation: input.explanation ?? null,
      helpText: input.helpText ?? null,
      isMandatory: input.isMandatory,
      isStaged: staged,
      createdBy,
    },
  });
  return question;
}

export async function listQuestions(q: PaginationQuery & { topicId?: string }) {
  const where: Prisma.QuestionWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.topicId ? { topicId: q.topicId } : {}),
    ...(q.search ? { questionText: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.question.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir },
    }),
    prisma.question.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getQuestion(id: string) {
  const question = await prisma.question.findFirst({ where: { id, isDeleted: false } });
  if (!question) throw AppError.notFound('Question not found');
  return question;
}

export async function updateQuestion(id: string, input: UpdateQuestionInput, changedBy = 'SYSTEM') {
  const existing = await getQuestion(id);
  // 4.5: the question type itself is editable. When it changes (or options/pairs are
  // supplied) the options JSON is rebuilt for the effective type so the stored shape
  // always matches the type.
  const effectiveType = input.questionType ?? (existing.questionType as UpdateQuestionInput['questionType']);
  const typeChanged = input.questionType !== undefined && input.questionType !== existing.questionType;
  const optionsProvided = input.options !== undefined || input.matchPairs !== undefined;
  const rebuildOptions = typeChanged || optionsProvided;
  const data = {
      ...(input.questionText !== undefined ? { questionText: input.questionText } : {}),
      ...(input.questionType !== undefined ? { questionType: input.questionType } : {}),
      ...(rebuildOptions
        ? {
            options: buildOptionsPayload(
              effectiveType as CreateQuestionInput['questionType'],
              input.options,
              input.matchPairs,
            ) ?? null,
          }
        : {}),
      ...(effectiveType === 'MATCH_THE_WORDS' && input.matchPairs !== undefined
        ? { correctAnswer: (input.matchPairs ?? []) as Prisma.InputJsonValue }
        : input.correctAnswer !== undefined
          ? { correctAnswer: input.correctAnswer as Prisma.InputJsonValue }
          : {}),
      ...(input.explanation !== undefined ? { explanation: input.explanation } : {}),
      ...(input.helpText !== undefined ? { helpText: input.helpText } : {}),
      ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };

  const topic = await prisma.trainingTopic.findFirst({
    where: { id: existing.topicId, isDeleted: false },
    select: { status: true, currentVersion: true },
  });
  // On a PUBLISHED course an edit is STAGED — never mutate the live question in place.
  // Editing a draft row itself (isStaged) or any edit on a DRAFT course applies in place.
  if (isPublishedTopic(topic?.status) && !existing.isStaged) {
    // If a staged edit for this live question already exists, update that draft;
    // otherwise create a staged copy (live content overlaid with the edits) that
    // supersedes the live question when published. The live row stays untouched.
    const draft = await prisma.question.findFirst({
      where: { topicId: existing.topicId, isDeleted: false, isStaged: true, supersedesQuestionId: existing.id },
    });
    if (draft) return prisma.question.update({ where: { id: draft.id }, data });
    const base = {
      questionText: existing.questionText,
      questionType: existing.questionType,
      options: existing.options as Prisma.InputJsonValue,
      correctAnswer: existing.correctAnswer as Prisma.InputJsonValue,
      explanation: existing.explanation,
      helpText: existing.helpText,
      isMandatory: existing.isMandatory,
      isActive: existing.isActive,
    };
    return prisma.question.create({
      data: {
        ...base,
        ...data,
        topicId: existing.topicId,
        topicVersion: topic!.currentVersion,
        isStaged: true,
        supersedesQuestionId: existing.id,
        createdBy: changedBy,
      },
    });
  }
  return prisma.question.update({ where: { id }, data });
}

/**
 * Soft-delete a question (the only kind of delete in izLearn). On a PUBLISHED course the
 * removal is STAGED: a staged draft row is simply discarded, while a live question is
 * flagged pendingRemoval and stays served until the changes are published (then it is
 * soft-deleted). On a DRAFT course it is soft-deleted in place.
 */
export async function deactivateQuestion(id: string) {
  const q = await getQuestion(id);
  const topic = await prisma.trainingTopic.findFirst({ where: { id: q.topicId, isDeleted: false }, select: { status: true } });
  if (isPublishedTopic(topic?.status)) {
    // A staged add/edit that never went live → just discard the draft (no live impact).
    if (q.isStaged) return prisma.question.update({ where: { id }, data: { isActive: false, isDeleted: true } });
    // A live question → stage its removal; it stays served until the changes publish.
    // Also discard any staged EDIT of this question so the two don't both fire on publish.
    await prisma.question.updateMany({
      where: { topicId: q.topicId, isDeleted: false, isStaged: true, supersedesQuestionId: q.id },
      data: { isActive: false, isDeleted: true },
    });
    return prisma.question.update({ where: { id }, data: { pendingRemoval: true } });
  }
  return prisma.question.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}
