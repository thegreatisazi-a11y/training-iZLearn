import { z } from 'zod';
import { nonEmptyString, uuid, reasonForChange } from './common';

export const feedbackQuestionType = z.enum(['RATING', 'TEXT', 'MULTIPLE_CHOICE']);
export type FeedbackQuestionType = z.infer<typeof feedbackQuestionType>;

export const feedbackQuestion = z.object({
  id: z.string(),
  text: nonEmptyString,
  type: feedbackQuestionType,
  options: z.array(z.string()).optional(),
});
export type FeedbackQuestion = z.infer<typeof feedbackQuestion>;

export const createFeedbackFormSchema = z.object({
  topicId: uuid,
  title: nonEmptyString,
  questions: z.array(feedbackQuestion).min(1),
});
export type CreateFeedbackFormInput = z.infer<typeof createFeedbackFormSchema>;

export const updateFeedbackFormSchema = z.object({
  title: nonEmptyString.optional(),
  questions: z.array(feedbackQuestion).optional(),
  isActive: z.boolean().optional(),
  reasonForChange,
});
export type UpdateFeedbackFormInput = z.infer<typeof updateFeedbackFormSchema>;

export const submitFeedbackSchema = z.object({
  formId: uuid,
  scheduleId: uuid.optional(),
  responses: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;
