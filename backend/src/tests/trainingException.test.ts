import type { Request } from 'express';

jest.mock('../config/prisma', () => ({ prisma: {
  user: { findFirst: jest.fn(), findMany: jest.fn() },
  tniRequirement: { findMany: jest.fn() },
  trainingTopic: { findMany: jest.fn(), findFirst: jest.fn() },
  trainingAssignment: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  assessmentAttempt: { count: jest.fn() },
  attendance: { count: jest.fn() },
} }));
jest.mock('../services/eSignature.service', () => ({ signFromRequest: jest.fn().mockResolvedValue('signature-1') }));
jest.mock('../services/notification.service', () => ({ notifyTrainingAssigned: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/materialView.service', () => ({ hasCompletedRequiredReading: jest.fn() }));
jest.mock('../middlewares/auditTrail.middleware', () => ({ auditedTransaction: jest.fn() }));

import { prisma } from '../config/prisma';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { assignRequiredCoursesToUser, carryNotRequiredAssignmentsToRevision, markNotRequired, restoreRequired } from '../services/assignment.service';
import { applyRequirementMatrix } from '../services/tni.service';

const db = prisma as any;
const actor = { user: { id: 'supervisor-1', permissions: { team: { mark_not_required: true } } }, auditReason: 'Not part of this employee role' } as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
});

it('does not reassign an exempt course when a user role is updated', async () => {
  db.user.findFirst.mockResolvedValue({ id: 'user-1', designationId: 'role-1', designationIds: ['role-1'] });
  db.tniRequirement.findMany.mockResolvedValue([{ topicId: 'course-1' }]);
  db.trainingTopic.findMany.mockResolvedValue([{ id: 'course-1' }]);
  db.trainingAssignment.findFirst.mockResolvedValue({ id: 'exception-1', status: 'NOT_REQUIRED' });

  expect(await assignRequiredCoursesToUser('user-1', 'supervisor-1')).toBe(0);
  expect(db.trainingAssignment.create).not.toHaveBeenCalled();
});

it('does not recreate an exempt assignment when the TNI matrix is applied again', async () => {
  db.tniRequirement.findMany.mockResolvedValue([{ designationId: 'role-1', topicId: 'course-1' }]);
  db.trainingTopic.findMany.mockResolvedValue([{ id: 'course-1', dueDate: null }]);
  db.user.findMany.mockResolvedValue([{ id: 'user-1', designationId: 'role-1', designationIds: ['role-1'] }]);
  db.trainingAssignment.findMany.mockResolvedValue([{ userId: 'user-1', topicId: 'course-1', status: 'NOT_REQUIRED' }]);

  expect(await applyRequirementMatrix({}, actor)).toEqual({ created: 0 });
  expect(db.trainingAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ status: { notIn: ['WAIVED'] } }),
  }));
  expect(db.trainingAssignment.create).not.toHaveBeenCalled();
});

it('carries the exception and its reason to a revised course version', async () => {
  const at = new Date('2026-10-26T10:00:00.000Z');
  db.trainingAssignment.findMany.mockResolvedValue([{
    id: 'exception-1', userId: 'user-1', assignmentType: 'ROLE_SPECIFIC',
    notRequiredReason: 'Not part of this employee role', notRequiredBy: 'supervisor-1', notRequiredAt: at,
  }]);
  db.trainingAssignment.findFirst.mockResolvedValue(null);
  db.trainingAssignment.create.mockResolvedValue({ id: 'exception-2' });

  expect(await carryNotRequiredAssignmentsToRevision('course-v1', 'course-v2', 'admin-1')).toBe(1);
  expect(db.trainingAssignment.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    userId: 'user-1', topicId: 'course-v2', status: 'NOT_REQUIRED',
    notRequiredReason: 'Not part of this employee role', notRequiredBy: 'supervisor-1', notRequiredAt: at,
  }) });
});

