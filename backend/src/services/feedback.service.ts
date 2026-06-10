import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type {
  CreateFeedbackFormInput,
  UpdateFeedbackFormInput,
  SubmitFeedbackInput,
  FeedbackQuestion,
  PaginationQuery,
} from '@izlearn/shared';

export async function listForms(q: PaginationQuery & { topicId?: string }) {
  const where: Prisma.FeedbackFormWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.topicId ? { topicId: q.topicId } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.feedbackForm.findMany({ where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.feedbackForm.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getForm(id: string) {
  const form = await prisma.feedbackForm.findFirst({ where: { id, isDeleted: false } });
  if (!form) throw AppError.notFound('Feedback form not found');
  return form;
}

export async function createForm(input: CreateFeedbackFormInput, createdBy: string) {
  return prisma.feedbackForm.create({
    data: { topicId: input.topicId, title: input.title, questions: input.questions as unknown as Prisma.InputJsonValue, createdBy },
  });
}

export async function updateForm(id: string, input: UpdateFeedbackFormInput) {
  await getForm(id);
  return prisma.feedbackForm.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.questions !== undefined ? { questions: input.questions as unknown as Prisma.InputJsonValue } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

export async function deactivateForm(id: string) {
  await getForm(id);
  return prisma.feedbackForm.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}

export async function submitFeedback(input: SubmitFeedbackInput, userId: string) {
  await getForm(input.formId);
  return prisma.feedbackResponse.create({
    data: {
      formId: input.formId,
      userId,
      scheduleId: input.scheduleId ?? null,
      responses: input.responses as unknown as Prisma.InputJsonValue,
      createdBy: userId,
    },
  });
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'is', 'to', 'of', 'in', 'it', 'was', 'for', 'on', 'this', 'that', 'i', 'we', 'very', 'with', 'as', 'be', 'are']);

/** Per-topic aggregate analysis. Responses are anonymised in the aggregate. */
export async function analyzeForm(formId: string) {
  const form = await getForm(formId);
  const questions = (form.questions as unknown as FeedbackQuestion[]) ?? [];
  const responses = await prisma.feedbackResponse.findMany({ where: { formId, isDeleted: false } });
  const responseCount = responses.length;

  const perQuestion = questions.map((q) => {
    const answers = responses
      .map((r) => (r.responses as Record<string, string | number>)[q.id])
      .filter((a) => a !== undefined && a !== null && a !== '');

    if (q.type === 'RATING') {
      const nums = answers.map((a) => Number(a)).filter((n) => Number.isFinite(n));
      const avg = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
      const distribution: Record<string, number> = {};
      for (let s = 1; s <= 5; s++) distribution[s] = nums.filter((n) => n === s).length;
      return { questionId: q.id, text: q.text, type: q.type, average: Number(avg.toFixed(2)), distribution, count: nums.length };
    }
    if (q.type === 'MULTIPLE_CHOICE') {
      const distribution: Record<string, number> = {};
      for (const opt of q.options ?? []) distribution[opt] = 0;
      for (const a of answers) distribution[String(a)] = (distribution[String(a)] ?? 0) + 1;
      return { questionId: q.id, text: q.text, type: q.type, distribution, count: answers.length };
    }
    // TEXT — top word frequencies
    const freq: Record<string, number> = {};
    for (const a of answers) {
      String(a)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
        .forEach((w) => (freq[w] = (freq[w] ?? 0) + 1));
    }
    const topThemes = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));
    return { questionId: q.id, text: q.text, type: q.type, topThemes, responses: answers.map(String), count: answers.length };
  });

  return { formId, title: form.title, responseCount, perQuestion };
}
