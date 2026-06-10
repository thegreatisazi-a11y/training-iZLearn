import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type { PaginationQuery } from '@izlearn/shared';

/** Admin-configurable training type master (UR-102/103). */

export async function listTrainingTypes(q: PaginationQuery & { includeInactive?: boolean }) {
  const where = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.search ? { displayName: { contains: q.search, mode: 'insensitive' as const } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.trainingTypeMaster.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { displayName: 'asc' },
    }),
    prisma.trainingTypeMaster.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) };
}

export async function createTrainingType(input: {
  code: string;
  displayName: string;
  description?: string;
}, createdBy: string) {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, '_');
  const existing = await prisma.trainingTypeMaster.findFirst({ where: { code, isDeleted: false } });
  if (existing) throw AppError.conflict(`Training type with code "${code}" already exists.`);

  return prisma.trainingTypeMaster.create({
    data: { code, displayName: input.displayName.trim(), description: input.description?.trim() ?? null, isBuiltIn: false, createdBy },
  });
}

export async function updateTrainingType(id: string, input: {
  displayName?: string;
  description?: string;
  isActive?: boolean;
}, updatedBy: string) {
  const record = await prisma.trainingTypeMaster.findFirst({ where: { id, isDeleted: false } });
  if (!record) throw AppError.notFound('Training type not found.');

  return prisma.trainingTypeMaster.update({
    where: { id },
    data: {
      ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() ?? null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    },
  });
}

export async function deleteTrainingType(id: string) {
  const record = await prisma.trainingTypeMaster.findFirst({ where: { id, isDeleted: false } });
  if (!record) throw AppError.notFound('Training type not found.');
  if (record.isBuiltIn) throw AppError.badRequest('Built-in training types cannot be deleted. Deactivate them instead.');

  return prisma.trainingTypeMaster.update({ where: { id }, data: { isDeleted: true, isActive: false } });
}
