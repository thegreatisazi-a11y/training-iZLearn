import type { PrismaClient } from '@prisma/client';

const marker = 'migration.bootstrap_admin_no_employee_id_v1';

/** Remove only the bootstrap account's placeholder, never an employee's real ID. */
export async function clearBootstrapEmployeeId(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (await tx.systemConfig.findUnique({ where: { key: marker } })) return;
    const roles = await tx.role.findMany({ where: { isSystem: true, isDeleted: false }, select: { id: true } });
    const links = await tx.userRole.findMany({
      where: { roleId: { in: roles.map((role) => role.id) }, isActive: true }, select: { userId: true },
    });
    const admin = await tx.user.findFirst({ where: {
      id: { in: links.map((link) => link.userId) }, createdBy: 'SYSTEM', employeeId: 'EMP-0001', isDeleted: false,
    } });
    if (admin) {
      // The required unique string remains empty for this one non-employee account.
      await tx.user.update({ where: { id: admin.id }, data: { employeeId: '' } });
      await tx.auditTrail.create({ data: {
        userId: 'SYSTEM', userFullName: 'System', action: 'UPDATE', entityType: 'User', entityId: admin.id,
        oldValue: { employeeId: admin.employeeId }, newValue: { employeeId: '' },
        reasonForChange: 'Remove the placeholder employee ID from the built-in administrator account',
      } });
    }
    await tx.systemConfig.create({ data: {
      key: marker, value: 'done', updatedBy: 'SYSTEM',
      description: 'Removed the bootstrap administrator placeholder employee ID',
    } });
  });
}
