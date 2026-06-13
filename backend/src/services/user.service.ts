import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { auditContext } from '../utils/auditContext';
import { signFromRequest } from './eSignature.service';
import { getBool } from './systemConfig.service';
import {
  notifyUserRequestSubmitted,
  notifyUserRequestDecision,
  notifyPasswordReset,
} from './notification.service';
import { hashPassword } from '../utils/passwordUtils';
import { parseExcel } from '../utils/excelExporter';
import type {
  CreateUserInput,
  UpdateUserInput,
  UserRequestDecisionInput,
  PaginationQuery,
} from '@izlearn/shared';

/**
 * User management (Module 2) — soft-delete only; plain CRUD is captured by the
 * Prisma audit middleware automatically. Privileged actions (approve / reject,
 * role change, activate / deactivate, password reset) require a two-component
 * electronic signature and set an explicit audit action override.
 */

/** Generate a throw-away temporary password that satisfies the complexity policy. */
function tempPassword(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `Iz!${rand}${Math.floor(Math.random() * 90 + 10)}A`;
}

/**
 * CR-1(c): a role may only be assigned to a user while it is active and not deleted.
 * Throws if any of the supplied roleIds is missing, inactive or soft-deleted.
 */
async function assertRolesActive(roleIds: string[]): Promise<void> {
  const ids = Array.from(new Set(roleIds.filter(Boolean)));
  if (!ids.length) return;
  const active = await prisma.role.findMany({
    where: { id: { in: ids }, isActive: true, isDeleted: false },
    select: { id: true },
  });
  if (active.length !== ids.length) {
    throw AppError.badRequest('One or more selected roles are inactive or no longer exist.');
  }
}

/** Normalise a user's functional roles to an id array (merges legacy single + array). */
function functionalRoleIds(r: { designationId?: string | null; designationIds?: unknown }): string[] {
  const arr = Array.isArray(r.designationIds) ? (r.designationIds as string[]) : [];
  const merged = [...arr];
  if (r.designationId && !merged.includes(r.designationId)) merged.unshift(r.designationId);
  return merged.filter(Boolean);
}

/** Resolve department / location / functional-role names for a set of users (UI convenience). */
async function withNames<T extends { departmentId: string; locationId: string; designationId?: string | null; designationIds?: unknown }>(rows: T[]) {
  const deptIds = Array.from(new Set(rows.map((r) => r.departmentId)));
  const locIds = Array.from(new Set(rows.map((r) => r.locationId)));
  const frIds = Array.from(new Set(rows.flatMap((r) => functionalRoleIds(r))));
  const [depts, locs, frs] = await Promise.all([
    deptIds.length ? prisma.department.findMany({ where: { id: { in: deptIds } } }) : Promise.resolve([]),
    locIds.length ? prisma.location.findMany({ where: { id: { in: locIds } } }) : Promise.resolve([]),
    frIds.length ? prisma.designationMaster.findMany({ where: { id: { in: frIds } } }) : Promise.resolve([]),
  ]);
  const deptMap = new Map(depts.map((d) => [d.id, d.name]));
  const locMap = new Map(locs.map((l) => [l.id, l.name]));
  const frMap = new Map(frs.map((f) => [f.id, f.displayName]));
  return rows.map((r) => {
    const ids = functionalRoleIds(r);
    return {
      ...r,
      departmentName: deptMap.get(r.departmentId) ?? null,
      locationName: locMap.get(r.locationId) ?? null,
      // #2: normalised functional-role ids + their display names for the UI.
      designationIds: ids,
      functionalRoleNames: ids.map((id) => frMap.get(id)).filter(Boolean) as string[],
    };
  });
}

/**
 * CR-12: resolve each user's ACTIVE role names. Returns a map keyed by userId so
 * a page of users can be annotated in a single round-trip to UserRole + Role.
 */
async function rolesByUser(userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = Array.from(new Set(userIds));
  if (!ids.length) return map;
  const userRoles = await prisma.userRole.findMany({
    where: { userId: { in: ids }, isActive: true },
    select: { userId: true, roleId: true },
  });
  const roleIds = Array.from(new Set(userRoles.map((ur) => ur.roleId)));
  const roles = roleIds.length
    ? await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, roleName: true } })
    : [];
  const roleNameById = new Map(roles.map((r) => [r.id, r.roleName]));
  for (const ur of userRoles) {
    const name = roleNameById.get(ur.roleId);
    if (!name) continue;
    const list = map.get(ur.userId) ?? [];
    list.push(name);
    map.set(ur.userId, list);
  }
  return map;
}

