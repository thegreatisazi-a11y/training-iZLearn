import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { deriveLegacyFlags } from '@izlearn/shared';
import type { CreateRoleInput, UpdateRoleInput, PaginationQuery, PermissionMatrix } from '@izlearn/shared';

/**
 * Persist both the 10 granular verbs AND the derived legacy flags (read/write/
 * approve/print/export) for every module, so existing route guards that check the
 * legacy keys keep working while the UI manages the granular verbs.
 */
function normalizePermissions(permissions: PermissionMatrix): Prisma.InputJsonValue {
  const out: Record<string, Record<string, boolean>> = {};
  for (const [mod, flags] of Object.entries(permissions ?? {})) {
    const f = (flags ?? {}) as Record<string, boolean>;
    out[mod] = { ...f, ...deriveLegacyFlags(f) };
  }
  return out as Prisma.InputJsonValue;
}

/**
 * Role management (Module 3) — RBAC roles + permission matrix. Soft-delete only;
 * seeded/system roles can never be hard-deleted, only deactivated. Plain writes
 * are captured by the Prisma audit middleware; permission changes are flagged as
 * PERMISSION_CHANGE.
 */
export async function listRoles(q: PaginationQuery) {
  const where: Prisma.RoleWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.search ? { roleName: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.role.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'roleName']: q.sortDir },
    }),
    prisma.role.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getRole(id: string) {
  const role = await prisma.role.findFirst({ where: { id, isDeleted: false } });
  if (!role) throw AppError.notFound('Role not found');
  return role;
}

export async function createRole(input: CreateRoleInput, createdBy: string) {
  return prisma.role.create({
    data: {
      roleName: input.roleName,
      description: input.description ?? null,
      permissions: normalizePermissions(input.permissions),
      createdBy,
    },
  });
}

export async function updateRole(id: string, input: UpdateRoleInput) {
  await getRole(id);
  if (input.permissions !== undefined) {
    auditContext.setActionOverride('PERMISSION_CHANGE');
  }
  return prisma.role.update({
    where: { id },
    data: {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.permissions !== undefined ? { permissions: normalizePermissions(input.permissions) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

/** Soft-delete (deactivate) — the only kind of delete for roles. */
export async function deactivateRole(id: string) {
  await getRole(id);
  return prisma.role.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}