it('records a reasoned audit entry when a supervisor marks training not required', async () => {
  const row = { id: 'assignment-1', userId: 'user-1', topicId: 'course-1', status: 'PENDING' };
  db.trainingAssignment.findFirst.mockResolvedValue(row);
  db.user.findFirst.mockResolvedValue({ supervisorId: 'supervisor-1' });
  db.trainingTopic.findFirst.mockResolvedValue({ status: 'PUBLISHED', supersededByTopicId: null });
  db.assessmentAttempt.count.mockResolvedValue(0);
  db.trainingAssignment.findMany.mockResolvedValue([row]);
  db.trainingAssignment.update.mockResolvedValue({ ...row, status: 'NOT_REQUIRED', notRequiredReason: actor.auditReason, notRequiredBy: 'supervisor-1' });
  let audits: any[] = [];
  (auditedTransaction as jest.Mock).mockImplementation(async (_client, work) => {
    const result = await work(db);
    audits = result.audits;
    return result.result;
  });

  await markNotRequired('assignment-1', actor);
  expect(db.trainingAssignment.update).toHaveBeenCalledWith({
    where: { id: 'assignment-1' },
    data: expect.objectContaining({ status: 'NOT_REQUIRED', notRequiredReason: actor.auditReason, notRequiredBy: 'supervisor-1' }),
  });
  expect(audits).toEqual([expect.objectContaining({
    entityType: 'TrainingAssignment', entityId: 'assignment-1', reasonForChange: actor.auditReason,
    oldValue: row,
    newValue: expect.objectContaining({ id: 'assignment-1', userId: 'user-1', topicId: 'course-1', status: 'NOT_REQUIRED', notRequiredReason: actor.auditReason }),
  })]);
});

it('restores an exempt course, clears its exception, and audits the decision', async () => {
  const row = { id: 'assignment-1', userId: 'user-1', topicId: 'course-1', status: 'NOT_REQUIRED', dueDate: null };
  db.trainingAssignment.findFirst.mockResolvedValue(row);
  db.user.findFirst.mockResolvedValue({ supervisorId: 'supervisor-1' });
  db.trainingTopic.findFirst.mockResolvedValue({ status: 'PUBLISHED', supersededByTopicId: null });
  db.trainingAssignment.findMany.mockResolvedValue([row]);
  db.trainingAssignment.update.mockResolvedValue({ ...row, status: 'PENDING', notRequiredReason: null, notRequiredBy: null, notRequiredAt: null });
  let audits: any[] = [];
  (auditedTransaction as jest.Mock).mockImplementation(async (_client, work) => {
    const result = await work(db);
    audits = result.audits;
    return result.result;
  });

  await restoreRequired('assignment-1', actor);
  expect(db.trainingAssignment.update).toHaveBeenCalledWith({
    where: { id: 'assignment-1' },
    data: expect.objectContaining({ status: 'PENDING', notRequiredReason: null, notRequiredBy: null, notRequiredAt: null }),
  });
  expect(audits).toEqual([expect.objectContaining({
    entityId: 'assignment-1', reasonForChange: actor.auditReason, oldValue: row,
    newValue: expect.objectContaining({ id: 'assignment-1', userId: 'user-1', status: 'PENDING', notRequiredReason: null }),
  })]);
});

it('refuses to mark training not required after an assessment attempt', async () => {
  db.trainingAssignment.findFirst.mockResolvedValue({ id: 'assignment-1', userId: 'user-1', topicId: 'course-1', status: 'IN_PROGRESS' });
  db.user.findFirst.mockResolvedValue({ supervisorId: 'supervisor-1' });
  db.trainingTopic.findFirst.mockResolvedValue({ status: 'PUBLISHED', supersededByTopicId: null });
  db.assessmentAttempt.count.mockResolvedValue(1);
  db.trainingAssignment.findMany.mockResolvedValue([]);

  await expect(markNotRequired('assignment-1', actor)).rejects.toThrow('assessment attempts');
  expect(db.trainingAssignment.update).not.toHaveBeenCalled();
});

it('prevents a supervisor from changing another supervisor’s employee', async () => {
  db.trainingAssignment.findFirst.mockResolvedValue({ id: 'assignment-1', userId: 'user-1', topicId: 'course-1', status: 'PENDING' });
  db.user.findFirst.mockResolvedValue({ supervisorId: 'someone-else' });

  await expect(markNotRequired('assignment-1', actor)).rejects.toThrow('direct reports');
  expect(db.trainingAssignment.update).not.toHaveBeenCalled();
});
