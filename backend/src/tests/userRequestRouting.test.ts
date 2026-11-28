import type { Request } from 'express';
import { deriveLegacyFlags, type PermissionMatrix } from '@izlearn/shared';
import { prisma } from '../config/prisma';
import { notifyUserRequestSubmitted } from '../services/notification.service';
import { eligibleUserRequestApprovers } from '../services/userRequestEligibility.service';
import { checkRequestDecision, createUserRequest, decideRequest, resetPassword } from '../services/user.service';
import { getPasswordPolicy } from '../services/systemConfig.service';
import { canGrantRolePermissions } from '../utils/roleGrant';
import { mergePermissions } from '../utils/permissions';
import { queueEmail } from '../services/email.service';
import { signFromRequest } from '../services/eSignature.service';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { logger } from '../config/logger';

jest.mock('../config/prisma', () => ({ prisma: {
  role: { findMany: jest.fn(), count: jest.fn() }, userRole: { findMany: jest.fn(), create: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  passwordHistory: { create: jest.fn() },
  userCreationRequest: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
} }));
jest.mock('../services/email.service', () => ({ queueEmail: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/systemConfig.service', () => ({ getConfig: jest.fn().mockResolvedValue('Company'), getBool: jest.fn().mockResolvedValue(false), getPasswordPolicy: jest.fn().mockResolvedValue({ minLength: 8 }) }));
jest.mock('../services/notificationSetting.service', () => ({ getSetting: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/eSignature.service', () => ({ signFromRequest: jest.fn().mockResolvedValue('signature') }));
jest.mock('../services/assignment.service', () => ({ assignRequiredCoursesToUser: jest.fn().mockResolvedValue(0) }));
jest.mock('../utils/passwordUtils', () => ({ hashPassword: jest.fn().mockResolvedValue('hashed-password') }));
jest.mock('../utils/excelExporter', () => ({}));
jest.mock('../middlewares/auditTrail.middleware', () => ({ auditedTransaction: jest.fn() }));
jest.mock('../config/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));

const db = prisma as any;
const matrix = (modules: Record<string, Record<string, boolean>>) => Object.fromEntries(
  Object.entries(modules).map(([key, flags]) => [key, { ...flags, ...deriveLegacyFlags(flags) }]),
) as PermissionMatrix;
let roles: any[]; let users: any[]; let links: any[]; let pending: any;
function permissions(userId: string) {
  return mergePermissions(links.filter((link) => link.userId === userId && link.isActive)
    .map((link) => roles.find((role) => role.id === link.roleId && role.isActive && !role.isDeleted)?.permissions));
}
const actor = (userId: string) => ({ user: { id: userId, permissions: permissions(userId) } }) as Request;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getPasswordPolicy).mockResolvedValue({ minLength: 8, expiryDays: 90, historyCount: 5 });
  roles = [
    { id: 'requested-role', permissions: matrix({ reports: { view: true, export: true } }) },
    { id: 'approval', permissions: matrix({ userRequests: { approve: true } }) },
    { id: 'report-authority', permissions: matrix({ reports: { view: true, export: true } }) },
    { id: 'combined-authority', permissions: matrix({ userRequests: { approve: true }, reports: { view: true, export: true } }) },
    { id: 'legacy-manager', permissions: matrix({ userManagement: { approve: true }, reports: { view: true, export: true } }) },
    { id: 'inactive-approval', permissions: matrix({ userRequests: { approve: true } }), isActive: false },
    { id: 'deleted-approval', permissions: matrix({ userRequests: { approve: true } }), isDeleted: true },
  ].map((role) => ({ isActive: true, isDeleted: false, ...role }));
  users = ['eligible', 'split-authority', 'lower', 'legacy', 'inactive-user', 'deleted-user', 'inactive-link', 'inactive-role', 'deleted-role', 'no-email', 'requester']
    .map((id) => ({ id, fullName: id === 'requester' ? 'Priya Shah' : id, windowsUsername: id, email: `${id}@example.test`, isActive: id !== 'inactive-user', isDeleted: id === 'deleted-user' }));
  users.find((user) => user.id === 'no-email').email = '';
  links = [
    ...['eligible', 'inactive-user', 'deleted-user', 'no-email'].flatMap((userId) => ['approval', 'report-authority'].map((roleId) => ({ userId, roleId }))),
    ...['eligible', 'inactive-user', 'deleted-user', 'no-email'].map((userId) => ({ userId, roleId: 'combined-authority' })),
    ...['approval', 'report-authority'].map((roleId) => ({ userId: 'split-authority', roleId })),
    { userId: 'eligible', roleId: 'approval' }, // Duplicate links must not duplicate recipients.
    { userId: 'lower', roleId: 'approval' }, { userId: 'legacy', roleId: 'legacy-manager' },
    { userId: 'inactive-link', roleId: 'approval', isActive: false }, { userId: 'inactive-link', roleId: 'report-authority' },
    { userId: 'inactive-role', roleId: 'inactive-approval' }, { userId: 'inactive-role', roleId: 'report-authority' },
    { userId: 'deleted-role', roleId: 'deleted-approval' }, { userId: 'deleted-role', roleId: 'report-authority' },
  ].map((link) => ({ isActive: true, ...link }));
  pending = { id: 'request', status: 'PENDING_APPROVAL', roleIds: ['requested-role'], createdBy: 'requester', fullName: 'New Employee',
    employeeId: 'EMP-20', windowsUsername: 'new.employee', email: 'new.employee@example.test', departmentId: 'department', locationId: 'location' };
  db.role.findMany.mockImplementation(async ({ where }: any) => roles.filter((role) =>
    (!where.id || where.id.in.includes(role.id)) && (where.isActive === undefined || role.isActive === where.isActive) &&
    (where.isDeleted === undefined || role.isDeleted === where.isDeleted)));
  db.userRole.findMany.mockImplementation(async ({ where }: any) => where.userId ? [] : links.filter((link) => link.isActive && where.roleId.in.includes(link.roleId)));
  db.userRole.create.mockResolvedValue({});
  db.user.findMany.mockImplementation(async ({ where }: any) => users.filter((user) => where.id.in.includes(user.id) && user.isActive && !user.isDeleted));
  db.user.findUnique.mockImplementation(async ({ where }: any) => users.find((user) => user.id === where.id) ?? null);
  db.user.findFirst.mockImplementation(async ({ where }: any) => users.find((user) => (where.id ? user.id === where.id : user.windowsUsername === where.windowsUsername) && !user.isDeleted) ?? null);
  db.user.create.mockImplementation(async ({ data }: any) => { const user = { id: 'created-user', isActive: true, isDeleted: false, ...data }; users.push(user); return user; });
  db.user.update.mockImplementation(async ({ where, data }: any) => Object.assign(users.find((user) => user.id === where.id), data));
  db.userCreationRequest.findFirst.mockImplementation(async ({ where }: any) => where.id === pending.id ? { ...pending } : null);
  db.userCreationRequest.create.mockImplementation(async ({ data }: any) => ({ id: 'new-request', ...data }));
  db.userCreationRequest.update.mockImplementation(async ({ data }: any) => { Object.assign(pending, data); return { ...pending }; });
  (auditedTransaction as jest.Mock).mockImplementation(async (_prisma, work) => (await work(db)).result);
});

it('routes submission mail only when one selectable role can approve, without combining roles or duplicating recipients', async () => {
  expect((await eligibleUserRequestApprovers(['requested-role'])).map((user) => user.id)).toEqual(['eligible']);
  await notifyUserRequestSubmitted('New Employee', 'EMP-20', 'requester', ['requested-role']);
  expect(queueEmail).toHaveBeenCalledTimes(1);
  expect(queueEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'eligible@example.test', type: 'userRequestSubmitted' }));
  const mail = jest.mocked(queueEmail).mock.calls[0][0];
  expect(mail.html).toContain('Priya Shah');
  expect(mail.html).not.toContain('>requester<');
});

it('uses the requested roles saved on a newly created request when generating its notification', async () => {
  await createUserRequest({ ...pending, userType: 'INTERNAL', windowsUsername: 'fresh.employee' } as any, 'requester');
  expect(queueEmail).toHaveBeenCalledTimes(1);
  expect(jest.mocked(queueEmail).mock.calls[0][0].toEmail).toBe('eligible@example.test');
});

it.each(['APPROVE', 'REJECT'] as const)('blocks a lower-permission actor from %s before signature, writes or emails', async (decision) => {
  await expect(decideRequest('request', { decision } as any, actor('lower'))).rejects.toMatchObject({ statusCode: 403 });
  expect(signFromRequest).not.toHaveBeenCalled();
  expect(db.userCreationRequest.update).not.toHaveBeenCalled();
  expect(db.user.create).not.toHaveBeenCalled();
  expect(auditedTransaction).not.toHaveBeenCalled();
  expect(queueEmail).not.toHaveBeenCalled();
  expect(pending.status).toBe('PENDING_APPROVAL');
});

it('does not let the old User Management approval permission authorize a decision', async () => {
  await expect(decideRequest('request', { decision: 'REJECT' } as any, actor('legacy'))).rejects.toMatchObject({ statusCode: 403 });
  expect(signFromRequest).not.toHaveBeenCalled();
});

it('allows an eligible approver to reject and sends only the requester decision email', async () => {
  await decideRequest('request', { decision: 'REJECT', remarks: 'Duplicate request' } as any, actor('eligible'));
  expect(pending.status).toBe('REJECTED');
  expect(signFromRequest).toHaveBeenCalledTimes(1);
  expect(db.user.create).not.toHaveBeenCalled();
  expect(queueEmail).toHaveBeenCalledTimes(1);
  expect(queueEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'requester@example.test', type: 'userRequestDecision' }));
});

it('allows an eligible approver to approve and keeps temporary credentials out of the requester email', async () => {
  const result = await decideRequest('request', { decision: 'APPROVE' } as any, actor('eligible'));
  if (!('tempPassword' in result)) throw new Error('Expected the approved account result');
  expect(pending.status).toBe('APPROVED');
  expect(db.user.create).toHaveBeenCalledTimes(1);
  expect(signFromRequest).toHaveBeenCalledTimes(1);
  expect(queueEmail).toHaveBeenCalledTimes(2);
  const messages = jest.mocked(queueEmail).mock.calls.map(([mail]) => mail);
  expect(messages.find((mail) => mail.type === 'accountCreated')).toMatchObject({ toEmail: 'new.employee@example.test' });
  expect(messages.find((mail) => mail.type === 'userRequestDecision')!.html).not.toContain(result.tempPassword);
});

it('rechecks permissions at decision time after a previously eligible approver loses authority', async () => {
  await notifyUserRequestSubmitted('New Employee', 'EMP-20', 'requester', ['requested-role']);
  expect(queueEmail).toHaveBeenCalledTimes(1);
  roles.find((role) => role.id === 'report-authority').permissions = matrix({ reports: { view: true, export: false } });
  roles.find((role) => role.id === 'combined-authority').permissions = matrix({ userRequests: { approve: true }, reports: { view: true, export: false } });
  await expect(decideRequest('request', { decision: 'REJECT' } as any, actor('eligible'))).rejects.toMatchObject({ statusCode: 403 });
  expect(signFromRequest).not.toHaveBeenCalled();
  expect(pending.status).toBe('PENDING_APPROVAL');
});

it('allows rejection of a deactivated requested role but prevents approving it before signing', async () => {
  roles.find((role) => role.id === 'requested-role').isActive = false;
  await expect(decideRequest('request', { decision: 'APPROVE' } as any, actor('eligible'))).rejects.toMatchObject({ statusCode: 400 });
  expect(signFromRequest).not.toHaveBeenCalled();
  await decideRequest('request', { decision: 'REJECT' } as any, actor('eligible'));
  expect(pending.status).toBe('REJECTED');
});

it('fails closed for missing requested roles and records no signature or misleading notification', async () => {
  pending.roleIds = ['missing-role'];
  await notifyUserRequestSubmitted('New Employee', 'EMP-20', 'requester', pending.roleIds);
  expect(queueEmail).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalled();
  await expect(decideRequest('request', { decision: 'REJECT' } as any, actor('eligible'))).rejects.toMatchObject({ statusCode: 400 });
  expect(signFromRequest).not.toHaveBeenCalled();
});

it('uses a readable placeholder if the requester was removed, never the raw ID', async () => {
  await notifyUserRequestSubmitted('New Employee', 'EMP-20', 'removed-requester-id', ['requested-role']);
  const mail = jest.mocked(queueEmail).mock.calls[0][0];
  expect(mail.html).toContain('Unknown requester');
  expect(mail.html).not.toContain('removed-requester-id');
});

it('keeps request creation successful when recipient discovery fails', async () => {
  db.role.findMany.mockRejectedValue(new Error('Temporary lookup failure'));
  await expect(createUserRequest({ ...pending, userType: 'INTERNAL', windowsUsername: 'fresh.employee' } as any, 'requester')).resolves.toMatchObject({ id: 'new-request' });
  expect(logger.error).toHaveBeenCalled();
});

it('preserves legacy grant limits while ignoring retired permission keys', () => {
  expect(canGrantRolePermissions(undefined, [{ reports: { read: true } } as any])).toBe(false);
  expect(canGrantRolePermissions(matrix({ reports: { view: true } }), [{ reports: { read: true } } as any])).toBe(true);
  expect(canGrantRolePermissions({}, [{ bundleManagement: { write: true }, assessments: { retired_action: true } } as any])).toBe(true);
});

it('capitalizes new request names and profiles, including previously submitted lowercase names', async () => {
  const request = await createUserRequest({ ...pending, fullName: 'darshit shah', windowsUsername: 'fresh.employee' } as any, 'requester');
  expect(request.fullName).toBe('Darshit Shah');
  pending.fullName = 'darshit shah';
  const result = await decideRequest('request', { decision: 'APPROVE' } as any, actor('eligible'));
  if (!('tempPassword' in result)) throw new Error('Expected an approved account');
  expect(result.tempPassword).toHaveLength(8);
  expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fullName: 'Darshit Shah', mustChangePassword: true }) }));
});

