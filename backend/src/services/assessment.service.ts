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
import { hasPermission } from '../utils/permissions';
import { isOrgWideUserManager, directReportIds } from '../utils/accessScope';
import { failureReasonLabel, failureReasonIsTechnical, failureReasonCountsAsAttempt } from '@izlearn/shared';
import type { AssessmentResult, QuestionResult, AssessmentFailureReason, PermissionMatrix, PermissionAction } from '@izlearn/shared';

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

/** Build an option-id → option-text map from a MULTIPLE_CHOICE options array. */
function optionTextMap(options: unknown): Map<string, string> {
  const m = new Map<string, string>();
  if (Array.isArray(options)) {
    for (const o of options) {
      if (o && typeof o === 'object' && 'id' in o) m.set(String((o as { id: unknown }).id), String((o as { text?: unknown }).text ?? (o as { id: unknown }).id));
    }
  }
  return m;
}

/**
 * BUG-06/12/13: convert a stored answer (which for choice questions is option *ids*
 * like "o1"/"o2") into human-readable text for the result/review/print screens.
 * MATCH pairs and FILL answers are already text, so they pass through unchanged.
 */
function humanizeAnswer(q: { questionType: string; options: unknown }, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return value;
  switch (q.questionType) {
    case 'MULTIPLE_CHOICE_SINGLE':
    case 'MULTIPLE_CHOICE_MULTI': {
      const map = optionTextMap(q.options);
      const ids = Array.isArray(value) ? value : [value];
      return ids.map((id) => map.get(String(id)) ?? String(id));
    }
    case 'TRUE_FALSE': {
      const s = String(value).toLowerCase();
      if (s === 'true') return 'True';
      if (s === 'false') return 'False';
      return optionTextMap(q.options).get(String(value)) ?? value;
    }
    case 'FILL_IN_THE_BLANKS': {
      // #7: a fill answer is a per-blank map ({ b1: 'foo' }) or array — flatten to the
      // entered text so it renders readably instead of "[object Object]".
      if (Array.isArray(value)) return value.map((v) => String(v));
      if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map((v) => String(v));
      return String(value);
    }
    case 'MATCH_THE_WORDS': {
      // #7: normalise to an array of { left, right } so the UI renders "left → right".
      // Accepts the pairs array (correct answer) or a { left: right } map (user answer).
      if (Array.isArray(value)) return value;
      if (typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).map(([left, right]) => ({ left, right: String(right) }));
      }
      return value;
    }
    default:
      return value;
  }
}

/** BUG-06: a help/explanation field left literally as "None" during design must not render. */
function cleanText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  if (t === '' || t.toLowerCase() === 'none') return null;
  return v;
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
  const base = { id: q.id, questionText: q.questionText, questionType: q.questionType, helpText: cleanText(q.helpText) };
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

/**
 * BUG-01: a user may not initiate any training until their Job Description is APPROVED
 * and their CV has been created. Throws a forbidden error with the required message.
 */
async function assertJdAndCvReady(userId: string) {
  const [jd, cv] = await Promise.all([
    prisma.jobDescription.findFirst({ where: { userId, status: 'APPROVED', isDeleted: false } }),
    prisma.curriculumVitae.findFirst({ where: { userId, isDeleted: false } }),
  ]);
  if (!jd || !cv) throw AppError.forbidden('Please complete the JD and CV to initiate the training.');
}

