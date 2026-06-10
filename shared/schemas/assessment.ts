import { z } from 'zod';
import { uuid } from './common';

/** Submit answers for a started attempt: { questionId: answer }. */
export const submitAssessmentSchema = z.object({
  attemptId: uuid,
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
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
  certificateId?: string;
}
