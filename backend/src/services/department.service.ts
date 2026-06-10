import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type { CreateDepartmentInput, UpdateDepartmentInput, PaginationQuery } from '@izlearn/shared';

/**
 * Department master setup (Module 14) — mirrors the canonical Location CRUD
 * pattern. Soft-delete only; reads filter isDeleted and default to active-only.
 * Writes are captured by the Prisma audit middleware automatically.
 */
export async function listDepartments(q: PaginationQuery) {
  const where: Prisma.DepartmentWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.department.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'name']: q.sortDir },
    }),
    prisma.department.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getDepartment(id: string) {
  const dept = await prisma.department.findFirst({ where: { id, isDeleted: false } });
  if (!dept) throw AppError.notFound('Department not found');
  return dept;
}

export async function createDepartment(input: CreateDepartmentInput, createdBy: string) {
  return prisma.department.create({
    data: { name: input.name, locationId: input.locationId, createdBy },
  });
}

export async function updateDepartment(id: string, input: UpdateDepartmentInput) {
  await getDepartment(id);
  return prisma.department.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

/** Soft-delete (the only kind of delete in izLearn). */
export async function deactivateDepartment(id: string) {
  await getDepartment(id);
  return prisma.department.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}