/** Start (generate) an assessment attempt. */
export async function startAttempt(userId: string, topicId: string, assignmentId?: string) {
  const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training topic not found');
  // SECURITY / GxP (ASMT-1): only a currently PUBLISHED topic version may be assessed.
  // Blocks starting an attempt (and thus minting a certificate) against a DRAFT/under-review
  // or an ARCHIVED/superseded version reached by guessing the topic id.
  if (topic.status !== 'PUBLISHED') {
    throw AppError.conflict('This training is not currently published and cannot be assessed.');
  }

  await assertJdAndCvReady(userId);

  // UR-43: restriction criteria / quiz accessibility. A blocked assignment locks
  // the quiz until a coordinator unblocks it, and (when configured) a quiz can be
  // gated behind an active training assignment for the user.
  const assignments = await prisma.trainingAssignment.findMany({
    where: { userId, topicId, isDeleted: false },
  });
  if (assignments.some((a) => a.status === 'BLOCKED')) {
    throw AppError.conflict('This assessment is blocked pending coordinator review.');
  }
  // An overdue course can't be started until the supervisor re-opens it (UR: request access).
  if (assignments.length > 0 && assignments.every((a) => a.status === 'OVERDUE')) {
    throw AppError.conflict('This training is overdue. Request access from your supervisor to continue.');
  }
  const requireAssignment = await getBool('assessment.require_assignment', false);
  if (requireAssignment && assignments.length === 0) {
    throw AppError.forbidden('This assessment is only accessible once a training has been assigned to you.');
  }

  const priorAttempts = await prisma.assessmentAttempt.findMany({
    where: { userId, topicId, isDeleted: false },
    orderBy: { attemptNumber: 'desc' },
  });
  // Version-aware: passing an EARLIER version must NOT block re-taking a REVISED version
  // (re-training on revision). Only a pass of the CURRENT version blocks a fresh attempt;
  // the earlier pass stays on record as the completion of that prior version.
  if (priorAttempts.some((a) => a.isPassed && a.topicVersion === topic.currentVersion)) {
    throw AppError.conflict('You have already passed this assessment.');
  }

  // CR-39: an assessment is a single continuous attempt — it cannot be resumed. Any
  // previously started but unfinished attempt (e.g. the tab/system was closed) is
  // finalized here with its recorded failure reason so nothing is lost.
  for (const ab of priorAttempts.filter((a) => !a.completedAt)) {
    await finalizeAbandonedAttempt(ab.id);
  }

  // An approved retake grants extra attempts on the assignment, raising the effective
  // limit (effective = topic.maxAttempts + extraAttempts). Fairness: a server-confirmed
  // no-submission failure (ABANDONED / SYSTEM_FAILURE — e.g. the system/power/network died
  // before any answers reached the server) does NOT consume an attempt, so a learner is
  // never penalized for a technical interruption beyond their control. The reason is still
  // recorded in the audit trail for transparency. (Re-read fresh: the loop above just
  // updated some reasons.)
  const extraAttempts = assignments.reduce((m, a) => Math.max(m, a.extraAttempts ?? 0), 0);
  const effectiveMax = topic.maxAttempts + extraAttempts;
  // Attempt limit is scoped to the CURRENT version: a revision gives the learner a fresh
  // set of attempts (prior-version attempts don't count against the re-training).
  const finalized = await prisma.assessmentAttempt.findMany({
    where: { userId, topicId, isDeleted: false, completedAt: { not: null }, topicVersion: topic.currentVersion },
    select: { submissionReason: true },
  });
  const completedCount = finalized.filter((a) => !a.submissionReason || failureReasonCountsAsAttempt(a.submissionReason as AssessmentFailureReason)).length;
  // L-C3: `blockAfterMaxAttempts` is a deliberate per-topic toggle. When ON, hitting the
  // limit blocks the trainee pending supervisor review; when OFF, maxAttempts is advisory
  // and retries stay open — this is intended, not a bypass.
  if (topic.blockAfterMaxAttempts && completedCount >= effectiveMax) {
    if (assignmentId) await prisma.trainingAssignment.update({ where: { id: assignmentId }, data: { status: 'BLOCKED' } }).catch(() => undefined);
    throw AppError.conflict('Maximum attempts reached. This assessment is blocked pending supervisor review.');
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

  // Attempt numbers restart per course version, so a revision yields a fresh sequence
  // (keeps the submit-time max-attempts block correct for the re-training).
  const attemptNumber = priorAttempts.filter((a) => a.topicVersion === topic.currentVersion).length + 1;

  // Build the question set: all mandatory + (optionally randomized) non-mandatory up to the count.
  // The per-topic questionLimit takes precedence over the global default.
  const rnd = topic.randomizeQuestions;
  const count = topic.questionLimit ?? (await getNumber('assessment.default_question_count', 10));
  const pool = await prisma.question.findMany({
    // The live question set = all active, non-deleted questions for this topic. (We do NOT
    // pin to topicVersion: a question change now bumps the course version, and pinning
    // would orphan every pre-existing question from the assessment. Staged drafts, if any
    // legacy ones remain, are still excluded.)
    where: { topicId, isActive: true, isDeleted: false, isStaged: false },
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
  // No submission ever arrived for a started attempt. If the time had run out it is a
  // time-out; otherwise it was interrupted (device shutdown / power loss / browser crash
  // / lost connection) — a technical issue, not the user's own answers.
  const reason: AssessmentFailureReason = a.expiresAt && new Date() > a.expiresAt ? 'TIME_LIMIT_EXCEEDED' : 'ABANDONED';
  await prisma.assessmentAttempt.update({
    where: { id: attemptId },
    data: { score: 0, isPassed: false, autoSubmitted: true, submissionReason: reason, completedAt: new Date() },
  });
  await recordEvent({
    action: 'ASSESSMENT_SUBMITTED',
    entityType: 'AssessmentAttempt',
    entityId: attemptId,
    newValue: {
      score: 0,
      isPassed: false,
      outcome: 'Failed',
      attemptNumber: a.attemptNumber,
      submissionReason: failureReasonLabel(reason),
      reasonCategory: 'Technical issue (not the user’s fault)',
      note: 'Attempt was started but never submitted (auto-finalized).',
    },
  });
}

/**
 * Sweep started-but-unsubmitted attempts and finalize the stale ones, so the failure
 * reason is ALWAYS recorded even when the learner never returns (e.g. the system or power
 * died mid-test and the tab never closed cleanly). An attempt is stale when its timer has
 * expired, or — for untimed tests — when it has been open longer than a generous grace
 * window. Best-effort and idempotent; safe to call opportunistically and from a daily job.
 */
export async function finalizeStaleAttempts(opts: { userId?: string } = {}): Promise<number> {
  const graceMinutes = await getNumber('assessment.abandon_after_minutes', 180);
  const now = new Date();
  const cutoff = new Date(now.getTime() - graceMinutes * 60 * 1000);
  // NOTE: a freshly-started attempt is stored WITHOUT a completedAt field (absent, not
  // null), and Prisma+Mongo `{ completedAt: null }` does NOT match absent fields — so we
  // select by the stale/expired window (startedAt/expiresAt are always set) and check
  // completedAt in JS. This is what makes the reason get recorded even if the learner
  // never returns.
  const candidates = await prisma.assessmentAttempt.findMany({
    where: {
      isDeleted: false,
      ...(opts.userId ? { userId: opts.userId } : {}),
      OR: [{ startedAt: { lt: cutoff } }, { expiresAt: { lt: now } }],
    },
    select: { id: true, startedAt: true, expiresAt: true, completedAt: true },
  });
  let finalized = 0;
  for (const a of candidates) {
    if (a.completedAt) continue; // already submitted/finalized
    await finalizeAbandonedAttempt(a.id).catch(() => undefined);
    finalized++;
  }
  return finalized;
}

/** Submit & grade an attempt; returns the full result with explanations on failure. */
export async function submitAttempt(
  attemptId: string,
  answers: Record<string, unknown>,
  userId: string,
  autoSubmitted = false,
  reason?: AssessmentFailureReason,
): Promise<AssessmentResult> {
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id: attemptId, isDeleted: false } });
  if (!attempt) throw AppError.notFound('Attempt not found');
  if (attempt.userId !== userId) throw AppError.forbidden('This attempt does not belong to you.');
  if (attempt.completedAt) throw AppError.conflict('This attempt has already been submitted.');

  // CR-38: a submission arriving after the server deadline is recorded as an
  // auto-submission (the answers captured so far are still graded normally).
  const expired = Boolean(attempt.expiresAt && new Date() > attempt.expiresAt);
  const wasAutoSubmitted = autoSubmitted || expired;

  // Determine the distinct submission/failure reason for the audit trail. The server is
  // authoritative on time expiry; otherwise we trust the client's proximate cause
  // (network/session/tab-close), defaulting to a voluntary user submission.
  const submissionReason: AssessmentFailureReason = expired
    ? 'TIME_LIMIT_EXCEEDED'
    : reason ?? (autoSubmitted ? 'TAB_CLOSED' : 'USER_SUBMITTED');

  const topic = await prisma.trainingTopic.findUnique({ where: { id: attempt.topicId } });
  if (!topic) throw AppError.notFound('Training topic not found');

  const questions = (attempt.questionsUsed as unknown as SnapshotQuestion[]) ?? [];
  const incorrectDetails: QuestionResult[] = [];
  // A2: every question (correct + incorrect) so the result screen can show the full review.
  const allDetails: QuestionResult[] = [];
  let correctCount = 0;
  let attempted = 0;

  for (const q of questions) {
    const ua = answers[q.id];
    if (ua !== undefined && ua !== null && ua !== '') attempted++;
    const isCorrect = gradeQuestion(q, ua);
    if (isCorrect) correctCount++;
    // BUG-06/12/13: store the human-readable answer text (not option codes) and drop
    // "None" placeholder explanations so they never render on the result/print screens.
    const detail: QuestionResult = {
      questionId: q.id,
      questionText: q.questionText,
      isCorrect,
      userAnswer: humanizeAnswer(q, ua ?? null),
      correctAnswer: humanizeAnswer(q, q.correctAnswer),
      explanation: cleanText(q.explanation),
    };
    allDetails.push(detail);
    if (!isCorrect) incorrectDetails.push(detail);
  }

  const total = questions.length || 1;
  const score = Number(((correctCount / total) * 100).toFixed(2));
  const isPassed = score >= topic.passingScorePercent;

  // BUG-05: actual time spent on the assessment = completedAt − startedAt.
  const completedAt = new Date();
  const timeSpentSeconds = Math.max(0, Math.round((completedAt.getTime() - attempt.startedAt.getTime()) / 1000));
  // BUG-05: actual time spent reading this topic's materials (sum of per-material elapsed).
  const readingLogs = await prisma.materialViewLog.findMany({
    where: { userId, topicId: attempt.topicId, topicVersion: attempt.topicVersion },
    select: { elapsedSeconds: true },
  });
  const readingTimeSeconds = readingLogs.reduce((s, l) => s + (l.elapsedSeconds ?? 0), 0);

  await prisma.assessmentAttempt.update({
    where: { id: attemptId },
    data: { answers: answers as unknown as object, score, isPassed, autoSubmitted: wasAutoSubmitted, submissionReason, completedAt },
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
  } else {
    // Effective limit includes any extra attempts granted by an approved retake.
    const sourceAssignment = attempt.assignmentId
      ? await prisma.trainingAssignment.findUnique({ where: { id: attempt.assignmentId } })
      : null;
    const effectiveMax = topic.maxAttempts + (sourceAssignment?.extraAttempts ?? 0);
    if (topic.blockAfterMaxAttempts && attempt.attemptNumber >= effectiveMax) {
      isBlocked = true;
      await prisma.assessmentAttempt.update({ where: { id: attemptId }, data: { isBlocked: true } });
      if (attempt.assignmentId) {
        await prisma.trainingAssignment.update({ where: { id: attempt.assignmentId }, data: { status: 'BLOCKED' } }).catch(() => undefined);
      }
      await notifyAssessmentBlocked(userId, topic.id);
    }
  }

  await recordEvent({
    action: 'ASSESSMENT_SUBMITTED',
    entityType: 'AssessmentAttempt',
    entityId: attemptId,
    // Capture the distinct failure/submission reason so the audit trail clearly shows
    // whether a failure was the user's own action or a technical issue (and they are
    // not penalized unfairly for a network/system/device problem).
    newValue: {
      score,
      isPassed,
      outcome: isPassed ? 'Passed' : 'Failed',
      attemptNumber: attempt.attemptNumber,
      submissionReason: failureReasonLabel(submissionReason),
      reasonCategory: failureReasonIsTechnical(submissionReason) ? 'Technical issue (not the user’s fault)' : 'User action',
    },
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
    // A2: after submission, show every wrong answer (selected + correct + explanation)
    // for BOTH pass and fail. Explanation text is included where the question has one.
    incorrectDetails,
    // A2: the full per-question breakdown (correct + incorrect) for the result review.
    allDetails,
    // BUG-05: surface the actual time spent on the assessment and reading.
    timeSpentSeconds,
    readingTimeSeconds,
    // Recorded reason for this submission (so the result screen can show it).
    submissionReason,
    submissionReasonLabel: failureReasonLabel(submissionReason),
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
  // SECURITY / GxP (ASMT-1): only a currently PUBLISHED topic version may be completed.
  if (topic.status !== 'PUBLISHED') {
    throw AppError.conflict('This training is not currently published and cannot be completed.');
  }
  if (topic.requiresAssessment) throw AppError.badRequest('This training requires an assessment and cannot be completed by acknowledgement.');

  await assertJdAndCvReady(userId);

  const readingDone = await hasCompletedRequiredReading(userId, topicId, topic.currentVersion);
  if (!readingDone) throw AppError.forbidden('You must finish the required reading time before completing this training.');

  // ASMT-3: scope the "already completed" check to the CURRENT version. Without this, a
  // user who completed v1 by acknowledgement could never re-complete the topic after it was
  // revised (the revision auto-assigns re-training), permanently locking SOP re-reads.
  const prior = await prisma.assessmentAttempt.findFirst({
    where: { userId, topicId, topicVersion: topic.currentVersion, isPassed: true, isDeleted: false },
  });
  if (prior) throw AppError.conflict('You have already completed the current version of this training.');

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
  // Opportunistically finalize any of this user's stale/interrupted attempts so the
  // failure reason is recorded and visible whenever results are viewed (best-effort).
  if (filters.userId) await finalizeStaleAttempts({ userId: filters.userId }).catch(() => undefined);
  const rows = await prisma.assessmentAttempt.findMany({
    where: { isDeleted: false, ...(filters.userId ? { userId: filters.userId } : {}), ...(filters.topicId ? { topicId: filters.topicId } : {}) },
    orderBy: { startedAt: 'desc' },
  });
  // BUG-03/04: enrich with topic title + number so the UI never shows a raw topicId,
  // and BUG-05: surface the actual time spent (completedAt − startedAt).
  const topicIds = Array.from(new Set(rows.map((r) => r.topicId)));
  const topics = topicIds.length
    ? await prisma.trainingTopic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true, topicNumber: true, topicCode: true } })
    : [];
  const tMap = new Map(topics.map((t) => [t.id, t]));
  return rows.map((r) => {
    const t = tMap.get(r.topicId);
    return {
      ...r,
      topicTitle: t?.title ?? null,
      topicNumber: t?.topicNumber ?? t?.topicCode ?? null,
      timeSpentSeconds: r.completedAt ? Math.max(0, Math.round((r.completedAt.getTime() - r.startedAt.getTime()) / 1000)) : null,
      // The recorded failure/submission reason + human label for display in records.
      submissionReasonLabel: r.submissionReason ? failureReasonLabel(r.submissionReason as AssessmentFailureReason) : null,
    };
  });
}

