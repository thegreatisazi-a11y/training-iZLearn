import { Request } from 'express';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { addMonths } from '../utils/dateUtils';
import { getNumber, getBool } from './systemConfig.service';
import { recordEvent } from './auditTrail.service';
import { signFromRequest } from './eSignature.service';
import { notifyAssessmentBlocked } from './notification.service';
import { issueForAttempt } from './certificate.service';
import { hasCompletedRequiredReading } from './materialView.service';
import { gradeQuestion } from '../utils/grading';
import type { AssessmentResult, QuestionResult } from '@izlearn/shared';

interface SnapshotQuestion {
  id: string;
  questionText: string;
  questionType: string;
  options: unknown;
  correctAnswer: unknown;
  explanation: string | null;
  isMandatory: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    // Index-derived jitter (Math.random is unavailable in some sandboxes but fine at runtime).
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sanitizeForClient(q: SnapshotQuestion) {
  return { id: q.id, questionText: q.questionText, questionType: q.questionType, options: q.options };
}

/** Start (generate) an assessment attempt. */
export async function startAttempt(userId: string, topicId: string, assignmentId?: string) {
  const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training topic not found');

  // UR-43: restriction criteria / quiz accessibility. A blocked assignment locks
  // the quiz until a coordinator unblocks it, and (when configured) a quiz can be
  // gated behind an active training assignment for the user.
  const assignments = await prisma.trainingAssignment.findMany({
    where: { userId, topicId, isDeleted: false },
  });
  if (assignments.some((a) => a.status === 'BLOCKED')) {
    throw AppError.conflict('This assessment is blocked pending coordinator review.');
  }
  const requireAssignment = await getBool('assessment.require_assignment', false);
  if (requireAssignment && assignments.length === 0) {
    throw AppError.forbidden('This assessment is only accessible once a training has been assigned to you.');
  }

  const priorAttempts = await prisma.assessmentAttempt.findMany({
    where: { userId, topicId, isDeleted: false },
    orderBy: { attemptNumber: 'desc' },
  });
  if (priorAttempts.some((a) => a.isPassed)) {
    throw AppError.conflict('You have already passed this assessment.');
  }
  const completed = priorAttempts.filter((a) => a.completedAt);
  if (topic.blockAfterMaxAttempts && completed.length >= topic.maxAttempts) {
    if (assignmentId) await prisma.trainingAssignment.update({ where: { id: assignmentId }, data: { status: 'BLOCKED' } }).catch(() => undefined);
    throw AppError.conflict('Maximum attempts reached. This assessment is blocked pending coordinator review.');
  }

  // Server-enforced reading gate: every timed material must have a completed view
  // log for this topic version before the assessment can start (blocks URL bypass).
  const readingDone = await hasCompletedRequiredReading(userId, topicId, topic.currentVersion);
  if (!readingDone) {
    throw AppError.forbidden('You must finish the required reading time for all training materials before starting the assessment.');
  }

  const attemptNumber = priorAttempts.length + 1;

  // Build the question set: all mandatory + (optionally randomized) non-mandatory up to the count.
  // The per-topic questionLimit takes precedence over the global default.
  const rnd = topic.randomizeQuestions;
  const count = topic.questionLimit ?? (await getNumber('assessment.default_question_count', 10));
  const pool = await prisma.question.findMany({
    where: { topicId, topicVersion: topic.currentVersion, isActive: true, isDeleted: false },
  });
  const mandatory = pool.filter((q) => q.isMandatory);
  const optionalPool = pool.filter((q) => !q.isMandatory);
  const optional = rnd ? shuffle(optionalPool) : optionalPool;
  const needed = Math.max(0, count - mandatory.length);
  const selected = [...mandatory, ...optional.slice(0, needed)];

  const ordered = rnd ? shuffle(selected) : selected;
  const snapshot: SnapshotQuestion[] = ordered.map((q) => {
    let options = q.options as unknown;
    if (rnd && Array.isArray(options) && (q.questionType === 'MULTIPLE_CHOICE_SINGLE' || q.questionType === 'MULTIPLE_CHOICE_MULTI')) {
      options = shuffle(options as unknown[]);
    }
    return {
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      isMandatory: q.isMandatory,
    };
  });

  const attempt = await prisma.assessmentAttempt.create({
    data: {
      userId,
      topicId,
      topicVersion: topic.currentVersion,
      assignmentId: assignmentId ?? null,
      attemptNumber,
      questionsUsed: snapshot as unknown as object,
      createdBy: userId,
    },
  });
  if (assignmentId) {
    await prisma.trainingAssignment.update({ where: { id: assignmentId }, data: { status: 'IN_PROGRESS' } }).catch(() => undefined);
  }

  return {
    attemptId: attempt.id,
    attemptNumber,
    maxAttempts: topic.maxAttempts,
    topicTitle: topic.title,
    durationMinutes: topic.durationMinutes,
    questions: snapshot.map(sanitizeForClient),
  };
}

/** Submit & grade an attempt; returns the full result with explanations on failure. */
export async function submitAttempt(attemptId: string, answers: Record<string, unknown>, userId: string): Promise<AssessmentResult> {
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id: attemptId, isDeleted: false } });
  if (!attempt) throw AppError.notFound('Attempt not found');
  if (attempt.userId !== userId) throw AppError.forbidden('This attempt does not belong to you.');
  if (attempt.completedAt) throw AppError.conflict('This attempt has already been submitted.');

  const topic = await prisma.trainingTopic.findUnique({ where: { id: attempt.topicId } });
  if (!topic) throw AppError.notFound('Training topic not found');

  const questions = (attempt.questionsUsed as unknown as SnapshotQuestion[]) ?? [];
  const incorrectDetails: QuestionResult[] = [];
  let correctCount = 0;
  let attempted = 0;

  for (const q of questions) {
    const ua = answers[q.id];
    if (ua !== undefined && ua !== null && ua !== '') attempted++;
    const isCorrect = gradeQuestion(q, ua);
    if (isCorrect) correctCount++;
    else incorrectDetails.push({ questionId: q.id, questionText: q.questionText, isCorrect, userAnswer: ua ?? null, correctAnswer: q.correctAnswer, explanation: q.explanation });
  }

  const total = questions.length || 1;
  const score = Number(((correctCount / total) * 100).toFixed(2));
  const isPassed = score >= topic.passingScorePercent;

  await prisma.assessmentAttempt.update({
    where: { id: attemptId },
    data: { answers: answers as unknown as object, score, isPassed, completedAt: new Date() },
  });

  let isBlocked = false;
  let certificateId: string | undefined;

  if (isPassed) {
    if (attempt.assignmentId) {
      await prisma.trainingAssignment.update({ where: { id: attempt.assignmentId }, data: { status: 'COMPLETED' } }).catch(() => undefined);
    }
    // Auto-create a refresher assignment if the topic defines an interval.
    if (topic.refresherIntervalMonths) {
      await prisma.trainingAssignment.create({
        data: {
          userId,
          topicId: topic.id,
          assignmentType: 'COURSE_SPECIFIC',
          refresherDueDate: addMonths(new Date(), topic.refresherIntervalMonths),
          dueDate: addMonths(new Date(), topic.refresherIntervalMonths),
          status: 'PENDING',
          assignedBy: 'SYSTEM',
          createdBy: 'SYSTEM',
        },
      });
    }
    // Generate the certificate (best-effort — never block the result).
    try {
      const cert = await issueForAttempt(attemptId);
      certificateId = cert.id;
    } catch {
      certificateId = undefined;
    }
  } else if (topic.blockAfterMaxAttempts && attempt.attemptNumber >= topic.maxAttempts) {
    isBlocked = true;
    await prisma.assessmentAttempt.update({ where: { id: attemptId }, data: { isBlocked: true } });
    if (attempt.assignmentId) {
      await prisma.trainingAssignment.update({ where: { id: attempt.assignmentId }, data: { status: 'BLOCKED' } }).catch(() => undefined);
    }
    await notifyAssessmentBlocked(userId, topic.id);
  }

  await recordEvent({
    action: 'ASSESSMENT_SUBMITTED',
    entityType: 'AssessmentAttempt',
    entityId: attemptId,
    newValue: { score, isPassed, attemptNumber: attempt.attemptNumber },
  });

  return {
    attemptId,
    score,
    totalQuestions: total,
    attempted,
    correctCount,
    incorrectCount: total - correctCount,
    passingScorePercent: topic.passingScorePercent,
    isPassed,
    isBlocked,
    attemptNumber: attempt.attemptNumber,
    maxAttempts: topic.maxAttempts,
    // Show incorrect-answer explanations only when the topic enables it.
    incorrectDetails: isPassed || !topic.showExplanations ? undefined : incorrectDetails,
    certificateId,
  };
}

export async function listAttempts(filters: { userId?: string; topicId?: string }) {
  return prisma.assessmentAttempt.findMany({
    where: { isDeleted: false, ...(filters.userId ? { userId: filters.userId } : {}), ...(filters.topicId ? { topicId: filters.topicId } : {}) },
    orderBy: { startedAt: 'desc' },
  });
}

export async function getAttempt(id: string) {
  const a = await prisma.assessmentAttempt.findFirst({ where: { id, isDeleted: false } });
  if (!a) throw AppError.notFound('Attempt not found');
  return a;
}

/** Unblock a blocked assignment — controlled action requiring an e-signature. */
export async function unblockAssignment(assignmentId: string, req: Request) {
  const assignment = await prisma.trainingAssignment.findFirst({ where: { id: assignmentId, isDeleted: false } });
  if (!assignment) throw AppError.notFound('Assignment not found');
  await signFromRequest(req, 'TrainingAssignment', assignmentId, 'Approved');
  auditContext.setActionOverride('UPDATE');
  return prisma.trainingAssignment.update({ where: { id: assignmentId }, data: { status: 'PENDING' } });
}
