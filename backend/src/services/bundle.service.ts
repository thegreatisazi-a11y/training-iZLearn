import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type { Request } from 'express';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { toCsv } from '../utils/csv';
import { signFromRequest } from './eSignature.service';
import { notifyTrainingAssigned } from './notification.service';
import type { CreateBundleInput, UpdateBundleInput, PaginationQuery } from '@izlearn/shared';

/**
 * Topic bundles — a named collection of topics assignable together to selected
 * departments/roles. Soft-delete only; topic membership lives in the BundleTopic
 * join (also soft-deleted). All writes are captured by the Prisma audit middleware.
 */

/** Active (non-deleted) topicIds linked to a bundle. */
async function bundleTopicIds(bundleId: string): Promise<string[]> {
  const links = await prisma.bundleTopic.findMany({ where: { bundleId, isDeleted: false } });
  return links.map((l) => l.topicId);
}

/** Replace a bundle's topic set using soft-delete semantics (no hard deletes). */
async function setBundleTopics(bundleId: string, topicIds: string[], actorId: string) {
  const desired = new Set(topicIds);
  const existing = await prisma.bundleTopic.findMany({ where: { bundleId } });
  const existingActive = new Set(existing.filter((l) => !l.isDeleted).map((l) => l.topicId));

  // Soft-delete links no longer wanted.
  const toRemove = [...existingActive].filter((t) => !desired.has(t));
  for (const topicId of toRemove) {
    await prisma.bundleTopic.update({ where: { bundleId_topicId: { bundleId, topicId } }, data: { isDeleted: true } });
  }
  // Add or reactivate desired links.
  for (const topicId of desired) {
    await prisma.bundleTopic.upsert({
      where: { bundleId_topicId: { bundleId, topicId } },
      update: { isDeleted: false },
      create: { bundleId, topicId, createdBy: actorId },
    });
  }
}

export async function listBundles(q: PaginationQuery) {
  const where: Prisma.TopicBundleWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.topicBundle.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir },
    }),
    prisma.topicBundle.count({ where }),
  ]);
  // Attach the active topic count for the list view.
  const data = await Promise.all(
    rows.map(async (b) => ({ ...b, topicIds: await bundleTopicIds(b.id) })),
  );
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getBundle(id: string) {
  const bundle = await prisma.topicBundle.findFirst({ where: { id, isDeleted: false } });
  if (!bundle) throw AppError.notFound('Bundle not found');
  return { ...bundle, topicIds: await bundleTopicIds(id) };
}

export async function createBundle(input: CreateBundleInput, createdBy: string) {
  const bundle = await prisma.topicBundle.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      departmentIds: (input.departmentIds ?? []) as Prisma.InputJsonValue,
      roleIds: (input.roleIds ?? []) as Prisma.InputJsonValue,
      designationIds: (input.designationIds ?? []) as Prisma.InputJsonValue,
      userIds: (input.userIds ?? []) as Prisma.InputJsonValue,
      dueDate: input.dueDate ?? null,
      createdBy,
    },
  });
  if (input.topicIds?.length) await setBundleTopics(bundle.id, input.topicIds, createdBy);
  return getBundle(bundle.id);
}

export async function updateBundle(id: string, input: UpdateBundleInput, actorId: string) {
  await getBundle(id);
  await prisma.topicBundle.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.departmentIds !== undefined ? { departmentIds: input.departmentIds as Prisma.InputJsonValue } : {}),
      ...(input.roleIds !== undefined ? { roleIds: input.roleIds as Prisma.InputJsonValue } : {}),
      ...(input.designationIds !== undefined ? { designationIds: input.designationIds as Prisma.InputJsonValue } : {}),
      ...(input.userIds !== undefined ? { userIds: input.userIds as Prisma.InputJsonValue } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate ?? null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  if (input.topicIds !== undefined) await setBundleTopics(id, input.topicIds, actorId);
  return getBundle(id);
}

export async function deleteBundle(id: string) {
  await getBundle(id);
  return prisma.topicBundle.update({ where: { id }, data: { isDeleted: true, isActive: false } });
}

/**
 * Archive / restore a bundle (toggle isActive). An archived bundle is hidden from
 * the default list and is not assignable, but is preserved (soft, recoverable via
 * "Include Inactive"). This is distinct from edit and from the hard soft-delete.
 */
