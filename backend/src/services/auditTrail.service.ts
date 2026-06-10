import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { auditContext, SYSTEM_ACTOR } from '../utils/auditContext';
import type { AuditAction } from '@izlearn/shared';

export interface RecordEventInput {
  action: AuditAction | string;
  entityType?: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reasonForChange?: string | null;
  actor?: { userId: string; userFullName: string; sessionId?: string };
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Record an explicit audit event (LOGIN, LOGOUT, ACCESS_DENIED, EXPORT, PRINT,
 * ESIGN, RATE_LIMITED, …) that is not a plain data mutation. Data mutations are
 * captured automatically by the Prisma audit middleware.
 *
 * Writes directly to the (insert-only) AuditTrail table.
 */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  const store = auditContext.getStore();
  const actor = input.actor ?? store?.actor ?? SYSTEM_ACTOR;
  await prisma.auditTrail.create({
    data: {
      userId: actor.userId,
      userFullName: actor.userFullName,
      action: input.action,
      entityType: input.entityType ?? 'System',
      entityId: input.entityId ?? null,
      oldValue: (input.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (input.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
      reasonForChange: input.reasonForChange ?? null,
      ipAddress: input.ipAddress ?? store?.ipAddress ?? null,
      userAgent: input.userAgent ?? store?.userAgent ?? null,
      sessionId: actor.sessionId ?? null,
    },
  });
}

export interface AuditQueryFilters {
  from?: Date;
  to?: Date;
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

export async function queryAuditTrail(filters: AuditQueryFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const where: Prisma.AuditTrailWhereInput = {};
  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.from || filters.to) {
    where.timestamp = {};
    if (filters.from) (where.timestamp as Prisma.DateTimeFilter).gte = filters.from;
    if (filters.to) (where.timestamp as Prisma.DateTimeFilter).lte = filters.to;
  }

  const [data, total] = await Promise.all([
    prisma.auditTrail.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditTrail.count({ where }),
  ]);

  return { data, total, page, pageSize };
}
