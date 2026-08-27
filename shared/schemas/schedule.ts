import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';
import { scheduleStatus } from './enums';

export const createScheduleSchema = z
  .object({
    topicId: uuid,
    scheduledDate: z.coerce.date(),
    // Internal trainer (a user) OR an external trainer entered by name (trainerName).
    trainerId: uuid.optional(),
    trainerName: optionalString,
    // NOTE: no trainingType here on purpose — the server derives it from the course
    // (a schedule is always for a course, and the course already carries its type).
    methodology: optionalString,
    venue: optionalString,
    maxTrainees: z.coerce.number().int().positive().optional(),
    /** Trainees to assign. The server rejects if trainerId is in this list. */
    traineeIds: z.array(uuid).default([]),
  })
  .refine((d) => !!d.trainerId || !!(d.trainerName && d.trainerName.trim()), {
    message: 'Select a trainer or enter an external trainer name.',
    path: ['trainerId'],
  });
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = z.object({
  scheduledDate: z.coerce.date().optional(),
  trainerId: uuid.optional(),
  methodology: optionalString,
  venue: optionalString,
  maxTrainees: z.coerce.number().int().positive().optional(),
  status: scheduleStatus.optional(),
  reasonForChange,
});
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

/** Offline / OJT record entry. completionDate may not be in the future. */
export const ojtRecordSchema = z
  .object({
    topicId: uuid,
    userId: uuid,
    // Internal evaluator (a user) OR an external evaluator entered by name (evaluatorName).
    evaluatorId: uuid.optional(),
    evaluatorName: optionalString,
    evaluationDate: z.coerce.date().max(new Date(), { message: 'Date cannot be in the future' }),
    evaluationScore: z.coerce.number().min(0).max(100),
    content: optionalString, // optional, multi-line training details
    remarks: optionalString,
  })
  .refine((d) => !!d.evaluatorId || !!(d.evaluatorName && d.evaluatorName.trim()), {
    message: 'Select an evaluator or enter an external evaluator name.',
    path: ['evaluatorId'],
  })
  // Module 6: a person cannot evaluate their own on-the-job training. (Only applies to an
  // internal evaluator — an external evaluator has no user id.)
  .refine((d) => !d.evaluatorId || d.evaluatorId !== d.userId, {
    message: 'The evaluator cannot be the trainee of the same OJT record.',
    path: ['evaluatorId'],
  });
export type OjtRecordInput = z.infer<typeof ojtRecordSchema>;

export const offlineTrainingSchema = z
  .object({
    topicId: uuid,
    venue: nonEmptyString,
    trainerName: nonEmptyString,
    /** Set when the trainer is an internal user; omitted for an external trainer. */
    trainerId: uuid.optional(),
    durationMinutes: z.coerce.number().int().positive(),
    trainingDate: z.coerce.date().max(new Date(), { message: 'Date cannot be in the future' }),
    traineeIds: z.array(uuid).default([]),
  })
  .superRefine((v, ctx) => {
    // Module 6: an internal trainer can never also be a trainee on the same record.
    if (v.trainerId && v.traineeIds.includes(v.trainerId)) {
      ctx.addIssue({ code: 'custom', message: 'The trainer cannot be a trainee in the same training.', path: ['traineeIds'] });
    }
  });
export type OfflineTrainingInput = z.infer<typeof offlineTrainingSchema>;