export async function getAttempt(id: string) {
  const a = await prisma.assessmentAttempt.findFirst({ where: { id, isDeleted: false } });
  if (!a) throw AppError.notFound('Attempt not found');
  return a;
}

/**
 * Item 3: who may view/download WHOSE completed tests.
 *   - SUPER_ADMIN or anyone with assessments:write (Training Coordinator / Admin) → everyone.
 *   - a supervisor → only their direct reports.
 *   - everyone else → only their own (empty team list).
 */
export async function attemptViewerScope(requester: {
  id: string;
  roleNames?: string[];
  permissions?: Record<string, Record<string, boolean>>;
}): Promise<{ canSeeAll: boolean; teamUserIds: string[] }> {
  // S1: assessment visibility — permission-driven, no role names (so new custom roles
  // scope correctly from their granted permissions):
  //   - No assessments:view_others → OWN attempts only (a plain trainee). This gate is
  //     essential: this helper also authorises the review endpoint, which every user hits
  //     for their own attempt.
  //   - Org-wide user manager (userManagement edit/approve/reset_password) → EVERYONE.
  //   - Otherwise (a team manager / supervisor) → their DIRECT reports.
  const perms = requester.permissions as PermissionMatrix | undefined;
  if (!hasPermission(perms, 'assessments', 'view_others' as PermissionAction)) return { canSeeAll: false, teamUserIds: [] };
  if (isOrgWideUserManager(perms)) return { canSeeAll: true, teamUserIds: [] };
  return { canSeeAll: false, teamUserIds: await directReportIds(requester.id) };
}

