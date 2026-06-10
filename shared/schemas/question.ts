import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';
import { questionType } from './enums';

export const questionOption = z.object({
  id: z.string(),
  text: z.string(),
});
export type QuestionOption = z.infer<typeof questionOption>;

/** Left/right pair for MATCH_THE_WORDS questions. */
export const matchPair = z.object({
  left: z.string(),
  right: z.string(),
});

export const createQuestionSchema = z
  .object({
    topicId: uuid,
    questionText: nonEmptyString,
    questionType,
    options: z.array(questionOption).optional(),
    matchPairs: z.array(matchPair).optional(),
    /** Array of correct option ids, an answer string, or accepted variants. */
    correctAnswer: z.union([z.array(z.string()), z.string()]),
    explanation: optionalString,
    isMandatory: z.boolean().default(false),
  })
  .superRefine((q, ctx) => {
    if (
      (q.questionType === 'MULTIPLE_CHOICE_SINGLE' ||
        q.questionType === 'MULTIPLE_CHOICE_MULTI') &&
      (!q.options || q.options.length < 2)
    ) {
      ctx.addIssue({ code: 'custom', message: 'At least two options are required', path: ['options'] });
    }
    if (q.questionType === 'MATCH_THE_WORDS' && (!q.matchPairs || q.matchPairs.length < 2)) {
      ctx.addIssue({ code: 'custom', message: 'At least two pairs are required', path: ['matchPairs'] });
    }
  });
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export const updateQuestionSchema = z
  .object({
    questionText: nonEmptyString.optional(),
    // 4.5: questionType is now editable; options/correctAnswer are re-derived for the new type.
    questionType: questionType.optional(),
    options: z.array(questionOption).optional(),
    matchPairs: z.array(matchPair).optional(),
    correctAnswer: z.union([z.array(z.string()), z.string()]).optional(),
    explanation: optionalString,
    isMandatory: z.boolean().optional(),
    isActive: z.boolean().optional(),
    reasonForChange,
  })
  .superRefine((q, ctx) => {
    // When the question TYPE is changed, the answer key must be re-supplied so it
    // cannot be left in a shape the new type can't grade (otherwise the question
    // becomes silently un-gradeable). Edits that don't change the type are unaffected.
    if (q.questionType === undefined) return;
    if (
      (q.questionType === 'MULTIPLE_CHOICE_SINGLE' || q.questionType === 'MULTIPLE_CHOICE_MULTI') &&
      (!q.options || q.options.length < 2)
    ) {
      ctx.addIssue({ code: 'custom', message: 'At least two options are required when changing to this type', path: ['options'] });
    }
    if (q.questionType === 'MATCH_THE_WORDS' && (!q.matchPairs || q.matchPairs.length < 2)) {
      ctx.addIssue({ code: 'custom', message: 'At least two pairs are required when changing to this type', path: ['matchPairs'] });
    }
    if (q.correctAnswer === undefined) {
      ctx.addIssue({ code: 'custom', message: 'correctAnswer must be supplied when changing the question type', path: ['correctAnswer'] });
    }
  });
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

/** How many questions to draw from the non-mandatory pool when generating an assessment. */
export const generateAssessmentSchema = z.object({
  topicId: uuid,
  assignmentId: uuid.optional(),
});
export type GenerateAssessmentInput = z.infer<typeof generateAssessmentSchema>;
