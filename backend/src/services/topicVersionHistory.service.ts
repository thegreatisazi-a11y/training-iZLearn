import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { PaginationQuery } from '@izlearn/shared';

/**
 * Topic version history (4.4). Each entry is a point-in-time snapshot of a topic's
 * materials AND questions, written whenever a new file supersedes the topic's
 * content (per-file replace, library attach, or a full reviseTopic). The live
 * Question rows are never touched — only a copy is recorded here.
 */

export async function snapshotVersion(opts: {
  topicId: string;
  version: number;
  changedBy: string;
  reason?: string | null;
  note?: string | null;
}) {
  const [materials, questions] = await Promise.all([
    prisma.trainingMaterial.findMany({
      where: { topicId: opts.topicId, isDeleted: false },
      orderBy: { version: 'asc' },
    }),
    prisma.question.findMany({
      where: { topicId: opts.topicId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const materialsSnapshot = materials.map((m) => ({
    id: m.id,
    originalFileName: m.originalFileName,
    fileType: m.fileType,
    fileSize: m.fileSize,
    version: m.version,
    isCurrentVersion: m.isCurrentVersion,
    isObsolete: m.isObsolete,
    createdAt: m.createdAt.toISOString(),
  }));

  const questionsSnapshot = questions.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    questionType: q.questionType,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    isMandatory: q.isMandatory,
  }));

  return prisma.topicVersionHistory.create({
    data: {
      topicId: opts.topicId,
      version: opts.version,
      changedBy: opts.changedBy,
      reason: opts.reason ?? null,
      note: opts.note ?? null,
      materialsSnapshot: materialsSnapshot as unknown as Prisma.InputJsonValue,
      questionsSnapshot: questionsSnapshot as unknown as Prisma.InputJsonValue,
      createdBy: opts.changedBy,
    },
  });
}

export async function listVersionHistory(topicId: string, q: PaginationQuery) {
  const where = { topicId, isDeleted: false };
  const [data, total] = await Promise.all([
    prisma.topicVersionHistory.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { changedAt: 'desc' },
    }),
    prisma.topicVersionHistory.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}
