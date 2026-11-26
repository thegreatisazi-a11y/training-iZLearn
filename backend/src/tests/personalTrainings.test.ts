import express from 'express';
import request from 'supertest';
import assignmentRoutes from '../routes/assignment.routes';
import { getDashboard } from '../services/dashboard.service';
import { prisma } from '../config/prisma';
import { mergePermissions } from '../utils/permissions';
import { errorHandler } from '../middlewares/errorHandler.middleware';
import { isVisiblePersonalTraining } from '../utils/personalTrainingVisibility';

jest.mock('../config/prisma', () => ({ prisma: {
  trainingAssignment: { findMany: jest.fn(), count: jest.fn() }, trainingTopic: { findMany: jest.fn() },
  assessmentAttempt: { findMany: jest.fn() }, certificate: { count: jest.fn() },
  user: { findUnique: jest.fn() }, announcement: { findMany: jest.fn() },
} }));
jest.mock('../services/materialView.service', () => ({ hasCompletedRequiredReading: jest.fn().mockResolvedValue(false) }));
jest.mock('../services/eSignature.service', () => ({}));
jest.mock('../services/notification.service', () => ({}));
jest.mock('../middlewares/auditTrail.middleware', () => ({ auditedTransaction: jest.fn() }));
jest.mock('../middlewares/auth.middleware', () => ({ authenticate: (req: any, _res: any, next: any) => {
  req.user = mockUser; next();
} }));

let mockUser: any;
const db = prisma as any;
const app = express(); app.use('/assignments', assignmentRoutes); app.use(errorHandler);
const topic = { id: 'published', title: 'Assigned SOP', status: 'PUBLISHED', currentVersion: 1, isDeleted: false, requiresAssessment: true };
const assignments = [
  { id: 'mine', userId: 'employee', topicId: 'published', status: 'PENDING', isDeleted: false },
  { id: 'someone-else', userId: 'other', topicId: 'published', status: 'PENDING', isDeleted: false },
  { id: 'orphan', userId: 'employee', topicId: 'missing', status: 'PENDING', isDeleted: false },
  { id: 'deleted', userId: 'employee', topicId: 'deleted-course', status: 'PENDING', isDeleted: false },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'employee', roleNames: ['Trainee', 'Trainer'], roleIds: ['trainee', 'trainer'], permissions: mergePermissions([
    { courseManagement: { create: false, edit: false } } as any,
    { courseManagement: { create: true, edit: true }, scheduling: { view_all: true } } as any,
  ]) };
  db.trainingAssignment.findMany.mockImplementation(async ({ where }: any) => assignments.filter((a) => a.userId === where.userId && !where.status.notIn.includes(a.status)));
  db.trainingAssignment.count.mockImplementation(async ({ where }: any) => assignments.filter((a) =>
    a.userId === where.userId && a.status === where.status && where.topicId.in.includes(a.topicId)).length);
  db.trainingTopic.findMany.mockImplementation(async ({ where }: any) => [topic].filter((t) => !where.id || where.id.in.includes(t.id)));
  db.assessmentAttempt.findMany.mockResolvedValue([]);
  db.certificate.count.mockResolvedValue(0);
  db.user.findUnique.mockResolvedValue({ dashboardPrefs: null });
  db.announcement.findMany.mockResolvedValue([]);
});

it('shows a trainee/trainer their assigned published course, and keeps /mine strictly self-scoped', async () => {
  const response = await request(app).get('/assignments/mine?userId=other');
  expect(response.status).toBe(200);
  expect(response.body.data.map((a: any) => a.id)).toEqual(['mine']);
  expect(response.body.data[0].topic.title).toBe('Assigned SOP');
  expect(db.trainingAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'employee' }) }));
});

it('keeps personal dashboard counts aligned with the list, excluding missing/deleted courses', async () => {
  const dashboard: any = await getDashboard(mockUser);
  const response = await request(app).get('/assignments/mine');
  expect(dashboard.me.pending).toBe(1);
  expect(dashboard.me.pending).toBe(response.body.data.filter((a: any) => a.status === 'PENDING').length);
});

it('does not change personal training visibility when the trainer role is absent', async () => {
  mockUser.roleNames = ['Trainee']; mockUser.permissions = {};
  expect((await request(app).get('/assignments/mine')).body.data.map((a: any) => a.id)).toEqual(['mine']);
});

it.each(['DEFERRED', 'NOT_REQUIRED'])('keeps %s assignments hidden', (status) => {
  expect(isVisiblePersonalTraining(status, topic)).toBe(false);
});

it('hides superseded and unpublished pending courses while preserving completion history', () => {
  expect(isVisiblePersonalTraining('PENDING', { ...topic, status: 'DRAFT' })).toBe(false);
  expect(isVisiblePersonalTraining('PENDING', { ...topic, supersededByTopicId: 'revision' })).toBe(false);
  expect(isVisiblePersonalTraining('COMPLETED', { ...topic, status: 'ARCHIVED' })).toBe(true);
  expect(isVisiblePersonalTraining('WAIVED', { ...topic, status: 'ARCHIVED' })).toBe(true);
});
