import { z } from 'zod';
import { uuid } from './common';

/** Submit answers for a started attempt: { questionId: answer }. */
export const submitAssessmentSchema = z.object({
  attemptId: uuid,
  // A single value (true/false, fill-in, single choice), an array (multi-choice),
  // or a { left: right } map (CR-36, MATCH_THE_WORDS).
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.record(z.string(), z.string())])),
  /** CR-38: set when the attempt was force-submitted on timeout or leaving the page. */
  autoSubmitted: z.boolean().optional(),
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
  certificateId?: string;
}