it('uses the configured minimum for first-login passwords', async () => {
  jest.mocked(getPasswordPolicy).mockResolvedValue({ minLength: 12, expiryDays: 90, historyCount: 5 });
  const result = await decideRequest('request', { decision: 'APPROVE' } as any, actor('eligible'));
  if (!('tempPassword' in result)) throw new Error('Expected an approved account');
  expect(result.tempPassword).toHaveLength(12);
});

it('uses a shorter password for resets while preserving login/signature reset and forced change', async () => {
  users.find((user) => user.id === 'requester').supervisorId = 'eligible';
  const result = await resetPassword('requester', actor('eligible'));
  expect(result.tempPassword).toHaveLength(8);
  expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    passwordHash: 'hashed-password', signaturePasswordHash: 'hashed-password', mustChangePassword: true,
  }) }));
});

it('requires selecting the system role to reset another administrator, even if that role is also assigned', async () => {
  const req = actor('eligible');
  Object.assign(req.user!, { permissions: matrix({ userManagement: { reset_password: true } }), activeRoleId: 'supervisor', activeRoleIsSystem: false, availableRoles: [{ id: 'system', name: 'Super Admin' }] });
  db.userRole.findMany.mockResolvedValue([{ roleId: 'system' }]);
  db.role.count.mockResolvedValue(1);
  await expect(resetPassword('requester', req)).rejects.toMatchObject({ statusCode: 403 });
  expect(signFromRequest).not.toHaveBeenCalled();
  expect(db.user.update).not.toHaveBeenCalled();
});

