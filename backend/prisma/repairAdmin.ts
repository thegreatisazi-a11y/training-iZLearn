import { prisma } from '../src/config/prisma';
import { auditContext } from '../src/utils/auditContext';

/** Explicit repair of the identifiable first administrator, never arbitrary users. */
export async function repairBootstrapAdmin(id: string, username: string): Promise<void> {
  if (!id) throw new Error('An exact audited user ID is required.');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.windowsUsername !== username || user.employeeId !== 'EMP-0001' ||
      user.createdBy !== 'SYSTEM' || user.isDeleted || !user.isActive) {
    throw new Error('Target is not the active SYSTEM-created bootstrap account. No change was made.');
  }
  const systemRoles = await prisma.role.findMany({ where: { isSystem: true, isDeleted: false, isActive: true } });
  if (systemRoles.length !== 1) throw new Error('Expected one active system role. No change was made.');
  const links = await prisma.userRole.findMany({ where: { userId: id } });
  if (links.some((link) => link.isActive)) throw new Error('Target already has an active role. Review manually; no change was made.');
  if (links.some((link) => link.roleId === systemRoles[0].id)) {
    throw new Error('An inactive system-role link already exists. Review manually; no change was made.');
  }
  await auditContext.runAsSystem(() => prisma.userRole.create({ data: { userId: id, roleId: systemRoles[0].id, assignedBy: 'SYSTEM' } }));
}
