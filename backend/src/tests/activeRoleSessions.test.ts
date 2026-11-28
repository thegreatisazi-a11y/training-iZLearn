import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { prisma } from '../config/prisma';
import { authenticate, buildAuthUser } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/rbac.middleware';
import { errorHandler } from '../middlewares/errorHandler.middleware';
import { login, refresh, switchRole } from '../services/auth.service';
import * as sessions from '../services/session.service';
import { comparePassword } from '../utils/passwordUtils';
import { verifyAccessToken, signAccessToken } from '../utils/jwtUtils';
import { isLocked } from '../config/redis';
import { auditContext } from '../utils/auditContext';
import { recordEvent } from '../services/auditTrail.service';
import { authenticateVideoPlayback } from '../middlewares/videoPlayback.middleware';
import { createVideoTicket, videoCookieName } from '../utils/videoPlayback';

jest.mock('../config/prisma', () => ({ prisma: {
  user: { findFirst: jest.fn(), update: jest.fn() },
  userRole: { findMany: jest.fn() }, role: { findMany: jest.fn() },
  userSession: { findFirst: jest.fn(), updateMany: jest.fn() },
  auditTrail: { create: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock('../config/redis', () => ({ isLocked: jest.fn(), clearLock: jest.fn(), setLocked: jest.fn() }));
jest.mock('../utils/passwordUtils', () => ({ comparePassword: jest.fn() }));
jest.mock('../utils/jwtUtils', () => ({ signAccessToken: jest.fn((_u, _s, role) => `access-${role?.roleContext}`), verifyAccessToken: jest.fn(), verifyRefreshToken: jest.fn(() => ({ sub: 'user', sid: 'session' })) }));
jest.mock('../services/session.service', () => ({ createSession: jest.fn(), getActiveSessions: jest.fn(), invalidateSession: jest.fn(), terminatePreviousSessions: jest.fn(), isSessionActive: jest.fn() }));
jest.mock('../services/systemConfig.service', () => ({ getAuthPolicy: jest.fn(async () => ({ maxFailedAttempts: 5, lockoutMinutes: 30 })) }));
jest.mock('../services/ldap.service', () => ({ isEnabled: jest.fn(async () => false) }));
jest.mock('../services/notification.service', () => ({ notifySessionTerminated: jest.fn() }));
jest.mock('../services/auditTrail.service', () => ({ recordEvent: jest.fn() }));

const db = prisma as any;
let roles: any[]; let memberships: any[]; let live: any;
const user = { id: 'user', windowsUsername: 'darshit', fullName: 'Darshit Shah', employeeId: 'EMP-10', failedLoginAttempts: 0, isActive: true, passwordHash: 'hash', mustChangePassword: false };
const credential = { windowsUsername: 'darshit', password: 'password' };
const app = express();
app.use(cookieParser());
app.use((_req, _res, next) => auditContext.run({ actor: { userId: 'ANONYMOUS', userFullName: 'Anonymous' } }, next));
app.get('/course', authenticate, requirePermission('courseManagement', 'create'), (_req, res) => res.json({ ok: true }));
app.get('/principal', authenticate, (req, res) => res.json({ ...req.user, auditActor: auditContext.getStore()?.actor }));
app.get('/video/:id', authenticateVideoPlayback, (_req, res) => res.json({ ok: true }));
app.use(errorHandler);
const startSession = (roleId = 'trainer') => { live = { userId: 'user', sessionId: 'session', isActive: true, activeRoleId: roleId, roleContext: 'initial-context', expiresAt: new Date(Date.now() + 3600000) }; };

beforeEach(() => {
  jest.clearAllMocks(); live = null;
  roles = [
    { id: 'trainer', roleName: 'Trainer', isSystem: false, isActive: true, isDeleted: false, permissions: { courseManagement: { create: true }, scheduling: { view: true } } },
    { id: 'supervisor', roleName: 'Supervisor', isSystem: false, isActive: true, isDeleted: false, permissions: { courseManagement: { create: false }, scheduling: { view_team: true } } },
    { id: 'system', roleName: 'Renamed System Role', isSystem: true, isActive: true, isDeleted: false, permissions: { userManagement: { approve: true } } },
  ];
  memberships = roles.map((role) => ({ userId: 'user', roleId: role.id, isActive: true }));
  db.user.findFirst.mockResolvedValue({ ...user }); db.user.update.mockResolvedValue({ ...user });
  db.userRole.findMany.mockImplementation(async () => memberships.filter((link) => link.isActive));
  db.role.findMany.mockImplementation(async ({ where }: any) => roles.filter((role) => where.id.in.includes(role.id) && role.isActive && !role.isDeleted));
  db.userSession.findFirst.mockImplementation(async () => live?.isActive && live.expiresAt > new Date() ? live : null);
  db.userSession.updateMany.mockImplementation(async ({ where, data }: any) => {
    if (!live?.isActive || live.roleContext !== where.roleContext || live.expiresAt <= new Date()) return { count: 0 };
    Object.assign(live, data); return { count: 1 };
  });
  db.$transaction.mockImplementation(async (work: any) => work(db));
  jest.mocked(comparePassword).mockResolvedValue(true);
  jest.mocked(isLocked).mockResolvedValue(false);
  jest.mocked(sessions.getActiveSessions).mockImplementation(async () => live ? [{ sessionId: 'session', deviceInfo: 'browser' }] as any : []);
  jest.mocked(sessions.isSessionActive).mockImplementation(async () => !!live?.isActive);
  jest.mocked(sessions.createSession).mockImplementation(async (_userId, _device, _ip, roleId) => { startSession(roleId); return { sessionId: 'session', refreshToken: 'refresh' }; });
  jest.mocked(verifyAccessToken).mockImplementation(() => ({ sub: 'user', sid: 'session', rid: live?.activeRoleId, rc: live?.roleContext }));
});

it('reveals role choices only after validating credentials and creates no session yet', async () => {
  jest.mocked(comparePassword).mockResolvedValue(false);
  await expect(login(credential, undefined, undefined)).rejects.toMatchObject({ statusCode: 401 });
  expect(db.role.findMany).not.toHaveBeenCalled();
  jest.mocked(comparePassword).mockResolvedValue(true);
  const result = await login(credential, undefined, undefined);
  expect(result).toMatchObject({ requiresRoleSelection: true, roles: expect.arrayContaining([{ id: 'trainer', name: 'Trainer' }]) });
  expect(result).not.toHaveProperty('accessToken');
  expect(sessions.createSession).not.toHaveBeenCalled();
});

it('logs a single-role user straight in and captures that role in the login audit', async () => {
  memberships = memberships.filter((link) => link.roleId === 'trainer');
  const result = await login(credential, undefined, undefined);
  expect(result).toMatchObject({ user: { activeRoleId: 'trainer', roleNames: ['Trainer'] } });
  expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN', actor: expect.objectContaining({ activeRoleId: 'trainer', activeRoleName: 'Trainer' }) }));
});

it('rejects an unassigned role before terminating any previous session', async () => {
  startSession();
  await expect(login({ ...credential, activeRoleId: 'unassigned' }, undefined, undefined, true)).rejects.toMatchObject({ statusCode: 403 });
  expect(sessions.terminatePreviousSessions).not.toHaveBeenCalled();
});

it('keeps the existing single-session confirmation after a valid role is selected', async () => {
  startSession();
  await expect(login({ ...credential, activeRoleId: 'trainer' }, undefined, undefined)).rejects.toMatchObject({ code: 'SESSION_EXISTS' });
  expect(sessions.createSession).not.toHaveBeenCalled();
});

it('uses only the active role permissions and does not inherit the assigned system role', async () => {
  startSession('supervisor');
  const principal = await buildAuthUser('user', 'session');
  expect(principal).toMatchObject({ roleIds: ['supervisor'], activeRoleIsSystem: false, permissions: { courseManagement: { create: false } } });
  expect(principal?.permissions).not.toHaveProperty('userManagement');
  expect(principal?.availableRoles).toHaveLength(3);
  expect((await request(app).get('/course').set('Authorization', 'Bearer access')).status).toBe(403);
});

it('switches in the same session, audits old and new names and rejects stale tokens and screen contexts', async () => {
  startSession(); const before = (await buildAuthUser('user', 'session'))!;
  const beforeExpiry = live.expiresAt;
  const result = await switchRole(before, 'supervisor');
  expect(result.user.sessionId).toBe('session');
  expect(result.user.activeRoleId).toBe('supervisor');
  expect(result.user.roleContext).not.toBe('initial-context');
  expect(live.expiresAt).toEqual(beforeExpiry);
  expect(sessions.createSession).not.toHaveBeenCalled();
  expect(db.auditTrail.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ROLE_SWITCH', activeRoleName: 'Trainer', oldValue: { activeRoleName: 'Trainer' }, newValue: { activeRoleName: 'Supervisor' } }) });
  jest.mocked(verifyAccessToken).mockReturnValue({ sub: 'user', sid: 'session', rid: 'trainer', rc: 'initial-context' });
  expect((await request(app).get('/principal').set('Authorization', 'Bearer stale')).body.error.code).toBe('ROLE_CHANGED');
  jest.mocked(verifyAccessToken).mockReturnValue({ sub: 'user', sid: 'session', rid: live.activeRoleId, rc: live.roleContext });
  expect((await request(app).get('/principal').set('Authorization', 'Bearer fresh').set('X-Role-Context', 'initial-context')).status).toBe(409);
});

it('prevents concurrent switches using an outdated session context', async () => {
  startSession(); const before = (await buildAuthUser('user', 'session'))!;
  await switchRole(before, 'supervisor');
  await expect(switchRole(before, 'system')).rejects.toMatchObject({ code: 'ROLE_CHANGED' });
  expect(live.activeRoleId).toBe('supervisor');
  expect(db.auditTrail.create).toHaveBeenCalledTimes(1);
});

it('does not allow a locked session to switch roles', async () => {
  startSession(); const principal = (await buildAuthUser('user', 'session'))!;
  jest.mocked(isLocked).mockResolvedValue(true);
  await expect(switchRole(principal, 'supervisor')).rejects.toMatchObject({ statusCode: 423 });
  expect(db.userSession.updateMany).not.toHaveBeenCalled();
});

it('refreshes access using the selected role after a switch without extending the session', async () => {
  startSession(); const expiry = live.expiresAt;
  await switchRole((await buildAuthUser('user', 'session'))!, 'supervisor');
  const result = await refresh('refresh');
  expect(result.roleContext).toBe(live.roleContext);
  expect(signAccessToken).toHaveBeenLastCalledWith('user', 'session', expect.objectContaining({ activeRoleId: 'supervisor', permissions: roles[1].permissions }));
  expect(live.expiresAt).toEqual(expiry);
});

it.each(['unassigned', 'inactive', 'deleted'])('rejects a role-switch target that is %s', async (reason) => {
  startSession(); const current = (await buildAuthUser('user', 'session'))!;
  if (reason === 'unassigned') memberships.find((link) => link.roleId === 'supervisor').isActive = false;
  if (reason === 'inactive') roles[1].isActive = false;
  if (reason === 'deleted') roles[1].isDeleted = true;
  await expect(switchRole(current, 'supervisor')).rejects.toMatchObject({ statusCode: 403 });
  expect(db.userSession.updateMany).not.toHaveBeenCalled();
});

it.each(['assignment removed', 'role deactivated', 'role deleted'])('fails closed when the active role is unavailable: %s', async (reason) => {
  startSession();
  if (reason === 'assignment removed') memberships[0].isActive = false;
  if (reason === 'role deactivated') roles[0].isActive = false;
  if (reason === 'role deleted') roles[0].isDeleted = true;
  expect(await buildAuthUser('user', 'session')).toBeNull();
  await expect(refresh('refresh')).rejects.toMatchObject({ statusCode: 401 });
});

it('does not reinterpret legacy combined-role sessions as an arbitrary role', async () => {
  startSession(); delete live.activeRoleId; delete live.roleContext;
  expect(await buildAuthUser('user', 'session')).toBeNull();
});

it('rechecks video access after role switches', async () => {
  startSession(); const ticket = createVideoTicket('user', 'session', 'material', live.roleContext);
  const getVideo = () => request(app).get('/video/material').set('Cookie', `${videoCookieName('material')}=${ticket}`);
  expect((await getVideo()).status).toBe(200);
  await switchRole((await buildAuthUser('user', 'session'))!, 'supervisor');
  expect((await getVideo()).status).toBe(401);
});

it('attaches the active role snapshot to the request audit context', async () => {
  startSession();
  const response = await request(app).get('/principal').set('Authorization', 'Bearer access');
  expect(response.body.auditActor).toMatchObject({ activeRoleId: 'trainer', activeRoleName: 'Trainer' });
  // A later rename changes the next request, not the earlier snapshot.
  roles[0].roleName = 'Course Author';
  expect((await buildAuthUser('user', 'session'))?.activeRoleName).toBe('Course Author');
  expect(response.body.auditActor.activeRoleName).toBe('Trainer');
});
