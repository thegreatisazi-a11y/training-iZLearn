import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { snapshotVersion } from './topicVersionHistory.service';
import type { CreateQuestionInput, UpdateQuestionInput, PaginationQuery } from '@izlearn/shared';

/**
 * A change to a PUBLISHED course's question set is a controlled change: it bumps the
 * course version and writes a version-history snapshot describing what changed (added /
 * edited / removed a question). Draft authoring (before first publish) does not bump —
 * the course publishes at v1 and only post-publish changes are versioned. Returns the
 * (possibly unchanged) current version.
 */
async function recordQuestionChange(topicId: string, changedBy: string, note: string, reason?: string | null): Promise<void> {
  const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false }, select: { status: true } });
  if (!topic || topic.status !== 'PUBLISHED') return;
  const updated = await prisma.trainingTopic.update({ where: { id: topicId }, data: { currentVersion: { increment: 1 } } });
  await snapshotVersion({ topicId, version: updated.currentVersion, changedBy, reason: reason ?? null, note });
}

/** A short, audit-friendly label of a question for the version-history note. */
function questionLabel(text: string): string {
  const t = (text ?? '').trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
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
      isStaged: false,
      createdBy,
    },
  });
  // Adding a question to a published course is a versioned, logged change.
  await recordQuestionChange(input.topicId, createdBy, `Added question: "${questionLabel(input.questionText)}"`);
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

export async function updateQuestion(id: string, input: UpdateQuestionInput, changedBy = 'SYSTEM', reason?: string | null) {
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

  // Editing a question is applied in place. On a PUBLISHED course it is a versioned,
  // logged change (the course version is bumped and a version-history snapshot recorded).
  const updated = await prisma.question.update({ where: { id }, data });
  await recordQuestionChange(
    existing.topicId,
    changedBy,
    `Edited question: "${questionLabel((data.questionText as string) ?? existing.questionText)}"`,
    reason,
  );
  return updated;
}

/**
 * Soft-delete a question (the only kind of delete in izLearn). A question CAN be removed
 * even after the course is published — doing so is a controlled, versioned change: the
 * course version is bumped and the removal is logged in the version history.
 */
export async function deactivateQuestion(id: string, changedBy = 'SYSTEM', reason?: string | null) {
  const q = await getQuestion(id);
  const removed = await prisma.question.update({ where: { id }, data: { isActive: false, isDeleted: true } });
  await recordQuestionChange(q.topicId, changedBy, `Removed question: "${questionLabel(q.questionText)}"`, reason);
  return removed;
}
