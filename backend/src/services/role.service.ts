import { Request } from 'express';
import type { ExportTable } from '../utils/exportTable';
import { PERMISSION_CATALOG, PERMISSION_CATEGORIES } from '@izlearn/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { signFromRequest } from './eSignature.service';
import { deriveLegacyFlags } from '@izlearn/shared';
import type { CreateRoleInput, UpdateRoleInput, PaginationQuery, PermissionMatrix } from '@izlearn/shared';
import { normalizeRoleName } from '../utils/roleIdentity';

async function assertUniqueRoleName(name: string, exceptId?: string): Promise<void> {
  const key = normalizeRoleName(name);
  const roles = await prisma.role.findMany({ where: { isDeleted: false }, select: { id: true, roleName: true, isSystem: true } });
  if (key === normalizeRoleName('Super Admin') && roles.some((role) => role.isSystem && role.id !== exceptId)) {
    throw AppError.conflict('The Super Admin name is reserved for the protected system role, even after it is renamed.');
  }
  if (roles.some((role) => role.id !== exceptId && normalizeRoleName(role.roleName) === key)) {
    throw AppError.conflict('A role with this name already exists. Spaces, underscores and case are treated as equivalent.');
  }
}

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

/** Column/row data for the roles list. */
export async function buildRolesExport(q: PaginationQuery): Promise<ExportTable> {
  const { data } = await listRoles({ ...q, page: 1, pageSize: 100000 });
  const columns = [
    { header: 'Role', key: 'role' },
    { header: 'Description', key: 'description' },
    { header: 'Status', key: 'status' },
  ];
  const rows = data.map((r) => ({
    role: r.roleName,
    description: r.description ?? '',
    status: r.isActive ? 'Active' : 'Inactive',
  }));
  return { title: 'Roles & Access Control', columns, rows };
}

/**
 * Column/row data for ONE role's permission matrix.
 *
 * Lists EVERY catalog action, granted or not — a matrix showing only what is granted cannot
 * be reviewed, because "absent" and "denied" look identical. Built from PERMISSION_CATALOG
 * server-side so it can no longer drift from the print/PDF version.
 */
export async function buildRolePermissionsExport(id: string): Promise<ExportTable> {
  const role = await getRole(id);
  const matrix = (role.permissions ?? {}) as PermissionMatrix;
  const categoryLabel: Record<string, string> = Object.fromEntries(
    PERMISSION_CATEGORIES.map((c) => [c.key, c.label]),
  );
  const columns = [
    { header: 'Category', key: 'category' },
    { header: 'Module', key: 'module' },
    { header: 'Module Key', key: 'moduleKey' },
    { header: 'Action', key: 'action' },
    { header: 'Action Key', key: 'actionKey' },
    { header: 'Granted', key: 'granted' },
  ];
  const rows: Array<Record<string, unknown>> = [];
  for (const def of PERMISSION_CATALOG) {
    for (const a of def.actions) {
      rows.push({
        category: categoryLabel[def.category] ?? def.category,
        module: def.label,
        moduleKey: def.module,
        action: a.label,
        actionKey: a.key,
        granted: matrix[def.module]?.[a.key] ? 'Yes' : 'No',
      });
    }
  }
  return { title: `Role Permissions - ${role.roleName}`, columns, rows };
}

export async function getRole(id: string) {
  const role = await prisma.role.findFirst({ where: { id, isDeleted: false } });
  if (!role) throw AppError.notFound('Role not found');
  return role;
}

export async function createRole(input: CreateRoleInput, req: Request) {
  await assertUniqueRoleName(input.roleName);
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
  if (existing.isSystem && input.isActive === false) {
    throw AppError.badRequest('The built-in administrator role cannot be deactivated.');
  }
  if (input.roleName !== undefined) await assertUniqueRoleName(input.roleName, id);

  // No-op rule: if nothing actually changes, do NOT sign, write, or audit.
  const normalizedNew = input.permissions !== undefined ? normalizePermissions(input.permissions) : undefined;
  const permsChanged = normalizedNew !== undefined && stableStringify(normalizedNew) !== stableStringify(existing.permissions);
  // E1: role name is now editable from the Edit dialog (controlled, e-signed).
  const nameChanged = input.roleName !== undefined && input.roleName.trim() !== existing.roleName;
  const descChanged = input.description !== undefined && (input.description ?? null) !== (existing.description ?? null);
  const activeChanged = input.isActive !== undefined && input.isActive !== existing.isActive;
  if (!permsChanged && !nameChanged && !descChanged && !activeChanged) {
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
      ...(nameChanged ? { roleName: input.roleName!.trim() } : {}),
      ...(descChanged ? { description: input.description } : {}),
      ...(permsChanged ? { permissions: normalizedNew } : {}),
      ...(activeChanged ? { isActive: input.isActive } : {}),
    },
  });
}

/** Soft-delete (deactivate) — the only kind of delete for roles. CR-6: e-signed. */
export async function deactivateRole(id: string, req: Request) {
  const role = await getRole(id);
  // The built-in administrator role is permanent. Without it there would be no role the
  // privilege-escalation guards could anchor on, and an organisation that rebuilt its
  // roles from scratch could lock itself out of its own administration. It may still be
  // renamed and its permissions edited — only removal is refused.
  if (role.isSystem) {
    throw AppError.badRequest(
      'The built-in administrator role cannot be deleted or deactivated. You may rename it or edit its permissions instead.',
    );
  }
  await signFromRequest(req, 'Role', id, 'Approved');
  return prisma.role.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}
