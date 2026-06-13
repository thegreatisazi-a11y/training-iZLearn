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
  helpText?: string | null;
  isMandatory: boolean;
}

/** Read match pairs out of the stored options shape ({matchPairs:[...]} or a bare array). */
function extractMatchPairs(options: unknown): Array<{ left: string; right: string }> {
  if (Array.isArray(options)) return options as Array<{ left: string; right: string }>;
  if (options && typeof options === 'object' && Array.isArray((options as { matchPairs?: unknown }).matchPairs)) {
    return (options as { matchPairs: Array<{ left: string; right: string }> }).matchPairs;
  }
  return [];
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
  const base = { id: q.id, questionText: q.questionText, questionType: q.questionType, helpText: q.helpText ?? null };
  // CR-36: for MATCH, send the left prompts and a SHUFFLED, de-duplicated set of
  // right choices — never the correct pairing (which stays server-side for grading).
  if (q.questionType === 'MATCH_THE_WORDS') {
    const pairs = extractMatchPairs(q.options);
    const lefts = pairs.map((p) => p.left);
    const rights = shuffle(Array.from(new Set(pairs.map((p) => p.right))));
    return { ...base, options: { lefts, rights } };
  }
  return { ...base, options: q.options };
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

  // CR-39: an assessment is a single continuous attempt — it cannot be resumed.
  // Any previously started but unfinished attempt (e.g. the tab was closed) is
  // finalized here as an auto-submitted failure, so it counts as a used attempt.
  for (const ab of priorAttempts.filter((a) => !a.completedAt)) {
    await finalizeAbandonedAttempt(ab.id);
  }

  // After finalizing, every prior attempt counts towards the maximum.
  const completedCount = priorAttempts.length;
  if (topic.blockAfterMaxAttempts && completedCount >= topic.maxAttempts) {
    if (assignmentId) await prisma.trainingAssignment.update({ where: { id: assignmentId }, data: { status: 'BLOCKED' } }).catch(() => undefined);
    throw AppError.conflict('Maximum attempts reached. This assessment is blocked pending coordinator review.');
  }

  // Server-enforced reading gate: every timed material must have a completed view
  // log for this topic version before the assessment can start (blocks URL bypass).
  const readingDone = await hasCompletedRequiredReading(userId, topicId, topic.currentVersion);
  if (!readingDone) {
    throw AppError.forbidden('You must finish the required reading time for all training materials before starting the assessment.');
  }

  // CR-29: sequence enforcement — if this topic has a sequence position, the user
  // must first complete every assigned topic with a lower (non-null) sequenceIndex.
  if (topic.sequenceIndex != null) {
    const earlier = await prisma.trainingTopic.findMany({
      where: { isDeleted: false, sequenceIndex: { not: null, lt: topic.sequenceIndex } },
      select: { id: true },
    });
    const earlierIds = earlier.map((t) => t.id);
    if (earlierIds.length) {
      const blocking = await prisma.trainingAssignment.findFirst({
        where: { userId, topicId: { in: earlierIds }, isDeleted: false, status: { notIn: ['COMPLETED', 'WAIVED'] } },
      });
      if (blocking) {
        throw AppError.forbidden('Complete the earlier courses in your training sequence before starting this one.');
      }
    }
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
      helpText: (q as { helpText?: string | null }).helpText ?? null,
      isMandatory: q.isMandatory,
    };
  });

  // CR-38: a configurable countdown. The server stamps the authoritative deadline
  // (startedAt + assessmentTimeMinutes); submissions are checked against it.
  const timeMinutes = topic.assessmentTimeMinutes ?? null;
  const expiresAt = timeMinutes ? new Date(Date.now() + timeMinutes * 60 * 1000) : null;

  const attempt = await prisma.assessmentAttempt.create({
    data: {
      userId,
      topicId,
      topicVersion: topic.currentVersion,
      assignmentId: assignmentId ?? null,
      attemptNumber,
      expiresAt,
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
    // CR-27: surface the correct topic identity (number + version) on the assessment screen.
    topicNumber: topic.topicNumber ?? topic.topicCode,
    topicCode: topic.topicCode,
    topicVersion: topic.currentVersion,
    durationMinutes: topic.durationMinutes,
    assessmentTimeMinutes: timeMinutes,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    questions: snapshot.map(sanitizeForClient),
  };
}

/**
 * CR-39: finalize an abandoned (started-but-unsubmitted) attempt as an
 * auto-submitted failure. Used when a new attempt is started or a stale attempt
 * is detected, so a closed tab cannot leave an attempt open forever.
 */
async function finalizeAbandonedAttempt(attemptId: string): Promise<void> {
  const a = await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
  if (!a || a.completedAt) return;
  await prisma.assessmentAttempt.update({
    where: { id: attemptId },
    data: { score: 0, isPassed: false, autoSubmitted: true, completedAt: new Date() },
  });
}

/** Submit & grade an attempt; returns the full result with explanations on failure. */
export async function submitAttempt(
  attemptId: string,
  answers: Record<string, unknown>,
  userId: string,
  autoSubmitted = false,
): Promise<AssessmentResult> {
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id: attemptId, isDeleted: false } });
  if (!attempt) throw AppError.notFound('Attempt not found');
  if (attempt.userId !== userId) throw AppError.forbidden('This attempt does not belong to you.');
  if (attempt.completedAt) throw AppError.conflict('This attempt has already been submitted.');

  // CR-38: a submission arriving after the server deadline is recorded as an
  // auto-submission (the answers captured so far are still graded normally).
  const expired = Boolean(attempt.expiresAt && new Date() > attempt.expiresAt);
  const wasAutoSubmitted = autoSubmitted || expired;

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
    data: { answers: answers as unknown as object, score, isPassed, autoSubmitted: wasAutoSubmitted, completedAt: new Date() },
  });

  let isBlocked = false;
  let certificateId: string | undefined;

  if (isPassed) {
    // CR-42: on pass the assignment moves to COMPLETED. The refresher date is
    // recorded ON the completed assignment — a NEW (pending) assignment is only
    // materialized by the refresher job when it actually comes due, so a finished
    // training is never simultaneously counted as pending + completed.
    const refresherDue = topic.refresherIntervalMonths ? addMonths(new Date(), topic.refresherIntervalMonths) : null;
    if (attempt.assignmentId) {
      await prisma.trainingAssignment
        .update({
          where: { id: attempt.assignmentId },
          data: { status: 'COMPLETED', ...(refresherDue ? { refresherDueDate: refresherDue } : {}) },
        })
        .catch(() => undefined);
    } else if (refresherDue) {
      // No source assignment to complete — store the refresher schedule on a COMPLETED marker.
      await prisma.trainingAssignment.create({
        data: {
          userId,
          topicId: topic.id,
          assignmentType: 'COURSE_SPECIFIC',
          status: 'COMPLETED',
          refresherDueDate: refresherDue,
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

/**
 * CR-41: complete a topic that has NO assessment (`requiresAssessment = false`) via
 * a read + Terms-&-Conditions acknowledgement. Records a passed "attempt" marker so
 * completion, refresher scheduling and certificate issuance behave like a quiz pass.
 */
export async function completeByAcknowledgement(userId: string, topicId: string, assignmentId?: string): Promise<AssessmentResult> {
  const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training topic not found');
  if (topic.requiresAssessment) throw AppError.badRequest('This training requires an assessment and cannot be completed by acknowledgement.');

  const readingDone = await hasCompletedRequiredReading(userId, topicId, topic.currentVersion);
  if (!readingDone) throw AppError.forbidden('You must finish the required reading time before completing this training.');

  const prior = await prisma.assessmentAttempt.findFirst({ where: { userId, topicId, isPassed: true, isDeleted: false } });
  if (prior) throw AppError.conflict('You have already completed this training.');

  const attempt = await prisma.assessmentAttempt.create({
    data: {
      userId,
      topicId,
      topicVersion: topic.currentVersion,
      assignmentId: assignmentId ?? null,
      attemptNumber: 1,
      score: 100,
      isPassed: true,
      answers: { acknowledged: true } as unknown as object,
      questionsUsed: [] as unknown as object,
      completedAt: new Date(),
      createdBy: userId,
    },
  });

  const refresherDue = topic.refresherIntervalMonths ? addMonths(new Date(), topic.refresherIntervalMonths) : null;
  if (assignmentId) {
    await prisma.trainingAssignment
      .update({ where: { id: assignmentId }, data: { status: 'COMPLETED', ...(refresherDue ? { refresherDueDate: refresherDue } : {}) } })
      .catch(() => undefined);
  } else if (refresherDue) {
    await prisma.trainingAssignment.create({
      data: { userId, topicId, assignmentType: 'COURSE_SPECIFIC', status: 'COMPLETED', refresherDueDate: refresherDue, assignedBy: 'SYSTEM', createdBy: 'SYSTEM' },
    });
  }

  let certificateId: string | undefined;
  try {
    const cert = await issueForAttempt(attempt.id);
    certificateId = cert.id;
  } catch {
    certificateId = undefined;
  }

  await recordEvent({
    action: 'ASSESSMENT_SUBMITTED',
    entityType: 'AssessmentAttempt',
    entityId: attempt.id,
    newValue: { completedByAcknowledgement: true, topicId },
  });

  return {
    attemptId: attempt.id,
    score: 100,
    totalQuestions: 0,
    attempted: 0,
    correctCount: 0,
    incorrectCount: 0,
    passingScorePercent: topic.passingScorePercent,
    isPassed: true,
    isBlocked: false,
    attemptNumber: 1,
    maxAttempts: topic.maxAttempts,
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
