import { prisma } from '../config/prisma';
import { clearLock } from '../config/redis';
import { verifyRefreshToken, signAccessToken } from '../utils/jwtUtils';
import { comparePassword } from '../utils/passwordUtils';
import { auditContext } from '../utils/auditContext';
import { getAuthPolicy } from '../services/systemConfig.service';
import { isSessionActive } from '../services/session.service';
import * as ldap from '../services/ldap.service';
import { unlock } from '../services/auth.service';

jest.mock('../config/prisma', () => ({ prisma: { user: { findFirst: jest.fn(), update: jest.fn() } } }));
jest.mock('../config/redis', () => ({ clearLock: jest.fn() }));
jest.mock('../utils/jwtUtils', () => ({ verifyRefreshToken: jest.fn(), signAccessToken: jest.fn() }));
jest.mock('../utils/passwordUtils', () => ({ comparePassword: jest.fn() }));
jest.mock('../utils/auditContext', () => ({
  auditContext: { setActor: jest.fn(), runWithoutAudit: jest.fn((work: () => unknown) => work()) },
}));
jest.mock('../services/systemConfig.service', () => ({ getAuthPolicy: jest.fn() }));
jest.mock('../services/session.service', () => ({ isSessionActive: jest.fn() }));
jest.mock('../services/ldap.service', () => ({ isEnabled: jest.fn(), authenticate: jest.fn() }));
jest.mock('../services/auditTrail.service', () => ({ recordEvent: jest.fn() }));
jest.mock('../middlewares/auth.middleware', () => ({ buildAuthUser: jest.fn() }));
jest.mock('../services/notification.service', () => ({ notifySessionTerminated: jest.fn() }));

const user = {
  id: 'user-1',
  windowsUsername: 'jdoe',
  fullName: 'Jane Doe',
  passwordHash: 'hash',
  failedLoginAttempts: 0,
  lockedUntil: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(verifyRefreshToken).mockReturnValue({ sub: 'user-1', sid: 'session-1' } as ReturnType<typeof verifyRefreshToken>);
  jest.mocked(isSessionActive).mockResolvedValue(true);
  jest.mocked(prisma.user.findFirst).mockResolvedValue(user as never);
  jest.mocked(prisma.user.update).mockResolvedValue(user as never);
  jest.mocked(ldap.isEnabled).mockResolvedValue(false);
  jest.mocked(comparePassword).mockResolvedValue(true);
  jest.mocked(signAccessToken).mockReturnValue('new-access-token');
  jest.mocked(getAuthPolicy).mockResolvedValue({ maxFailedAttempts: 3, lockoutMinutes: 15 } as never);
  jest.mocked(auditContext.runWithoutAudit).mockImplementation((work) => work());
});

describe('unlock an existing session', () => {
  it('verifies the password and returns a new access token without creating a session', async () => {
    await expect(unlock('refresh-token', 'JDOE', 'correct-password')).resolves.toEqual({ accessToken: 'new-access-token' });
    expect(isSessionActive).toHaveBeenCalledWith('user-1', 'session-1');
    expect(comparePassword).toHaveBeenCalledWith('correct-password', 'hash');
    expect(clearLock).toHaveBeenCalledWith('user-1', 'session-1');
    expect(signAccessToken).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('requires full login when the refresh token has expired', async () => {
    jest.mocked(verifyRefreshToken).mockImplementation(() => { throw new Error('expired'); });
    await expect(unlock('expired-token', 'jdoe', 'password')).rejects.toMatchObject({ statusCode: 401, code: 'SESSION_EXPIRED' });
    expect(clearLock).not.toHaveBeenCalled();
  });

  it('requires full login when the session has ended', async () => {
    jest.mocked(isSessionActive).mockResolvedValue(false);
    await expect(unlock('refresh-token', 'jdoe', 'password')).rejects.toMatchObject({ statusCode: 401, code: 'SESSION_EXPIRED' });
    expect(comparePassword).not.toHaveBeenCalled();
  });

  it('rejects credentials for a different username', async () => {
    await expect(unlock('refresh-token', 'other-user', 'password')).rejects.toMatchObject({ statusCode: 401 });
    expect(comparePassword).not.toHaveBeenCalled();
    expect(clearLock).not.toHaveBeenCalled();
  });

  it('applies the account lockout policy to a wrong password', async () => {
    jest.mocked(prisma.user.findFirst).mockResolvedValue({ ...user, failedLoginAttempts: 2 } as never);
    jest.mocked(comparePassword).mockResolvedValue(false);
    await expect(unlock('refresh-token', 'jdoe', 'wrong-password')).rejects.toMatchObject({ statusCode: 401 });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginAttempts: 0, lockedUntil: expect.any(Date) },
    });
    expect(clearLock).not.toHaveBeenCalled();
  });

  it('uses directory authentication when LDAP is enabled', async () => {
    jest.mocked(ldap.isEnabled).mockResolvedValue(true);
    jest.mocked(ldap.authenticate).mockResolvedValue(true);
    await expect(unlock('refresh-token', 'jdoe', 'directory-password')).resolves.toEqual({ accessToken: 'new-access-token' });
    expect(ldap.authenticate).toHaveBeenCalledWith('jdoe', 'directory-password');
    expect(comparePassword).not.toHaveBeenCalled();
  });
});