/** CR-12: attach `roleNames: string[]` to a page of users (active roles only). */
async function withRoleNames<T extends { id: string }>(rows: T[]) {
  const roleMap = await rolesByUser(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, roleNames: roleMap.get(r.id) ?? [] }));
}

// ---- User-creation requests -------------------------------------------------

export async function createUserRequest(input: CreateUserInput, createdBy: string) {
  if (await getBool('ldap.enabled')) {
    const { userExists } = await import('./ldap.service');
    if (!(await userExists(input.windowsUsername))) {
      throw AppError.badRequest('windowsUsername not found in Active Directory');
    }
  }

  const request = await prisma.userCreationRequest.create({
    data: {
      userType: input.userType,
      fullName: input.fullName,
      employeeId: input.employeeId,
      windowsUsername: input.windowsUsername,
      email: input.email ?? null,
      departmentId: input.departmentId,
      locationId: input.locationId,
      supervisorId: input.supervisorId ?? null,
      // #2: store all functional roles; designationId stays the primary (first).
      designationId: input.designationId ?? input.designationIds?.[0] ?? null,
      designationIds: (input.designationIds ?? (input.designationId ? [input.designationId] : [])) as Prisma.InputJsonValue,
      roleIds: input.roleIds as Prisma.InputJsonValue,
      remarks: input.remarks ?? null,
      status: 'PENDING_APPROVAL',
      createdBy,
    },
  });

  await notifyUserRequestSubmitted(input.fullName, input.employeeId, createdBy);
  return request;
}

export async function listRequests(q: PaginationQuery) {
  const where: Prisma.UserCreationRequestWhereInput = {
    isDeleted: false,
    ...(q.search ? { fullName: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.userCreationRequest.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir },
    }),
    prisma.userCreationRequest.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getRequest(id: string) {
  const req = await prisma.userCreationRequest.findFirst({ where: { id, isDeleted: false } });
  if (!req) throw AppError.notFound('User-creation request not found');
  return req;
}

export async function decideRequest(
  requestId: string,
  input: UserRequestDecisionInput,
  req: Request,
) {
  const request = await getRequest(requestId);
  if (request.status !== 'PENDING_APPROVAL') {
    throw AppError.conflict('This request has already been decided.');
  }

  const isApprove = input.decision === 'APPROVE';
  const signatureId = await signFromRequest(
    req,
    'UserCreationRequest',
    requestId,
    isApprove ? 'Approved' : 'Rejected',
  );
  auditContext.setActionOverride(isApprove ? 'APPROVE' : 'REJECT');

  if (!isApprove) {
    const updated = await prisma.userCreationRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        decidedBy: req.user!.id,
        decidedAt: new Date(),
        decisionRemarks: input.remarks ?? null,
        signatureId,
      },
    });
    await notifyUserRequestDecision(null, request.email, input.decision, input.remarks, request.createdBy);
    return updated;
  }

  const roleIds = (request.roleIds as string[]) ?? [];
  // CR-1(c): never provision a user against an inactive/deleted role.
  await assertRolesActive(roleIds);
  const plainPassword = tempPassword();
  const passwordHash = await hashPassword(plainPassword);

  const result = await auditedTransaction(prisma, async (tx) => {
    const user = await tx.user.create({
      data: {
        employeeId: request.employeeId,
        fullName: request.fullName,
        windowsUsername: request.windowsUsername,
        email: request.email,
        passwordHash,
        signaturePasswordHash: null,
        userType: request.userType,
        departmentId: request.departmentId,
        locationId: request.locationId,
        supervisorId: (request as { supervisorId?: string | null }).supervisorId ?? null,
        designationId: (request as { designationId?: string | null }).designationId ?? null,
        // #2: carry all functional roles from the request onto the user.
        designationIds: ((request as { designationIds?: unknown }).designationIds ?? []) as Prisma.InputJsonValue,
        isActive: true,
        mustChangePassword: true,
        createdBy: req.user!.id,
      },
    });

    for (const roleId of roleIds) {
      await tx.userRole.create({
        data: { userId: user.id, roleId, assignedBy: req.user!.id },
      });
    }

    const updatedRequest = await tx.userCreationRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        decidedBy: req.user!.id,
        decidedAt: new Date(),
        decisionRemarks: input.remarks ?? null,
        signatureId,
        createdUserId: user.id,
      },
    });

    return {
      result: { user, request: updatedRequest },
      audits: [
        { action: 'CREATE', entityType: 'User', entityId: user.id, newValue: { employeeId: user.employeeId, fullName: user.fullName, windowsUsername: user.windowsUsername } },
        ...roleIds.map((roleId) => ({
          action: 'PERMISSION_CHANGE',
          entityType: 'UserRole',
          entityId: user.id,
          newValue: { userId: user.id, roleId },
        })),
        { action: 'APPROVE', entityType: 'UserCreationRequest', entityId: requestId },
      ],
    };
  });

  await notifyUserRequestDecision(result.user.id, request.email, input.decision, input.remarks, request.createdBy, plainPassword);
  return { ...result.request, tempPassword: plainPassword, windowsUsername: result.user.windowsUsername };
}