/**
 * Item 3: completed attempts the requester is allowed to view/download of OTHER users —
 * their whole org (admin/coordinator) or just their direct reports (supervisor). The
 * requester's own attempts live in listAttempts()/the "mine" table, so they're excluded.
 */
export async function listManagedAttempts(
  requester: { id: string; roleNames: string[]; permissions?: Record<string, Record<string, boolean>> },
  filters: { userId?: string; topicId?: string },
) {
  const scope = await attemptViewerScope(requester);
  const where: Record<string, unknown> = {
    isDeleted: false,
    completedAt: { not: null },
    userId: { not: requester.id },
    ...(filters.topicId ? { topicId: filters.topicId } : {}),
  };
  if (!scope.canSeeAll) {
    const allowed = scope.teamUserIds.filter((uid) => uid !== requester.id);
    where.userId = { in: allowed.length ? allowed : ['__no_match__'] };
  } else if (filters.userId) {
    where.userId = filters.userId;
  }
  const rows = await prisma.assessmentAttempt.findMany({ where, orderBy: { completedAt: 'desc' } });
  const topicIds = Array.from(new Set(rows.map((r) => r.topicId)));
  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const [topics, people] = await Promise.all([
    topicIds.length
      ? prisma.trainingTopic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true, topicNumber: true, topicCode: true } })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, employeeId: true } })
      : Promise.resolve([]),
  ]);
  const tMap = new Map(topics.map((t) => [t.id, t]));
  const uMap = new Map(people.map((u) => [u.id, u]));
  return rows.map((r) => {
    const t = tMap.get(r.topicId);
    const u = uMap.get(r.userId);
    return {
      ...r,
      topicTitle: t?.title ?? null,
      topicNumber: t?.topicNumber ?? t?.topicCode ?? null,
      userFullName: u?.fullName ?? null,
      employeeId: u?.employeeId ?? null,
      timeSpentSeconds: r.completedAt ? Math.max(0, Math.round((r.completedAt.getTime() - r.startedAt.getTime()) / 1000)) : null,
      submissionReasonLabel: r.submissionReason ? failureReasonLabel(r.submissionReason as AssessmentFailureReason) : null,
    };
  });
}

