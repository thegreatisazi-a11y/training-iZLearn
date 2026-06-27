import { z } from 'zod';
import { uuid } from './common';

/**
 * Distinct reasons an attempt is submitted/ended — so the audit trail can show
 * transparently whether a failure was the user's own doing or a technical issue
 * beyond their control (so no one is penalized unfairly).
 */
export const assessmentFailureReason = z.enum([
  'USER_SUBMITTED', // voluntary submit (the score reflects the answers given)
  'TIME_LIMIT_EXCEEDED', // the allotted time ran out → auto-submitted
  'SESSION_TIMEOUT', // session/token expired during the test
  'NETWORK_FAILURE', // connectivity lost → interrupted / auto-submitted
  'TAB_CLOSED', // browser tab/window closed or navigated away
  'BROWSER_CRASH', // the browser crashed mid-test
  'DEVICE_OR_POWER_FAILURE', // device shut down / power loss
  'SYSTEM_FAILURE', // server/application-side crash or failure
  'ABANDONED', // started but never submitted (interrupted; cause not otherwise known)
]);
export type AssessmentFailureReason = z.infer<typeof assessmentFailureReason>;

const FAILURE_REASON_LABEL: Record<AssessmentFailureReason, string> = {
  USER_SUBMITTED: 'User submitted (own answers)',
  TIME_LIMIT_EXCEEDED: 'Time limit exceeded',
  SESSION_TIMEOUT: 'Session timeout',
  NETWORK_FAILURE: 'Network failure',
  TAB_CLOSED: 'Browser tab/window closed',
  BROWSER_CRASH: 'Browser crash',
  DEVICE_OR_POWER_FAILURE: 'Device shutdown / power failure',
  SYSTEM_FAILURE: 'System / server failure',
  ABANDONED: 'Interrupted (not submitted)',
};

/** Human label for a submission/failure reason. */
export function failureReasonLabel(r: AssessmentFailureReason): string {
  return FAILURE_REASON_LABEL[r] ?? r;
}

/** Whether the reason is a technical issue (true) vs the user's own action (false). */
export function failureReasonIsTechnical(r: AssessmentFailureReason): boolean {
  return r !== 'USER_SUBMITTED';
}

/**
 * Whether an attempt that ended for this reason should count toward the maximum-attempts
 * limit. Only SERVER-DETERMINED no-submission failures are free (a crash/abandon where no
 * answers ever reached the server is not a real attempt) — these cannot be spoofed by the
 * client. All attempts where the learner actually submitted answers count, but the recorded
 * reason lets a supervisor grant a retake/unblock if a technical issue was to blame.
 */
export function failureReasonCountsAsAttempt(r: AssessmentFailureReason): boolean {
  return r !== 'ABANDONED' && r !== 'SYSTEM_FAILURE';
}

/** Submit answers for a started attempt: { questionId: answer }. */
export const submitAssessmentSchema = z.object({
  attemptId: uuid,
  // A single value (true/false, fill-in, single choice), an array (multi-choice),
  // or a { left: right } map (CR-36, MATCH_THE_WORDS).
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.record(z.string(), z.string())])),
  /** CR-38: set when the attempt was force-submitted on timeout or leaving the page. */
  autoSubmitted: z.boolean().optional(),
  /** The proximate reason for this submission (audit transparency). Server may override. */
  reason: assessmentFailureReason.optional(),
});
export type SubmitAssessmentInput = z.infer<typeof submitAssessmentSchema>;

export const startAssessmentSchema = z.object({
  topicId: uuid,
  assignmentId: uuid.optional(),
});
export type StartAssessmentInput = z.infer<typeof startAssessmentSchema>;

/** Per-question result returned after submission. */
export interface QuestionResult {
  questionId: string;
  questionText: string;
  isCorrect: boolean;
  userAnswer: unknown;
  correctAnswer: unknown;
  explanation?: string | null;
}

export interface AssessmentResult {
  attemptId: string;
  score: number;
  totalQuestions: number;
  attempted: number;
  correctCount: number;
  incorrectCount: number;
  passingScorePercent: number;
  isPassed: boolean;
  isBlocked: boolean;
  attemptNumber: number;
  maxAttempts: number;
  /** Only populated when the attempt failed. */
  incorrectDetails?: QuestionResult[];
  /** Every question in the attempt (correct + incorrect), in display order. */
  allDetails?: QuestionResult[];
  /** BUG-05: actual time the user spent on the assessment (completedAt − startedAt). */
  timeSpentSeconds?: number;
  /** BUG-05: actual time the user spent reading the topic's materials. */
  readingTimeSeconds?: number;
  /** The recorded submission/failure reason (raw enum) and its human label. */
  submissionReason?: AssessmentFailureReason;
  submissionReasonLabel?: string;
  certificateId?: string;
}
