import { z } from 'zod';
import { nonEmptyString, optionalString, uuid, reasonForChange } from './common';
import { trainingType, scheduleStatus } from './enums';

export const createScheduleSchema = z.object({
  topicId: uuid,
  scheduledDate: z.coerce.date(),
  trainerId: uuid,
  trainingType,
  methodology: optionalString,
  venue: optionalString,
  maxTrainees: z.coerce.number().int().positive().optional(),
  /** Trainees to assign. The server rejects if trainerId is in this list. */
  traineeIds: z.array(uuid).default([]),
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
export const ojtRecordSchema = z.object({
  topicId: uuid,
  userId: uuid,
  evaluatorId: uuid,
  evaluationDate: z.coerce.date().max(new Date(), { message: 'Date cannot be in the future' }),
  evaluationScore: z.coerce.number().min(0).max(100),
  content: optionalString, // optional, multi-line training details
  remarks: optionalString,
});
export type OjtRecordInput = z.infer<typeof ojtRecordSchema>;

export const offlineTrainingSchema = z.object({
  topicId: uuid,
  venue: nonEmptyString,
  trainerName: nonEmptyString,
  durationMinutes: z.coerce.number().int().positive(),
  trainingDate: z.coerce.date().max(new Date(), { message: 'Date cannot be in the future' }),
  traineeIds: z.array(uuid).default([]),
});
export type OfflineTrainingInput = z.infer<typeof offlineTrainingSchema>;