// ---- Users ------------------------------------------------------------------

export async function listUsers(q: PaginationQuery, locationId?: string) {
  const where: Prisma.UserWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    // UR-85: restrict to requester's location unless cross-location access granted
    ...(locationId ? { locationId } : {}),
    ...(q.search
      ? {
          OR: [
            { fullName: { contains: q.search, mode: 'insensitive' } },
            { employeeId: { contains: q.search, mode: 'insensitive' } },
            { windowsUsername: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'fullName']: q.sortDir },
    }),
    prisma.user.count({ where }),
  ]);
  // CR-12: annotate with department/location names AND active role names.
  return { data: await withRoleNames(await withNames(rows)), total, page: q.page, pageSize: q.pageSize };
}

/**
 * CR-12: fetch ALL users matching the current filter (no pagination) annotated
 * with department/location/role names — for the users-list export. `locationId`
 * mirrors the same location scoping applied to `listUsers`.
 */
export async function listUsersForExport(q: PaginationQuery, locationId?: string) {
  const where: Prisma.UserWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(locationId ? { locationId } : {}),
    ...(q.search
      ? {
          OR: [
            { fullName: { contains: q.search, mode: 'insensitive' } },
            { employeeId: { contains: q.search, mode: 'insensitive' } },
            { windowsUsername: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const rows = await prisma.user.findMany({ where, orderBy: { [q.sortBy || 'fullName']: q.sortDir } });
  return withRoleNames(await withNames(rows));
}

export async function getUser(id: string) {
  const user = await prisma.user.findFirst({ where: { id, isDeleted: false } });
  if (!user) throw AppError.notFound('User not found');
  const roles = await prisma.userRole.findMany({ where: { userId: id, isActive: true } });
  const [withName] = await withNames([user]);
  return { ...withName, roleIds: roles.map((r) => r.roleId) };
}

export async function updateUser(id: string, input: UpdateUserInput, req: Request) {
  const existing = await prisma.user.findFirst({ where: { id, isDeleted: false } });
  if (!existing) throw AppError.notFound('User not found');

  // CR-14: editing a user is a controlled action and requires a two-component
  // electronic signature (verified against req.body.signature).
  await signFromRequest(req, 'User', id, 'Approved');
  auditContext.setActionOverride('UPDATE');
  const actorId = req.user?.id;

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      ...(input.supervisorId !== undefined ? { supervisorId: input.supervisorId } : {}),
      // #2: when the functional-role array is supplied, store it and keep designationId
      // (the primary, used by JD auto-assign) in sync with the first selected role.
      ...(input.designationIds !== undefined
        ? { designationIds: input.designationIds as Prisma.InputJsonValue, designationId: input.designationIds[0] ?? null }
        : input.designationId !== undefined
          ? { designationId: input.designationId }
          : {}),
      ...(input.userType !== undefined ? { userType: input.userType } : {}),
    },
  });

  // UR-7 + UR-35: on a department transfer the existing training records are left
  // intact (never deleted) and a fresh DRAFT job description is pre-filled from the
  // master JD template for the new department + primary role, if one exists.
  const departmentChanged =
    input.departmentId !== undefined && input.departmentId !== existing.departmentId;
  if (departmentChanged) {
    await provisionJdFromTemplate(id, updated.departmentId, actorId ?? existing.createdBy);
  }

  return updated;
}

/** Best-effort: create a DRAFT JD from the master template for the user's primary role. */
async function provisionJdFromTemplate(userId: string, departmentId: string, createdBy: string) {
  try {
    const primaryRole = await prisma.userRole.findFirst({
      where: { userId, isActive: true },
      orderBy: { assignedAt: 'desc' },
    });
    if (!primaryRole) return;
    const { createFromTemplate } = await import('./jobDescription.service');
    await createFromTemplate(userId, departmentId, primaryRole.roleId, createdBy);
  } catch {
    // No template for this department+role — nothing to provision. Transfer still succeeds.
  }
}

export async function changeRoles(id: string, roleIds: string[], req: Request) {
  const user = await prisma.user.findFirst({ where: { id, isDeleted: false } });
  if (!user) throw AppError.notFound('User not found');

  // CR-1(c): role-change requests may only reference active, non-deleted roles.
  await assertRolesActive(roleIds);

  await signFromRequest(req, 'User', id, 'Approved');
  auditContext.setActionOverride('PERMISSION_CHANGE');

  return auditedTransaction(prisma, async (tx) => {
    await tx.userRole.updateMany({ where: { userId: id, isActive: true }, data: { isActive: false } });
    for (const roleId of roleIds) {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: id, roleId } },
        update: { isActive: true, assignedBy: req.user!.id, assignedAt: new Date() },
        create: { userId: id, roleId, assignedBy: req.user!.id },
      });
    }
    return {
      result: { userId: id, roleIds },
      audits: [
        { action: 'PERMISSION_CHANGE', entityType: 'User', entityId: id, newValue: { roleIds } },
      ],
    };
  });
}

