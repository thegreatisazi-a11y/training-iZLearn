import express from 'express';
import request from 'supertest';
import router from '../routes/user.routes';
import { errorHandler } from '../middlewares/errorHandler.middleware';
import { mergePermissions } from '../utils/permissions';
import { activateUser, deactivateUser, checkRequestDecision } from '../services/user.service';
import { updateRole } from '../services/role.service';
import { prisma } from '../config/prisma';

jest.mock('../config/prisma', () => ({ prisma: { role: { findFirst: jest.fn(), update: jest.fn() } } }));
jest.mock('../services/user.service', () => ({ activateUser: jest.fn().mockResolvedValue({}), deactivateUser: jest.fn().mockResolvedValue({}), checkRequestDecision: jest.fn().mockResolvedValue({ eligible: true }) }));
jest.mock('../services/eSignature.service', () => ({ signFromRequest: jest.fn().mockResolvedValue('signature') }));
jest.mock('../services/systemConfig.service', () => ({}));
jest.mock('../utils/exportTable', () => ({}));
jest.mock('../utils/excelExporter', () => ({}));
jest.mock('../services/auditTrail.service', () => ({ recordEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../middlewares/upload.middleware', () => ({ uploadExcel: { single: () => (_req: any, _res: any, next: any) => next() } }));
jest.mock('../middlewares/auth.middleware', () => ({ authenticate: (req: any, _res: any, next: any) => {
  req.user = { id: 'actor', roleNames: ['Reviewer'], permissions: mockPermissions }; next();
} }));
let mockPermissions: any;
const app = express(); app.use(express.json()); app.use('/users', router); app.use(errorHandler);
beforeEach(() => jest.clearAllMocks());

it.each(['activate', 'deactivate'])('blocks %s when Users approval is off, even with request approval and editing enabled', async (action) => {
  mockPermissions = { userManagement: { approve: false, edit: true, write: true }, userRequests: { approve: true } };
  const response = await request(app).post(`/users/target/${action}`).send({ reasonForChange: 'Permission regression check' });
  expect(response.status).toBe(403);
  expect(activateUser).not.toHaveBeenCalled(); expect(deactivateUser).not.toHaveBeenCalled();
});

it('allows Users deactivation independently of User Requests approval', async () => {
  mockPermissions = { userManagement: { approve: true }, userRequests: { approve: false } };
  expect((await request(app).post('/users/target/deactivate').send({ reasonForChange: 'Permission regression check' })).status).toBe(200);
  expect(deactivateUser).toHaveBeenCalledTimes(1);
});

it('honours a Users approval grant from another active role', async () => {
  mockPermissions = mergePermissions([{ userManagement: { approve: false } } as any, { userManagement: { approve: true } } as any]);
  expect((await request(app).post('/users/target/deactivate').send({ reasonForChange: 'Permission regression check' })).status).toBe(200);
});

it('persists Users approval as false when its switch is saved off while editing remains enabled', async () => {
  (prisma.role.findFirst as jest.Mock).mockResolvedValue({ id: 'role', roleName: 'Reviewer', isActive: true, isSystem: false,
    permissions: { userManagement: { view: true, edit: true, approve: true, read: true, write: true } } });
  (prisma.role.update as jest.Mock).mockImplementation(async ({ data }) => ({ id: 'role', ...data }));
  await updateRole('role', { permissions: { userManagement: { view: true, edit: true, approve: false } }, reasonForChange: 'Remove activation permission' } as any, { user: { id: 'admin' } } as any);
  expect(prisma.role.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    permissions: { userManagement: expect.objectContaining({ edit: true, write: true, approve: false }) },
  }) }));
});

it('protects the preflight endpoint with User Requests approval permission', async () => {
  mockPermissions = { userManagement: { approve: true }, userRequests: { approve: false } };
  expect((await request(app).post('/users/requests/target/decision-check').send({ decision: 'REJECT' })).status).toBe(403);
  expect(checkRequestDecision).not.toHaveBeenCalled();
});

it('validates a preflight decision without requiring signature credentials or a change reason', async () => {
  mockPermissions = { userRequests: { approve: true } };
  expect((await request(app).post('/users/requests/target/decision-check').send({ decision: 'APPROVE' })).status).toBe(200);
  expect(checkRequestDecision).toHaveBeenCalledWith('target', 'APPROVE', expect.anything());
  jest.mocked(checkRequestDecision).mockClear();
  expect((await request(app).post('/users/requests/target/decision-check').send({ decision: 'INVALID' })).status).toBe(400);
  expect(checkRequestDecision).not.toHaveBeenCalled();
});
