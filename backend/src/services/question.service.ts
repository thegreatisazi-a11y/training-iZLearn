import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type { CreateQuestionInput, UpdateQuestionInput, PaginationQuery } from '@izlearn/shared';

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

  return prisma.question.create({
    data: {
      topicId: input.topicId,
      topicVersion: topic.currentVersion,
      questionText: input.questionText,
      questionType: input.questionType,
      options: buildOptionsPayload(input.questionType, input.options, input.matchPairs),
      correctAnswer: input.correctAnswer as Prisma.InputJsonValue,
      explanation: input.explanation ?? null,
      isMandatory: input.isMandatory,
      createdBy,
    },
  });
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

export async function updateQuestion(id: string, input: UpdateQuestionInput) {
  const existing = await getQuestion(id);
  // 4.5: the question type itself is editable. When it changes (or options/pairs are
  // supplied) the options JSON is rebuilt for the effective type so the stored shape
  // always matches the type.
  const effectiveType = input.questionType ?? (existing.questionType as UpdateQuestionInput['questionType']);
  const typeChanged = input.questionType !== undefined && input.questionType !== existing.questionType;
  const optionsProvided = input.options !== undefined || input.matchPairs !== undefined;
  const rebuildOptions = typeChanged || optionsProvided;
  return prisma.question.update({
    where: { id },
    data: {
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
      ...(input.correctAnswer !== undefined
        ? { correctAnswer: input.correctAnswer as Prisma.InputJsonValue }
        : {}),
      ...(input.explanation !== undefined ? { explanation: input.explanation } : {}),
      ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

/** Soft-delete (the only kind of delete in izLearn). */
export async function deactivateQuestion(id: string) {
  await getQuestion(id);
  return prisma.question.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}
