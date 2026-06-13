import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { signFromRequest } from './eSignature.service';
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

/** Order-independent JSON comparison so a reordered-but-identical matrix is a no-op. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
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
    // CR-4: search matches the role name OR its description.
    ...(q.search
      ? {
          OR: [
            { roleName: { contains: q.search, mode: 'insensitive' } },
            { description: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
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

export async function createRole(input: CreateRoleInput, req: Request) {
  // CR-6: creating a role is a controlled action — two-component e-signature.
  await signFromRequest(req, 'Role', 'new', 'Approved');
  return prisma.role.create({
    data: {
      roleName: input.roleName,
      description: input.description ?? null,
      permissions: normalizePermissions(input.permissions),
      createdBy: req.user!.id,
    },
  });
}

export async function updateRole(id: string, input: UpdateRoleInput, req: Request) {
  const existing = await getRole(id);

  // No-op rule: if nothing actually changes, do NOT sign, write, or audit.
  const normalizedNew = input.permissions !== undefined ? normalizePermissions(input.permissions) : undefined;
  const permsChanged = normalizedNew !== undefined && stableStringify(normalizedNew) !== stableStringify(existing.permissions);
  const descChanged = input.description !== undefined && (input.description ?? null) !== (existing.description ?? null);
  const activeChanged = input.isActive !== undefined && input.isActive !== existing.isActive;
  if (!permsChanged && !descChanged && !activeChanged) {
    return existing;
  }

  // CR-6: role/permission edits require an electronic signature (username +
  // signature password + confirm + reason), captured here before the write.
  await signFromRequest(req, 'Role', id, 'Approved');
  if (permsChanged) {
    auditContext.setActionOverride('PERMISSION_CHANGE');
  }
  return prisma.role.update({
    where: { id },
    data: {
      ...(descChanged ? { description: input.description } : {}),
      ...(permsChanged ? { permissions: normalizedNew } : {}),
      ...(activeChanged ? { isActive: input.isActive } : {}),
    },
  });
}

/** Soft-delete (deactivate) — the only kind of delete for roles. CR-6: e-signed. */
export async function deactivateRole(id: string, req: Request) {
  await getRole(id);
  await signFromRequest(req, 'Role', id, 'Approved');
  return prisma.role.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}
