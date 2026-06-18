import { Prisma } from '@prisma/client';
import DOMPurify from 'isomorphic-dompurify';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { notifyAnnouncement } from './notification.service';
import type { CreateAnnouncementInput, UpdateAnnouncementInput, PaginationQuery } from '@izlearn/shared';

/**
 * Announcements (Module 14) — rich-text broadcasts targeted at all users or a
 * subset of roles. Content is sanitised with DOMPurify before persistence to
 * neutralise stored XSS. Soft-delete only; writes are audited by the Prisma
 * middleware automatically.
 */
export async function listAnnouncements(q: PaginationQuery) {
  const where: Prisma.AnnouncementWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir },
    }),
    prisma.announcement.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getAnnouncement(id: string) {
  const a = await prisma.announcement.findFirst({ where: { id, isDeleted: false } });
  if (!a) throw AppError.notFound('Announcement not found');
  return a;
}

export async function createAnnouncement(input: CreateAnnouncementInput, createdBy: string) {
  const announcement = await prisma.announcement.create({
    data: {
      title: input.title,
      content: DOMPurify.sanitize(input.content),
      targetRoles: (input.targetRoles ?? []) as Prisma.InputJsonValue,
      expiresAt: input.expiresAt ?? null,
      createdBy,
    },
  });
  await notifyAnnouncement(announcement.id);
  return announcement;
}

export async function updateAnnouncement(id: string, input: UpdateAnnouncementInput) {
  await getAnnouncement(id);
  return prisma.announcement.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: DOMPurify.sanitize(input.content) } : {}),
      ...(input.targetRoles !== undefined ? { targetRoles: input.targetRoles as Prisma.InputJsonValue } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

/** Deactivate (recoverable) — sets inactive but NOT deleted, so it can be reactivated
 * via updateAnnouncement({ isActive: true }) and still appears under "include inactive". */
export async function deactivateAnnouncement(id: string) {
  await getAnnouncement(id);
  return prisma.announcement.update({ where: { id }, data: { isActive: false } });
}

/**
 * Active, non-expired announcements visible to the current user: those with no
 * target roles (everyone) or whose target roles intersect the user's roles.
 */
export async function feedForUser(roleIds: string[]) {
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: {
      isDeleted: false,
      isActive: true,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    },
    orderBy: { createdAt: 'desc' },
  });
  const roleSet = new Set(roleIds);
  return rows.filter((a) => {
    const targets = (a.targetRoles as string[]) ?? [];
    return targets.length === 0 || targets.some((r) => roleSet.has(r));
  });
}