export async function setBundleActive(id: string, isActive: boolean) {
  await getBundle(id);
  await prisma.topicBundle.update({ where: { id }, data: { isActive } });
  return getBundle(id);
}

/** 4.7: link one topic to one or more bundles (from the topic detail page). */
export async function addTopicToBundles(topicId: string, bundleIds: string[], actorId: string) {
  const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training topic not found');
  for (const bundleId of bundleIds) {
    const bundle = await prisma.topicBundle.findFirst({ where: { id: bundleId, isDeleted: false } });
    if (!bundle) continue;
    await prisma.bundleTopic.upsert({
      where: { bundleId_topicId: { bundleId, topicId } },
      update: { isDeleted: false },
      create: { bundleId, topicId, createdBy: actorId },
    });
  }
  return { topicId, bundleIds };
}

/**
 * Assign a bundle: expand to one TrainingAssignment per (resolved user × bundle topic).
 * Targets are the union of users in the bundle's departments and users holding its
 * roles. Only PUBLISHED topics are assignable. Existing active (non-completed,
 * non-waived) assignments for the same user+topic are skipped to avoid duplicates.
 * Reuses notifyTrainingAssigned (which also notifies the supervisor, UR-42).
 */
/**
 * Resolve the active target users for a bundle: the union of users in the bundle's
 * departments, users holding its roles, and its explicitly-named users — then
 * intersected with active, non-deleted users (the role/dept branches can surface
 * deactivated accounts).
 */
async function resolveBundleUsers(bundle: { departmentIds: unknown; roleIds: unknown; designationIds?: unknown; userIds: unknown }): Promise<string[]> {
  const departmentIds = (bundle.departmentIds as string[]) ?? [];
  const roleIds = (bundle.roleIds as string[]) ?? [];
  const designationIds = (bundle.designationIds as string[]) ?? [];
  const explicit = (bundle.userIds as string[]) ?? [];
  const ids = new Set<string>(explicit);
  if (departmentIds.length) {
    const us = await prisma.user.findMany({
      where: { departmentId: { in: departmentIds }, isActive: true, isDeleted: false },
      select: { id: true },
    });
    us.forEach((u) => ids.add(u.id));
  }
  if (designationIds.length) {
    const us = await prisma.user.findMany({
      where: { designationId: { in: designationIds }, isActive: true, isDeleted: false },
      select: { id: true },
    });
    us.forEach((u) => ids.add(u.id));
  }
  if (roleIds.length) {
    const urs = await prisma.userRole.findMany({ where: { roleId: { in: roleIds }, isActive: true }, select: { userId: true } });
    urs.forEach((ur) => ids.add(ur.userId));
  }
  if (!ids.size) return [];
  const active = await prisma.user.findMany({
    where: { id: { in: [...ids] }, isActive: true, isDeleted: false },
    select: { id: true },
  });
  return active.map((u) => u.id);
}

export async function assignBundle(id: string, req: Request, opts?: { dueDate?: Date | null }) {
  const assignedBy = req.user!.id;
  const bundle = await getBundle(id);
  // Controlled GMP action — assigning training requires a two-component e-signature.
  await signFromRequest(req, 'TopicBundle', id, 'Approved');

  const userIds = new Set<string>(await resolveBundleUsers(bundle));

  // Only PUBLISHED topics in the bundle may be assigned.
  const publishedTopics = await prisma.trainingTopic.findMany({
    where: { id: { in: bundle.topicIds }, isDeleted: false, status: 'PUBLISHED' },
    select: { id: true },
  });
  const topicIds = publishedTopics.map((t) => t.id);

  if (!userIds.size || !topicIds.length) {
    throw AppError.badRequest('Bundle has no resolvable users or no published topics to assign.');
  }

  // Build (user × topic) pairs, skipping any with an existing active assignment.
  const pairs: Array<{ userId: string; topicId: string }> = [];
  for (const userId of userIds) {
    for (const topicId of topicIds) {
      const existing = await prisma.trainingAssignment.findFirst({
        where: { userId, topicId, isDeleted: false, status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] } },
        select: { id: true },
      });
      if (!existing) pairs.push({ userId, topicId });
    }
  }
  if (!pairs.length) return [];

  const effectiveDue = opts?.dueDate ?? (bundle.dueDate as Date | null) ?? null;
  const created = await auditedTransaction(prisma, async (tx) => {
    const result = [];
    const audits = [];
    for (const p of pairs) {
      const a = await tx.trainingAssignment.create({
        data: {
          userId: p.userId,
          topicId: p.topicId,
          assignmentType: 'COURSE_SPECIFIC',
          dueDate: effectiveDue,
          assignedBy,
          status: 'PENDING',
          createdBy: assignedBy,
        },
      });
      result.push(a);
      audits.push({ action: 'CREATE', entityType: 'TrainingAssignment', entityId: a.id, newValue: { userId: p.userId, topicId: p.topicId, bundleId: id } });
    }
    return { result, audits };
  });

  for (const a of created) await notifyTrainingAssigned(a.userId, a.topicId, a.dueDate);
  return created;
}

