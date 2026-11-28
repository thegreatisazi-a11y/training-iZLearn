import { prisma } from '../config/prisma';

/** Only current assignments to active, non-deleted roles are selectable. */
export async function assignedActiveRoles(userId: string) {
  const links = await prisma.userRole.findMany({ where: { userId, isActive: true }, select: { roleId: true } });
  const ids = [...new Set(links.map((link) => link.roleId))];
  if (!ids.length) return [];
  return prisma.role.findMany({ where: { id: { in: ids }, isActive: true, isDeleted: false }, orderBy: { roleName: 'asc' } });
}
