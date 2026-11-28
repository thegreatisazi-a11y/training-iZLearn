import type { PrismaClient } from '@prisma/client';
import { clearBootstrapEmployeeId } from '../../prisma/builtInAdmin';

let marker: unknown;
let account: any;
let tx: any;
let prisma: PrismaClient;
beforeEach(() => {
  marker = null;
  account = { id: 'bootstrap', fullName: 'Renamed Administrator', windowsUsername: 'renamed.admin', createdBy: 'SYSTEM', employeeId: 'EMP-0001', isDeleted: false };
  tx = {
    systemConfig: { findUnique: jest.fn(async () => marker), create: jest.fn(async () => { marker = { value: 'done' }; }) },
    role: { findMany: jest.fn().mockResolvedValue([{ id: 'system-role' }]) },
    userRole: { findMany: jest.fn().mockResolvedValue([{ userId: 'bootstrap' }]) },
    user: {
      findFirst: jest.fn(async ({ where }) => account && where.id.in.includes(account.id) && account.createdBy === where.createdBy && account.employeeId === where.employeeId && !account.isDeleted ? { ...account } : null),
      update: jest.fn(async ({ data }) => Object.assign(account, data)),
    },
    auditTrail: { create: jest.fn() },
  };
  prisma = { $transaction: jest.fn(async (work) => work(tx)) } as unknown as PrismaClient;
});

it('clears only the built-in placeholder and records the change without changing credentials', async () => {
  await clearBootstrapEmployeeId(prisma);
  expect(tx.role.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isSystem: true, isDeleted: false } }));
  expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'bootstrap' }, data: { employeeId: '' } });
  expect(account.windowsUsername).toBe('renamed.admin');
  expect(tx.auditTrail.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    entityId: 'bootstrap', oldValue: { employeeId: 'EMP-0001' }, newValue: { employeeId: '' },
  }) });
});

it('does not clear a real employee ID, even on a system-role holder', async () => {
  account.employeeId = 'EMP-1234';
  await clearBootstrapEmployeeId(prisma);
  expect(tx.user.update).not.toHaveBeenCalled();
});

it('does not clear the placeholder on an ordinary administrator created by a person', async () => {
  account.createdBy = 'another-admin';
  await clearBootstrapEmployeeId(prisma);
  expect(tx.user.update).not.toHaveBeenCalled();
});

it('does not select an account without a protected role assignment', async () => {
  tx.userRole.findMany.mockResolvedValue([]);
  await clearBootstrapEmployeeId(prisma);
  expect(tx.user.update).not.toHaveBeenCalled();
});

it('runs only once and leaves later administrator decisions intact', async () => {
  await clearBootstrapEmployeeId(prisma);
  account.employeeId = 'NEW-ID';
  await clearBootstrapEmployeeId(prisma);
  expect(tx.user.update).toHaveBeenCalledTimes(1);
  expect(account.employeeId).toBe('NEW-ID');
});

it('does not record completion if clearing the ID fails', async () => {
  tx.user.update.mockRejectedValue(new Error('Unique ID conflict'));
  await expect(clearBootstrapEmployeeId(prisma)).rejects.toThrow('Unique ID conflict');
  expect(tx.systemConfig.create).not.toHaveBeenCalled();
});