/**
 * Step 4: rich detail for the Bundle Detail page — resolved topics (with version +
 * status), target departments/roles/users, and live assignment status counts across
 * the bundle's published topics and resolved users.
 */
export async function getBundleDetail(id: string) {
  const bundle = await getBundle(id);
  const topicIds = bundle.topicIds;
  const departmentIds = (bundle.departmentIds as string[]) ?? [];
  const roleIds = (bundle.roleIds as string[]) ?? [];
  const designationIds = (bundle.designationIds as string[]) ?? [];

  const [topicRows, departments, roles, designations] = await Promise.all([
    topicIds.length
      ? prisma.trainingTopic.findMany({
          where: { id: { in: topicIds } },
          select: { id: true, topicCode: true, topicNumber: true, title: true, currentVersion: true, status: true, trainingType: true },
        })
      : Promise.resolve([]),
    departmentIds.length ? prisma.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    roleIds.length ? prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, roleName: true } }) : Promise.resolve([]),
    designationIds.length ? prisma.designationMaster.findMany({ where: { id: { in: designationIds } }, select: { id: true, displayName: true } }) : Promise.resolve([]),
  ]);

  const resolvedUserIds = await resolveBundleUsers(bundle);
  const users = resolvedUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: resolvedUserIds } }, select: { id: true, fullName: true, employeeId: true } })
    : [];

  // Live assignment status across the bundle's topics for the resolved users.
  const assignments = topicIds.length && resolvedUserIds.length
    ? await prisma.trainingAssignment.findMany({
        where: { isDeleted: false, topicId: { in: topicIds }, userId: { in: resolvedUserIds } },
        select: { status: true },
      })
    : [];
  const counts = { total: assignments.length, pending: 0, inProgress: 0, completed: 0, overdue: 0, blocked: 0, waived: 0 };
  for (const a of assignments) {
    if (a.status === 'PENDING') counts.pending++;
    else if (a.status === 'IN_PROGRESS') counts.inProgress++;
    else if (a.status === 'COMPLETED') counts.completed++;
    else if (a.status === 'OVERDUE') counts.overdue++;
    else if (a.status === 'BLOCKED') counts.blocked++;
    else if (a.status === 'WAIVED') counts.waived++;
  }

  return {
    ...bundle,
    topics: topicRows,
    departments,
    roles,
    designations,
    users,
    resolvedUserCount: resolvedUserIds.length,
    counts,
  };
}

/** Build a CSV export of the (filtered) bundle list. */
export async function exportBundlesCsv(q: PaginationQuery): Promise<string> {
  const { data } = await listBundles({ ...q, page: 1, pageSize: 100000 });
  const headers = ['Name', 'Description', 'Topics', 'Departments', 'Designations', 'Roles', 'Users', 'Due Date', 'Status'];
  const rows = data.map((b) => [
    b.name,
    b.description ?? '',
    b.topicIds.length,
    ((b.departmentIds as string[]) ?? []).length,
    ((b.designationIds as string[]) ?? []).length,
    ((b.roleIds as string[]) ?? []).length,
    ((b.userIds as string[]) ?? []).length,
    b.dueDate ? new Date(b.dueDate as unknown as string).toISOString().slice(0, 10) : '',
    b.isActive ? 'Active' : 'Inactive',
  ]);
  return toCsv(headers, rows);
}

export { bundleTopicIds, setBundleTopics };
