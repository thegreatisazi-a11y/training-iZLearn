import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type { PaginationQuery } from '@izlearn/shared';

/** Admin-configurable document type master (UR-102/103). */

export async function listDocumentTypes(q: PaginationQuery & { includeInactive?: boolean }) {
  const where = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.search ? { displayName: { contains: q.search, mode: 'insensitive' as const } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.documentTypeMaster.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { displayName: 'asc' },
    }),
    prisma.documentTypeMaster.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) };
}

export async function createDocumentType(input: {
  code: string;
  displayName: string;
  description?: string;
}, createdBy: string) {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, '_');
  const existing = await prisma.documentTypeMaster.findFirst({ where: { code, isDeleted: false } });
  if (existing) throw AppError.conflict(`Document type with code "${code}" already exists.`);

  return prisma.documentTypeMaster.create({
    data: { code, displayName: input.displayName.trim(), description: input.description?.trim() ?? null, createdBy },
  });
}

export async function updateDocumentType(id: string, input: {
  displayName?: string;
  description?: string;
  isActive?: boolean;
}, updatedBy: string) {
  const record = await prisma.documentTypeMaster.findFirst({ where: { id, isDeleted: false } });
  if (!record) throw AppError.notFound('Document type not found.');

  return prisma.documentTypeMaster.update({
    where: { id },
    data: {
      ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() ?? null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    },
  });
}

export async function deleteDocumentType(id: string) {
  const record = await prisma.documentTypeMaster.findFirst({ where: { id, isDeleted: false } });
  if (!record) throw AppError.notFound('Document type not found.');

  return prisma.documentTypeMaster.update({ where: { id }, data: { isDeleted: true, isActive: false } });
}
