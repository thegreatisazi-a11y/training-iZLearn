import { prisma } from '../config/prisma';
import { auditContext } from '../utils/auditContext';
import { recordEvent } from '../services/auditTrail.service';
import { createAuditTrailMiddleware, auditedTransaction } from '../middlewares/auditTrail.middleware';
import { verifyAndSign } from '../services/eSignature.service';

jest.mock('../config/prisma', () => ({ prisma: {
  auditTrail: { create: jest.fn() },
  trainingTopic: { create: jest.fn() },
  user: { findFirst: jest.fn() },
  electronicSignature: { create: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock('../utils/passwordUtils', () => ({ comparePassword: jest.fn(async () => true) }));
const db = prisma as any;
const actor = { userId: 'user', userFullName: 'Darshit Shah', userUsername: 'darshit', sessionId: 'session', activeRoleId: 'trainer', activeRoleName: 'Trainer' };
beforeEach(() => {
  jest.clearAllMocks();
  db.$transaction.mockImplementation(async (work: any) => work(db));
  db.trainingTopic.create.mockResolvedValue({ id: 'course', title: 'SOP' });
  db.user.findFirst.mockResolvedValue({ id: 'user', windowsUsername: 'darshit', fullName: 'Darshit Shah', signaturePasswordHash: 'hash' });
  db.electronicSignature.create.mockResolvedValue({ id: 'signature' });
});

it('includes the active role in explicit events even when their actor override omits role fields', async () => {
  await auditContext.run({ actor }, () => recordEvent({ action: 'PRINT', actor: { userId: 'user', userFullName: 'Darshit Shah' } }));
  expect(db.auditTrail.create).toHaveBeenCalledWith({ data: expect.objectContaining({ activeRoleId: 'trainer', activeRoleName: 'Trainer', sessionId: 'session' }) });
});

it('does not attribute a different explicit actor to the current user role', async () => {
  await auditContext.run({ actor }, () => recordEvent({ action: 'LOGIN_FAILED', actor: { userId: 'different-user', userFullName: 'Other User' } }));
  expect(db.auditTrail.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'different-user', activeRoleId: null, activeRoleName: null }) });
});

it('captures the selected role in automatic audit writes', async () => {
  const middleware = createAuditTrailMiddleware(prisma);
  await auditContext.run({ actor }, () => middleware({ model: 'TrainingTopic', action: 'create', args: { data: { title: 'SOP' } } } as any, jest.fn()));
  expect(db.auditTrail.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CREATE', entityType: 'TrainingTopic', activeRoleId: 'trainer', activeRoleName: 'Trainer' }) });
});

it('captures the role in business transactions and does not change an earlier name snapshot', async () => {
  await auditContext.run({ actor }, () => auditedTransaction(prisma, async () => ({ result: 'done', audits: [{ action: 'APPROVE', entityType: 'UserCreationRequest', entityId: 'request' }] })));
  const captured = db.auditTrail.create.mock.calls[0][0].data;
  await auditContext.run({ actor: { ...actor, activeRoleName: 'Course Author' } }, () => recordEvent({ action: 'PRINT' }));
  expect(captured.activeRoleName).toBe('Trainer');
  expect(db.auditTrail.create.mock.calls[1][0].data.activeRoleName).toBe('Course Author');
});

it('stores the same role on the signature and its ESIGN audit event', async () => {
  await auditContext.run({ actor }, () => verifyAndSign({ actingUserId: 'user', windowsUsername: 'darshit', signaturePassword: 'password', meaning: 'Approved', recordType: 'TrainingTopic', recordId: 'course' }));
  expect(db.electronicSignature.create).toHaveBeenCalledWith({ data: expect.objectContaining({ activeRoleId: 'trainer', activeRoleName: 'Trainer' }) });
  expect(db.auditTrail.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ESIGN', activeRoleId: 'trainer', activeRoleName: 'Trainer' }) });
});

it('does not invent role information for background jobs', async () => {
  await auditContext.runAsSystem(() => recordEvent({ action: 'BACKUP_TRIGGERED' }));
  expect(db.auditTrail.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'SYSTEM', activeRoleId: null, activeRoleName: null }) });
});
