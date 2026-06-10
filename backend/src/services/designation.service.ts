import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type { PaginationQuery } from '@izlearn/shared';

/** Admin-configurable Designation (job title) master. Mirrors the training-type master. */

export async function listDesignations(q: PaginationQuery & { includeInactive?: boolean }) {
  const where = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.search ? { displayName: { contains: q.search, mode: 'insensitive' as const } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.designationMaster.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { displayName: 'asc' },
    }),
    prisma.designationMaster.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) };
}

export async function createDesignation(
  input: { code: string; displayName: string; description?: string },
  createdBy: string,
) {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, '_');
  const existing = await prisma.designationMaster.findFirst({ where: { code, isDeleted: false } });
  if (existing) throw AppError.conflict(`Designation with code "${code}" already exists.`);

  return prisma.designationMaster.create({
    data: {
      code,
      displayName: input.displayName.trim(),
      description: input.description?.trim() ?? null,
      createdBy,
    },
  });
}

export async function updateDesignation(
  id: string,
  input: { displayName?: string; description?: string; isActive?: boolean },
) {
  const record = await prisma.designationMaster.findFirst({ where: { id, isDeleted: false } });
  if (!record) throw AppError.notFound('Designation not found.');

  return prisma.designationMaster.update({
    where: { id },
    data: {
      ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() ?? null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    },
  });
}

/** Soft-delete (the only kind of delete in izLearn). Reason captured via middleware. */
export async function deleteDesignation(id: string) {
  const record = await prisma.designationMaster.findFirst({ where: { id, isDeleted: false } });
  if (!record) throw AppError.notFound('Designation not found.');
  return prisma.designationMaster.update({ where: { id }, data: { isDeleted: true, isActive: false } });
}