/**
 * View a COMPLETED attempt's full question-by-question review — the same breakdown
 * (score, per-question user answer / correct answer / explanation) shown immediately
 * after submission, rebuilt from the attempt's question snapshot + stored answers so a
 * learner can revisit their performance at any time. Ownership is enforced (a learner
 * may only review their own attempts; managers with assessments:write may review any).
 */
export async function reviewAttempt(
  id: string,
  userId: string,
  access: { canSeeAll?: boolean; teamUserIds?: string[] } = {},
) {
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id, isDeleted: false } });
  if (!attempt) throw AppError.notFound('Attempt not found');
  const isOwn = attempt.userId === userId;
  // Item 3: own attempt, an admin/coordinator (canSeeAll), or a supervisor viewing a
  // direct report's attempt (teamUserIds) may review; anyone else is forbidden.
  const allowed = isOwn || !!access.canSeeAll || !!access.teamUserIds?.includes(attempt.userId);
  if (!allowed) throw AppError.forbidden('You are not allowed to view this attempt.');
  if (!attempt.completedAt) throw AppError.badRequest('This attempt has not been completed yet.');

  const topic = await prisma.trainingTopic.findUnique({ where: { id: attempt.topicId } });
  const questions = (attempt.questionsUsed as unknown as SnapshotQuestion[]) ?? [];
  const answers = (attempt.answers as Record<string, unknown>) ?? {};
  // A learner reviewing their OWN past attempt must NOT see the answer key or explanations
  // — the assessment can be re-attempted, so revealing correct answers here would let them
  // learn the answers between attempts. Only a manager reviewing SOMEONE ELSE's attempt
  // (e.g. for coordinator review) sees the full breakdown.
  const hideAnswerKey = attempt.userId === userId;
  const allDetails: QuestionResult[] = [];
  const incorrectDetails: QuestionResult[] = [];
  let correctCount = 0;
  for (const q of questions) {
    const ua = answers[q.id];
    const isCorrect = gradeQuestion(q, ua);
    if (isCorrect) correctCount++;
    const detail: QuestionResult = {
      questionId: q.id,
      questionText: q.questionText,
      isCorrect,
      userAnswer: humanizeAnswer(q, ua ?? null),
      // Withheld for a learner's own review (see above); provided for manager review.
      correctAnswer: hideAnswerKey ? null : humanizeAnswer(q, q.correctAnswer),
      explanation: hideAnswerKey ? null : cleanText(q.explanation),
    };
    allDetails.push(detail);
    if (!isCorrect) incorrectDetails.push(detail);
  }
  const total = questions.length;
  const [readingLogs, owner] = await Promise.all([
    prisma.materialViewLog.findMany({
      where: { userId: attempt.userId, topicId: attempt.topicId, topicVersion: attempt.topicVersion },
      select: { elapsedSeconds: true },
    }),
    prisma.user.findUnique({ where: { id: attempt.userId }, select: { fullName: true, employeeId: true, departmentId: true } }),
  ]);
  const readingTimeSeconds = readingLogs.reduce((s, l) => s + (l.elapsedSeconds ?? 0), 0);
  // S2: the assessed employee's details so the view/printout is identifiable.
  const department = owner?.departmentId
    ? (await prisma.department.findUnique({ where: { id: owner.departmentId }, select: { name: true } }))?.name ?? null
    : null;

  return {
    attemptId: attempt.id,
    employeeName: owner?.fullName ?? null,
    employeeId: owner?.employeeId ?? null,
    department,
    topicTitle: topic?.title ?? null,
    topicNumber: topic?.topicNumber ?? topic?.topicCode ?? null,
    score: attempt.score ?? 0,
    totalQuestions: total,
    correctCount,
    incorrectCount: total - correctCount,
    passingScorePercent: topic?.passingScorePercent ?? 0,
    isPassed: !!attempt.isPassed,
    attemptNumber: attempt.attemptNumber,
    maxAttempts: topic?.maxAttempts ?? 0,
    allDetails,
    incorrectDetails,
    timeSpentSeconds: Math.max(0, Math.round((attempt.completedAt.getTime() - attempt.startedAt.getTime()) / 1000)),
    readingTimeSeconds,
    submissionReason: attempt.submissionReason ?? null,
    submissionReasonLabel: attempt.submissionReason ? failureReasonLabel(attempt.submissionReason as AssessmentFailureReason) : null,
    completedAt: attempt.completedAt,
  };
}

