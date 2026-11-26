import express from 'express';
import request from 'supertest';
import courseRoutes from '../routes/trainingTopic.routes';
import designationRoutes from '../routes/designation.routes';
import { errorHandler } from '../middlewares/errorHandler.middleware';
import { mergePermissions } from '../utils/permissions';
import { prisma } from '../config/prisma';

jest.mock('../config/prisma', () => ({ prisma: {
  designationMaster: { findMany: jest.fn() },
  trainingTypeMaster: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
} }));
jest.mock('../services/trainingTopic.service', () => ({}));
jest.mock('../services/topicVersionHistory.service', () => ({}));
jest.mock('../services/systemConfig.service', () => ({}));
jest.mock('../utils/exportTable', () => ({}));
jest.mock('../services/auditTrail.service', () => ({ recordEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../middlewares/auth.middleware', () => ({ authenticate: (req: any, res: any, next: any) => {
  if (!req.headers['x-authenticated']) return res.status(401).end();
  req.user = {
    id: 'mixed-role-user', roleNames: ['Trainee', 'Trainer'],
    permissions: mockPermissions,
  };
  next();
} }));

let mockPermissions: any;
const app = express();
app.use(express.json());
app.use('/topics', courseRoutes);
app.use('/master/designations', designationRoutes);
app.use(errorHandler);

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.designationMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'functional-role', displayName: 'Operator' }]);
  (prisma.trainingTypeMaster.findMany as jest.Mock).mockResolvedValue([{ code: 'CUSTOM', displayName: 'Custom Training' }]);
  (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'signatory', fullName: 'Quality Reviewer', employeeId: 'EMP-2' }]);
});

it.each(['create', 'edit'])('allows a trainee/trainer with course %s permission to load picker data without master access', async (action) => {
  mockPermissions = mergePermissions([
    { courseManagement: { create: false, edit: false }, masterSetup: { read: false }, userManagement: { read: false } } as any,
    { courseManagement: { [action]: true } } as any,
  ]);
  const response = await request(app).get('/topics/form-lookups').set('x-authenticated', 'yes');
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({
    functionalRoles: [{ id: 'functional-role', displayName: 'Operator' }],
    trainingTypes: [{ code: 'CUSTOM', displayName: 'Custom Training' }],
    signatories: [{ id: 'signatory', fullName: 'Quality Reviewer', employeeId: 'EMP-2' }],
  });
  expect(prisma.designationMaster.findMany).toHaveBeenCalledWith({
    where: { isActive: true, isDeleted: false }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' },
  });
  // Course authors receive names/codes only, never emails, roles, credentials or profiles.
  expect(prisma.user.findMany).toHaveBeenCalledWith({
    where: { isActive: true, isDeleted: false },
    select: { id: true, fullName: true, employeeId: true },
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
  });
  expect(mockPermissions.userManagement.read).toBe(false);
  // Course authoring does not grant permission to list/edit the master itself.
  expect((await request(app).get('/master/designations').set('x-authenticated', 'yes')).status).toBe(403);
  expect((await request(app).post('/master/designations').set('x-authenticated', 'yes').send({})).status).toBe(403);
});

it('denies lookup access for a trainee with no course authoring permission', async () => {
  mockPermissions = { courseManagement: { view: true, create: false, edit: false } };
  expect((await request(app).get('/topics/form-lookups').set('x-authenticated', 'yes')).status).toBe(403);
  expect(prisma.designationMaster.findMany).not.toHaveBeenCalled();
  expect(prisma.user.findMany).not.toHaveBeenCalled();
});

it('requires authentication', async () => {
  expect((await request(app).get('/topics/form-lookups')).status).toBe(401);
});
