import type { PermissionMatrix } from '@izlearn/shared';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { canDecideUserRequest } from '../utils/roleGrant';

async function requestedPermissions(roleIds: string[]): Promise<PermissionMatrix[] | null> {
  const ids = [...new Set(roleIds.filter(Boolean))];
  if (!ids.length) return null;
  // Include inactive/soft-deleted roles for scope comparison so an eligible approver
  // can still reject a stale request. Approval separately requires active roles.
  const roles = await prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true, permissions: true } });
  if (roles.length !== ids.length) return null;
  return roles.map((role) => role.permissions as PermissionMatrix);
}

export async function assertCanDecideUserRequest(actorPermissions: PermissionMatrix | undefined, roleIds: string[]) {
  const permissions = await requestedPermissions(roleIds);
  if (!permissions) throw AppError.badRequest('The request contains missing or invalid roles. Ask a system administrator to review it.');
  if (!canDecideUserRequest(actorPermissions, permissions)) {
    throw AppError.forbidden('You cannot approve or reject this request with your active role: approval permission is required and the requested roles cannot carry permissions beyond your active role.');
  }
}

export async function eligibleUserRequestApprovers(roleIds: string[]) {
  const target = await requestedPermissions(roleIds);
  if (!target) return [];
  const roles = await prisma.role.findMany({
    where: { isActive: true, isDeleted: false }, select: { id: true, permissions: true },
  });
  if (!roles.length) return [];
  const roleMap = new Map(roles.map((role) => [role.id, role.permissions as PermissionMatrix]));
  const memberships = await prisma.userRole.findMany({
    where: { roleId: { in: roles.map((role) => role.id) }, isActive: true },
    select: { userId: true, roleId: true },
  });
  const byUser = new Map<string, PermissionMatrix[]>();
  for (const membership of memberships) {
    const permissions = roleMap.get(membership.roleId);
    if (!permissions) continue;
    const matrices = byUser.get(membership.userId) ?? [];
    matrices.push(permissions);
    byUser.set(membership.userId, matrices);
  }
  const ids = [...byUser].filter(([, matrices]) => matrices.some((permissions) => canDecideUserRequest(permissions, target))).map(([id]) => id);
  if (!ids.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true, isDeleted: false }, select: { id: true, fullName: true, email: true },
  });
  return users.filter((user): user is typeof user & { email: string } => !!user.email);
}