/** Unblock a blocked assignment — controlled action requiring an e-signature. */
export async function unblockAssignment(assignmentId: string, req: Request) {
  const assignment = await prisma.trainingAssignment.findFirst({ where: { id: assignmentId, isDeleted: false } });
  if (!assignment) throw AppError.notFound('Assignment not found');
  await signFromRequest(req, 'TrainingAssignment', assignmentId, 'Approved');
  auditContext.setActionOverride('UPDATE');
  // BUG-03: simply setting PENDING isn't enough — startAttempt re-blocks immediately
  // because the used attempts still equal the max. Grant a fresh set of attempts (like
  // an approved retake) by raising extraAttempts to the attempts used so far, so the
  // user can actually take the assessment again after being unblocked.
  // L-C2: count attempts on the CURRENT topic version only (the start-time limit does too),
  // so stale prior-version attempts don't inflate extraAttempts and over-grant retakes.
  const topic = await prisma.trainingTopic.findFirst({ where: { id: assignment.topicId }, select: { currentVersion: true } });
  const usedAttempts = await prisma.assessmentAttempt.count({
    where: { userId: assignment.userId, topicId: assignment.topicId, topicVersion: topic?.currentVersion ?? undefined, isDeleted: false },
  });
  return prisma.trainingAssignment.update({
    where: { id: assignmentId },
    data: { status: 'PENDING', extraAttempts: Math.max(assignment.extraAttempts ?? 0, usedAttempts) },
  });
}
