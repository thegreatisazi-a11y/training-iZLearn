import { prisma } from '../config/prisma';
import { repairBootstrapAdmin } from '../../prisma/repairAdmin';

jest.mock('../config/prisma', () => ({ prisma: {
  user: { findUnique: jest.fn() }, role: { findMany: jest.fn() }, userRole: { findMany: jest.fn(), create: jest.fn() },
} }));
const db = prisma as any;
const admin = { id: 'bootstrap', windowsUsername: 'admin', employeeId: '', createdBy: 'SYSTEM', isActive: true, isDeleted: false };
beforeEach(() => {
  jest.clearAllMocks(); db.user.findUnique.mockResolvedValue(admin);
  db.role.findMany.mockResolvedValue([{ id: 'system-role', roleName: 'Platform Owner' }]);
  db.userRole.findMany.mockResolvedValue([]); db.userRole.create.mockResolvedValue({});
});

it.each(['', 'EMP-0001'])('can explicitly repair the bootstrap account with employee ID %j', async (employeeId) => {
  db.user.findUnique.mockResolvedValue({ ...admin, employeeId });
  await repairBootstrapAdmin('bootstrap', 'admin');
  expect(db.userRole.create).toHaveBeenCalledWith({ data: { userId: 'bootstrap', roleId: 'system-role', assignedBy: 'SYSTEM' } });
});

it.each([
  { employeeId: 'EMP-1234' }, { createdBy: 'another-user' }, { windowsUsername: 'other' }, { isActive: false },
])('continues refusing unrelated or inactive accounts: %j', async (change) => {
  db.user.findUnique.mockResolvedValue({ ...admin, ...change });
  await expect(repairBootstrapAdmin('bootstrap', 'admin')).rejects.toThrow('not the active SYSTEM-created bootstrap account');
  expect(db.userRole.create).not.toHaveBeenCalled();
});
