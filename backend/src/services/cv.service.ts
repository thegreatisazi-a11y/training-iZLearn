import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type { AuthUser } from '../types';
import type { UpsertCvInput, PaginationQuery } from '@izlearn/shared';

/**
 * CV module (CR-52 / D-CV1) — ONE live CV per user; history is preserved through
 * the audit trail (the CurriculumVitae model is audited). Visibility is enforced
 * server-side: a CV is readable by its owner, the owner's supervisor, or a
 * SUPER_ADMIN — never by anyone else.
 */

function isAdmin(user: AuthUser): boolean {
  return user.roleNames.includes('SUPER_ADMIN');
}

/** Read-only header pulled from the user record (name / code / functional role / dept). */
async function cvHeader(userId: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  if (!u) throw AppError.notFound('User not found');
  // #2: merge legacy single + array functional roles, resolve to names.
  const ids = Array.from(
    new Set([...(Array.isArray(u.designationIds) ? (u.designationIds as string[]) : []), ...(u.designationId ? [u.designationId] : [])].filter(Boolean)),
  );
  const [dept, frs] = await Promise.all([
    prisma.department.findFirst({ where: { id: u.departmentId } }),
    ids.length ? prisma.designationMaster.findMany({ where: { id: { in: ids } } }) : Promise.resolve([]),
  ]);
  const functionalRoleNames = frs.map((f) => f.displayName);
  return {
    userId: u.id,
    employeeName: u.fullName,
    employeeCode: u.employeeId,
    departmentName: dept?.name ?? null,
    functionalRole: functionalRoleNames.join(', ') || null,
    functionalRoles: functionalRoleNames,
  };
}

export async function getMyCV(userId: string) {
  const cv = await prisma.curriculumVitae.findFirst({ where: { userId, isDeleted: false } });
  return { header: await cvHeader(userId), cv };
}

/**
 * Item A: full CV version history. The CV is a single live row (version bumped on save)
 * whose past states are preserved in the audit trail — each mutation stores a FULL CV
 * snapshot in newValue. Reconstruct one entry per version, newest first, so any older
 * version can be opened/viewed. The current live CV is always included.
 */
export async function getMyCvHistory(userId: string) {
  const header = await cvHeader(userId);
  const cv = await prisma.curriculumVitae.findFirst({ where: { userId } });
  if (!cv) return { header, versions: [] as { version: number | null; updatedAt: Date; cv: unknown }[] };

  const rows = await prisma.auditTrail.findMany({
    where: { entityType: 'CurriculumVitae', entityId: cv.id },
    orderBy: { timestamp: 'desc' },
  });
  const versions: { version: number | null; updatedAt: Date; cv: unknown }[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    const snap = (r.newValue ?? null) as Record<string, unknown> | null;
    if (!snap) continue; // skip deletes / snapshot-less rows
    const v = typeof snap.version === 'number' ? snap.version : -1;
    if (seen.has(v)) continue; // keep the newest audit row per version
    seen.add(v);
    versions.push({ version: typeof snap.version === 'number' ? snap.version : null, updatedAt: r.timestamp, cv: snap });
  }
  // Guarantee the current live version is present even if its save predates auditing.
  const currentV = cv.version ?? 1;
  if (!versions.some((x) => x.version === currentV)) {
    versions.unshift({ version: currentV, updatedAt: cv.updatedAt, cv });
  }
  return { header, versions };
}

export async function upsertMyCV(userId: string, input: UpsertCvInput) {
  const data = {
    languagesKnown: input.languagesKnown ?? null,
    languages: (input.languages ?? []) as Prisma.InputJsonValue,
    qualifications: (input.qualifications ?? []) as Prisma.InputJsonValue,
    currentRole: input.currentRole ?? null,
    currentTenureFrom: input.currentTenureFrom ?? null,
    currentTenureTo: input.currentTenureTo ?? null,
    currentResponsibilities: input.currentResponsibilities ?? null,
    experience: (input.experience ?? []) as Prisma.InputJsonValue,
    trainings: (input.trainings ?? []) as Prisma.InputJsonValue,
    publications: (input.publications ?? []) as Prisma.InputJsonValue,
    // S3: "Not Applicable" flags for the optional-content sections.
    experienceNotApplicable: !!input.experienceNotApplicable,
    trainingsNotApplicable: !!input.trainingsNotApplicable,
    publicationsNotApplicable: !!input.publicationsNotApplicable,
  };
  const existing = await prisma.curriculumVitae.findFirst({ where: { userId } });
  // Each save is a new version of the CV (history is preserved in the audit trail).
  // Computed explicitly (not { increment }) so a pre-existing CV whose version field is
  // absent still advances visibly: a CV shown as v1 becomes v2 on the next save.
  if (existing) return prisma.curriculumVitae.update({ where: { id: existing.id }, data: { ...data, version: (existing.version ?? 1) + 1 } });
  return prisma.curriculumVitae.create({ data: { ...data, userId, createdBy: userId } });
}

/** Visibility-gated read of another user's CV (owner / supervisor / admin only). */
export async function getUserCV(targetUserId: string, requester: AuthUser) {
  if (targetUserId !== requester.id && !isAdmin(requester)) {
    const target = await prisma.user.findFirst({ where: { id: targetUserId, isDeleted: false }, select: { supervisorId: true } });
    if (!target) throw AppError.notFound('User not found');
    if (target.supervisorId !== requester.id) {
      throw AppError.forbidden('You may only view your own CV or the CVs of your direct reports.');
    }
  }
  return getMyCV(targetUserId);
}

/** Team CVs: SUPER_ADMIN sees everyone; a supervisor sees only their direct reports. */
export async function listTeamCVs(requester: AuthUser, q: PaginationQuery) {
  const where: Prisma.UserWhereInput = {
    isDeleted: false,
    ...(isAdmin(requester) ? {} : { supervisorId: requester.id }),
    ...(q.search
      ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { employeeId: { contains: q.search, mode: 'insensitive' } }] }
      : {}),
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { fullName: 'asc' } }),
    prisma.user.count({ where }),
  ]);
  const ids = users.map((u) => u.id);
  const [cvs, depts, frs] = await Promise.all([
    ids.length ? prisma.curriculumVitae.findMany({ where: { userId: { in: ids }, isDeleted: false }, select: { userId: true } }) : Promise.resolve([]),
    prisma.department.findMany({ where: { id: { in: users.map((u) => u.departmentId) } } }),
    prisma.designationMaster.findMany({ where: { id: { in: users.map((u) => u.designationId).filter(Boolean) as string[] } } }),
  ]);
  const hasCv = new Set(cvs.map((c) => c.userId));
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const frName = new Map(frs.map((f) => [f.id, f.displayName]));
  const data = users.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    employeeId: u.employeeId,
    departmentName: deptName.get(u.departmentId) ?? null,
    functionalRole: u.designationId ? frName.get(u.designationId) ?? null : null,
    hasCv: hasCv.has(u.id),
  }));
  return { data, total, page: q.page, pageSize: q.pageSize };
}