export async function activateUser(id: string, req: Request) {
  const user = await prisma.user.findFirst({ where: { id, isDeleted: false } });
  if (!user) throw AppError.notFound('User not found');
  await signFromRequest(req, 'User', id, 'Approved');
  auditContext.setActionOverride('UPDATE');
  return prisma.user.update({ where: { id }, data: { isActive: true } });
}

export async function deactivateUser(id: string, req: Request) {
  const user = await prisma.user.findFirst({ where: { id, isDeleted: false } });
  if (!user) throw AppError.notFound('User not found');
  await signFromRequest(req, 'User', id, 'Approved');
  auditContext.setActionOverride('UPDATE');
  // Keep isDeleted:false so the user remains listable under includeInactive.
  return prisma.user.update({ where: { id }, data: { isActive: false } });
}

export async function resetPassword(id: string, req: Request) {
  const user = await prisma.user.findFirst({ where: { id, isDeleted: false } });
  if (!user) throw AppError.notFound('User not found');
  await signFromRequest(req, 'User', id, 'Approved');
  auditContext.setActionOverride('UPDATE');

  const plainPassword = tempPassword();
  const passwordHash = await hashPassword(plainPassword);
  const updated = await auditedTransaction(prisma, async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: {
        passwordHash,
        // CR-17: reset BOTH the login and signature passwords to the same temp value.
        signaturePasswordHash: passwordHash,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
    });
    await tx.passwordHistory.create({ data: { userId: id, passwordHash } });
    return {
      result: u,
      audits: [{ action: 'UPDATE', entityType: 'User', entityId: id, newValue: { passwordReset: true, signaturePasswordReset: true } }],
    };
  });
  await notifyPasswordReset(id, plainPassword);
  return { ...updated, tempPassword: plainPassword };
}

// ---- Bulk upload ------------------------------------------------------------

const COLUMN_MAP = {
  userType: 'UserType',
  fullName: 'FullName',
  employeeId: 'EmployeeID',
  windowsUsername: 'WindowsUsername',
  email: 'EmailID',
  department: 'Department',
  role: 'Role',
  location: 'Location',
  remarks: 'Remarks',
} as const;

export interface BulkPreviewResult {
  valid: CreateUserInput[];
  errors: Array<{ row: number; messages: string[] }>;
}

