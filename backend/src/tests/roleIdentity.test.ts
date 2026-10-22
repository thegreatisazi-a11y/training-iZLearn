import { normalizeRoleName } from '../utils/roleIdentity';

jest.mock('../config/prisma', () => ({ prisma: { role: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() } } }));
jest.mock('../services/eSignature.service', () => ({ signFromRequest: jest.fn().mockResolvedValue(undefined) }));

import { prisma } from '../config/prisma';
import { signFromRequest } from '../services/eSignature.service';
import { createRole, updateRole } from '../services/role.service';

const roles = prisma.role as jest.Mocked<typeof prisma.role>;

test('case, spaces, and underscores identify the same role label', () => {
  expect(normalizeRoleName(' SUPER_ADMIN ')).toBe('super admin');
  expect(normalizeRoleName('Super Admin')).toBe('super admin');
  expect(normalizeRoleName('Super__Admin')).toBe('super admin');
});

test('create rejects normalized duplicate before electronic signature', async () => {
  (roles.findMany as jest.Mock).mockResolvedValue([{ id: 'old', roleName: 'Super Admin' }]);
  await expect(createRole({ roleName: 'SUPER_ADMIN', permissions: {} }, {} as never)).rejects.toMatchObject({ statusCode: 409 });
  expect(signFromRequest).not.toHaveBeenCalled();
});

test('Edit cannot deactivate the protected system role', async () => {
  (roles.findFirst as jest.Mock).mockResolvedValue({ id: 'system', roleName: 'Platform Owner', isSystem: true,
    isActive: true, permissions: {}, description: null });
  await expect(updateRole('system', { isActive: false, reasonForChange: 'test' }, {} as never))
    .rejects.toMatchObject({ statusCode: 400 });
  expect(signFromRequest).not.toHaveBeenCalled();
});

test('rename rejects an underscore/case variant of another role', async () => {
  (roles.findFirst as jest.Mock).mockResolvedValue({ id: 'ordinary', roleName: 'Trainer', isSystem: false,
    isActive: true, permissions: {}, description: null });
  (roles.findMany as jest.Mock).mockResolvedValue([
    { id: 'ordinary', roleName: 'Trainer' }, { id: 'system', roleName: 'Super Admin' },
  ]);
  await expect(updateRole('ordinary', { roleName: 'SUPER_ADMIN', reasonForChange: 'test' }, {} as never))
    .rejects.toMatchObject({ statusCode: 409 });
});

test('legacy administrator name stays reserved after system-role rename', async () => {
  (roles.findMany as jest.Mock).mockResolvedValue([{ id: 'system', roleName: 'Platform Owner', isSystem: true }]);
  await expect(createRole({ roleName: 'SUPER_ADMIN', permissions: {} }, {} as never))
    .rejects.toMatchObject({ statusCode: 409 });
});
