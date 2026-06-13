import { z } from 'zod';
import { uuid, reasonForChange } from './common';
import { assignmentType, assignmentStatus } from './enums';

export const createAssignmentSchema = z
  .object({
    assignmentType,
    topicId: uuid.optional(),
    topicIds: z.array(uuid).optional(),
    userId: uuid.optional(),
    userIds: z.array(uuid).optional(),
    roleId: uuid.optional(),
    scheduleId: uuid.optional(),
    dueDate: z.coerce.date().optional(),
    tniId: uuid.optional(),
    // CR-57: assign-later — create the assignment now but keep it DEFERRED
    // (hidden from the trainee) until `activateOn` arrives or it is activated.
    activateLater: z.boolean().optional(),
    activateOn: z.coerce.date().optional(),
  })
  .superRefine((a, ctx) => {
    if (a.assignmentType === 'COURSE_SPECIFIC' && !a.topicId) {
      ctx.addIssue({ code: 'custom', message: 'topicId is required', path: ['topicId'] });
    }
    if (a.assignmentType === 'PERSON_SPECIFIC' && !a.userId) {
      ctx.addIssue({ code: 'custom', message: 'userId is required', path: ['userId'] });
    }
    if (a.assignmentType === 'ROLE_SPECIFIC' && (!a.roleId || !a.topicId)) {
      ctx.addIssue({ code: 'custom', message: 'roleId and topicId are required', path: ['roleId'] });
    }
  });
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const updateAssignmentSchema = z.object({
  status: assignmentStatus.optional(),
  dueDate: z.coerce.date().optional(),
  reasonForChange,
});
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

export const waiveAssignmentSchema = z.object({
  reasonForChange,
});
export type WaiveAssignmentInput = z.infer<typeof waiveAssignmentSchema>;

/** CR-56: supervisor sign-off on a completion/late assignment. */
export const supervisorDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reasonForChange,
});
export type SupervisorDecisionInput = z.infer<typeof supervisorDecisionSchema>;
