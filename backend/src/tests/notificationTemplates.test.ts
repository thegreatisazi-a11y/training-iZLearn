import { listSettings } from '../services/notificationSetting.service';
import { notifyUserRequestDecision } from '../services/notification.service';
import { prisma } from '../config/prisma';
import { queueEmail } from '../services/email.service';
import { renderEmail } from '../utils/emailTemplates';

jest.mock('../config/prisma', () => ({ prisma: {
  notificationSetting: { findMany: jest.fn(), findUnique: jest.fn() },
  user: { findFirst: jest.fn(), findUnique: jest.fn() },
} }));
jest.mock('../services/systemConfig.service', () => ({ getConfig: jest.fn().mockResolvedValue('Test Organisation') }));
jest.mock('../services/email.service', () => ({ queueEmail: jest.fn() }));

describe('notification templates and account delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(prisma.notificationSetting.findMany).mockResolvedValue([]);
    jest.mocked(prisma.notificationSetting.findUnique).mockResolvedValue(null);
    (prisma.user.findFirst as jest.Mock).mockImplementation(async (args: any) => ({
      id: args.where.id, fullName: args.where.id, email: `${args.where.id}@example.test`,
    }) as any);
    jest.mocked(prisma.user.findUnique).mockResolvedValue({ windowsUsername: 'new.employee' } as never);
  });

  it('provides an editable built-in body for every notification and preserves saved overrides', async () => {
    jest.mocked(prisma.notificationSetting.findMany).mockResolvedValue([
      { emailType: 'accountCreated', subject: 'Custom welcome', bodyHtml: '<p>Saved {{username}}</p>', enabled: false },
    ] as never);
    const rows = await listSettings();
    expect(rows.every((row) => row.defaultBodyHtml.length > 0 && !row.defaultBodyHtml.includes('<html>'))).toBe(true);
    expect(rows.find((r) => r.type === 'accountCreated')).toMatchObject({
      subject: 'Custom welcome', bodyHtml: '<p>Saved {{username}}</p>', enabled: false,
      defaultBodyHtml: expect.stringContaining('{{username}}'),
    });
  });

  it('sends credentials only to the new user, with a separate decision for the requester', async () => {
    await notifyUserRequestDecision('employee', 'employee@example.test', 'APPROVE', 'Approved', 'requester', 'temporary-test-password');
    expect(queueEmail).toHaveBeenCalledTimes(2);
    expect(queueEmail).toHaveBeenCalledWith(expect.objectContaining({
      toEmail: 'employee@example.test', type: 'accountCreated', html: expect.stringContaining('new.employee'),
    }));
    const requester = jest.mocked(queueEmail).mock.calls.find(([r]) => r.type === 'userRequestDecision')![0];
    expect(requester.toEmail).toBe('requester@example.test');
    expect(requester.html).not.toContain('temporary-test-password');
  });

  it.each(['accountCreated', 'userRequestDecision'])('disabling %s leaves the other notification enabled', async (disabled) => {
    (prisma.notificationSetting.findUnique as jest.Mock).mockImplementation(async (args: any) =>
      args.where.emailType === disabled ? { enabled: false } : null as any);
    await notifyUserRequestDecision('employee', 'employee@example.test', 'APPROVE', undefined, 'requester', 'temporary-test-password');
    expect(queueEmail).toHaveBeenCalledTimes(1);
    expect(jest.mocked(queueEmail).mock.calls[0][0].type).not.toBe(disabled);
  });

  it('does not send an account-created email on rejection', async () => {
    await notifyUserRequestDecision(null, 'employee@example.test', 'REJECT', 'Declined', 'requester');
    expect(queueEmail).toHaveBeenCalledTimes(1);
    expect(jest.mocked(queueEmail).mock.calls[0][0]).toMatchObject({ type: 'userRequestDecision', toEmail: 'requester@example.test' });
  });

  it('renders welcome credentials safely', () => {
    const result = renderEmail('accountCreated', 'Company', { username: '<employee>', tempPassword: 'a&b' });
    expect(result.html).toContain('&lt;employee&gt;');
    expect(result.html).toContain('a&amp;b');
  });
});
