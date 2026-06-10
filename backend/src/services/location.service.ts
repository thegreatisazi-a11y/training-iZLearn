import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import type { CreateLocationInput, UpdateLocationInput, PaginationQuery } from '@izlearn/shared';

/**
 * Reference CRUD service — the canonical pattern for izLearn domain services:
 *  - soft-delete only (isDeleted) — never hard-delete
 *  - active-only by default; isDeleted always filtered out
 *  - writes go through the Prisma audit middleware automatically
 *  - reasonForChange for update/delete is enforced by route middleware and
 *    captured by the audit context (services don't handle it directly)
 */
export async function listLocations(q: PaginationQuery) {
  const where: Prisma.LocationWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.location.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'name']: q.sortDir },
    }),
    prisma.location.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getLocation(id: string) {
  const loc = await prisma.location.findFirst({ where: { id, isDeleted: false } });
  if (!loc) throw AppError.notFound('Location not found');
  return loc;
}

export async function createLocation(input: CreateLocationInput, createdBy: string) {
  return prisma.location.create({
    data: { name: input.name, description: input.description ?? null, createdBy },
  });
}

export async function updateLocation(id: string, input: UpdateLocationInput) {
  await getLocation(id);
  return prisma.location.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

/** Soft-delete (the only kind of delete in izLearn). */
export async function deactivateLocation(id: string) {
  await getLocation(id);
  return prisma.location.update({ where: { id }, data: { isActive: false, isDeleted: true } });
}