it.each(['APPROVE', 'REJECT'] as const)('denies %s preflight without signing or changing data', async (decision) => {
  await expect(checkRequestDecision('request', decision, actor('lower'))).rejects.toMatchObject({ statusCode: 403 });
  expect(signFromRequest).not.toHaveBeenCalled();
  expect(db.userCreationRequest.update).not.toHaveBeenCalled();
  expect(auditedTransaction).not.toHaveBeenCalled();
});

it.each(['APPROVE', 'REJECT'] as const)('allows eligible %s preflight without signing or changing data', async (decision) => {
  await expect(checkRequestDecision('request', decision, actor('eligible'))).resolves.toEqual({ eligible: true });
  expect(signFromRequest).not.toHaveBeenCalled();
  expect(db.userCreationRequest.update).not.toHaveBeenCalled();
  expect(queueEmail).not.toHaveBeenCalled();
});

it('rechecks authority after a successful preflight', async () => {
  await checkRequestDecision('request', 'APPROVE', actor('eligible'));
  roles.find((role) => role.id === 'report-authority').permissions = matrix({ reports: { view: true, export: false } });
  roles.find((role) => role.id === 'combined-authority').permissions = matrix({ userRequests: { approve: true }, reports: { view: true, export: false } });
  await expect(decideRequest('request', { decision: 'APPROVE' } as any, actor('eligible'))).rejects.toMatchObject({ statusCode: 403 });
  expect(signFromRequest).not.toHaveBeenCalled();
});

it('checks stale requests and inactive roles before opening a signing flow', async () => {
  pending.status = 'REJECTED';
  await expect(checkRequestDecision('request', 'REJECT', actor('eligible'))).rejects.toMatchObject({ statusCode: 409 });
  pending.status = 'PENDING_APPROVAL';
  roles.find((role) => role.id === 'requested-role').isActive = false;
  await expect(checkRequestDecision('request', 'APPROVE', actor('eligible'))).rejects.toMatchObject({ statusCode: 400 });
  await expect(checkRequestDecision('request', 'REJECT', actor('eligible'))).resolves.toEqual({ eligible: true });
});
