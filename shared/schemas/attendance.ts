import { z } from 'zod';
import { uuid } from './common';
import { attendanceStatus } from './enums';

export const markAttendanceSchema = z.object({
  scheduleId: uuid,
  entries: z
    .array(
      z.object({
        userId: uuid,
        status: attendanceStatus,
      }),
    )
    .min(1),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

/** One row parsed from an attendance Excel upload. */
export const attendanceUploadRow = z.object({
  rowNumber: z.number().int(),
  employeeId: z.string(),
  status: z.string(),
});
export type AttendanceUploadRow = z.infer<typeof attendanceUploadRow>;