export async function bulkPreview(buffer: Buffer): Promise<BulkPreviewResult> {
  const rows = await parseExcel(buffer);

  const [departments, locations, roles] = await Promise.all([
    prisma.department.findMany({ where: { isDeleted: false } }),
    prisma.location.findMany({ where: { isDeleted: false } }),
    prisma.role.findMany({ where: { isDeleted: false } }),
  ]);
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));
  const roleByName = new Map(roles.map((r) => [r.roleName.toLowerCase(), r.id]));

  const valid: CreateUserInput[] = [];
  const errors: Array<{ row: number; messages: string[] }> = [];

  for (const raw of rows) {
    const row = Number(raw.__row);
    const messages: string[] = [];
    const get = (key: keyof typeof COLUMN_MAP) => String(raw[COLUMN_MAP[key]] ?? '').trim();

    const userType = get('userType').toUpperCase();
    const fullName = get('fullName');
    const employeeId = get('employeeId');
    const windowsUsername = get('windowsUsername');
    const email = get('email');
    const departmentName = get('department');
    const locationName = get('location');
    const roleName = get('role');
    const remarks = get('remarks');

    if (!['INTERNAL', 'EXTERNAL', 'CONTRACTOR'].includes(userType)) {
      messages.push(`Invalid UserType "${get('userType')}"`);
    }
    if (!fullName) messages.push('FullName is required');
    if (!employeeId) messages.push('EmployeeID is required');
    if (!windowsUsername) messages.push('WindowsUsername is required');

    const departmentId = deptByName.get(departmentName.toLowerCase());
    if (!departmentId) messages.push(`Unknown Department "${departmentName}"`);
    const locationId = locByName.get(locationName.toLowerCase());
    if (!locationId) messages.push(`Unknown Location "${locationName}"`);
    const roleId = roleByName.get(roleName.toLowerCase());
    if (!roleId) messages.push(`Unknown Role "${roleName}"`);

    if (messages.length || !departmentId || !locationId || !roleId) {
      errors.push({ row, messages });
      continue;
    }

    valid.push({
      userType: userType as CreateUserInput['userType'],
      fullName,
      employeeId,
      windowsUsername,
      email: email || undefined,
      departmentId,
      locationId,
      roleIds: [roleId],
      remarks: remarks || undefined,
    });
  }

  return { valid, errors };
}

export async function bulkCommit(rows: CreateUserInput[], createdBy: string) {
  let created = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await createUserRequest(row, createdBy);
      created += 1;
    } catch {
      failed += 1;
    }
  }
  return { created, failed };
}

// ---- User lifecycle / release stage (CR-15 / CR-16) -------------------------

/**
 * Aggregate a user's onboarding lifecycle: JD acknowledgement, CV completeness,
 * TNI status, training completion, and the stored release stage. Read-only — the
 * UI uses it to show the user's onboarding/release readiness.
 */
export async function getUserLifecycle(userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  if (!user) throw AppError.notFound('User not found');

  const [jd, cv, tnis, assignments] = await Promise.all([
    prisma.jobDescription.findFirst({ where: { userId, isDeleted: false, status: { not: 'OBSOLETE' } }, orderBy: { version: 'desc' } }),
    prisma.curriculumVitae.findFirst({ where: { userId, isDeleted: false } }),
    prisma.tNI.findMany({ where: { userId, isDeleted: false } }),
    prisma.trainingAssignment.findMany({ where: { userId, isDeleted: false, status: { not: 'DEFERRED' } } }),
  ]);

  const trainingTotal = assignments.length;
  const trainingCompleted = assignments.filter((a) => a.status === 'COMPLETED' || a.status === 'WAIVED').length;
  const trainingComplete = trainingTotal === 0 || trainingCompleted === trainingTotal;

  return {
    userId,
    releaseStage: user.releaseStage,
    releasedAt: user.releasedAt,
    jd: jd ? { id: jd.id, title: jd.title, acknowledged: !!jd.acknowledgedAt, acknowledgedAt: jd.acknowledgedAt } : null,
    jdAcknowledged: !!jd?.acknowledgedAt,
    cvCompleted: !!cv,
    tni: { total: tnis.length, approved: tnis.filter((t) => t.status === 'APPROVED').length, pending: tnis.filter((t) => t.status === 'PENDING').length },
    training: { total: trainingTotal, completed: trainingCompleted, complete: trainingComplete },
    // Eligible to release once JD is acknowledged and all assigned training is complete.
    eligibleForRelease: !!jd?.acknowledgedAt && trainingComplete,
  };
}

/** CR-16: move a user along the release lifecycle. Controlled action — e-signed. */
export async function setReleaseStage(userId: string, stage: 'ONBOARDING' | 'READY_FOR_RELEASE' | 'RELEASED', req: Request) {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  if (!user) throw AppError.notFound('User not found');
  await signFromRequest(req, 'User', userId, 'Approved');
  auditContext.setActionOverride('UPDATE');
  return prisma.user.update({
    where: { id: userId },
    data: {
      releaseStage: stage,
      ...(stage === 'RELEASED' ? { releasedAt: new Date(), releasedBy: req.user!.id } : {}),
    },
  });
}
