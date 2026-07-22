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
  search?: string;
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
  // Free-text search across the stored, human-readable columns (the entity's resolved
  // "Record" label is computed after the query, so it isn't part of the DB filter).
  if (filters.search) {
    const s = filters.search;
    where.OR = [
      { userFullName: { contains: s, mode: 'insensitive' } },
      { action: { contains: s, mode: 'insensitive' } },
      { entityType: { contains: s, mode: 'insensitive' } },
      { reasonForChange: { contains: s, mode: 'insensitive' } },
      { ipAddress: { contains: s, mode: 'insensitive' } },
    ];
  }
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

  return { data: await enrichEntityLabels(data), total, page, pageSize };
}

/**
 * CR-AU1: the "Record" column must show a human-readable name, never a raw id. Resolve
 * each audited record's id → a label appropriate to its entity type, in batched queries.
 * Unknown types (or deleted records) fall back to the id on the client.
 */
async function enrichEntityLabels<T extends { entityType: string; entityId: string | null }>(rows: T[]): Promise<(T & { entityLabel: string | null })[]> {
  const idsByType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.entityId) continue;
    if (!idsByType.has(r.entityType)) idsByType.set(r.entityType, new Set());
    idsByType.get(r.entityType)!.add(r.entityId);
  }
  const label = new Map<string, string>(); // `${type}:${id}` → label
  const put = (type: string, id: string, v: string) => label.set(`${type}:${id}`, v);
  const idsOf = (type: string) => Array.from(idsByType.get(type) ?? []);
  const truncate = (s: string, n = 60) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

  // Resolve user + topic ids first — several relational records label via these.
  const allUserIds = new Set<string>(idsOf('User'));
  const allTopicIds = new Set<string>(idsOf('TrainingTopic'));

  // UserSession events (SESSION_TERMINATED / LOGOUT / SESSION_LOCKED) should show the
  // affected user's name, not a raw id (item 1). The stored id is inconsistent — some
  // events carry the userId, others the sessionId — so resolve both: map any sessionIds
  // to their userId, and treat the rest as userIds directly.
  const sessionIds = idsOf('UserSession');
  const sessionToUser = new Map<string, string>();
  if (sessionIds.length) {
    try {
      const sessions = await prisma.userSession.findMany({ where: { sessionId: { in: sessionIds } }, select: { sessionId: true, userId: true } });
      for (const s of sessions) {
        sessionToUser.set(s.sessionId, s.userId);
        allUserIds.add(s.userId);
      }
    } catch {
      /* skip */
    }
    for (const id of sessionIds) allUserIds.add(id); // ids that are themselves userIds
  }
  // Relational records whose label is composed from their user/topic.
  const relational = ['TrainingAssignment', 'AssessmentAttempt', 'RetakeRequest', 'CurriculumVitae'] as const;
  const relRecords: Record<string, { userId?: string; topicId?: string }> = {};
  await Promise.all(
    relational.map(async (type) => {
      const ids = idsOf(type);
      if (!ids.length) return;
      try {
        const model = (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<Array<{ id: string; userId?: string; topicId?: string }>> }>)[
          type.charAt(0).toLowerCase() + type.slice(1)
        ];
        const recs = await model.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, ...(type !== 'CurriculumVitae' ? { topicId: true } : {}) } });
        for (const rec of recs) {
          relRecords[`${type}:${rec.id}`] = { userId: rec.userId, topicId: rec.topicId };
          if (rec.userId) allUserIds.add(rec.userId);
          if (rec.topicId) allTopicIds.add(rec.topicId);
        }
      } catch {
        /* unknown shape — skip */
      }
    }),
  );

  const [users, topics] = await Promise.all([
    allUserIds.size ? prisma.user.findMany({ where: { id: { in: [...allUserIds] } }, select: { id: true, fullName: true, employeeId: true } }) : [],
    allTopicIds.size ? prisma.trainingTopic.findMany({ where: { id: { in: [...allTopicIds] } }, select: { id: true, title: true, topicNumber: true, topicCode: true } }) : [],
  ]);
  const userLabel = new Map(users.map((u) => [u.id, `${u.fullName} (${u.employeeId})`]));
  const topicLabel = new Map(topics.map((t) => [t.id, `${t.topicNumber ?? t.topicCode} – ${t.title}`]));

  // Simple, single-field label types.
  const simple: Array<[string, () => Promise<Array<{ id: string; label: string }>>]> = [
    ['User', async () => users.filter((u) => idsByType.get('User')?.has(u.id)).map((u) => ({ id: u.id, label: userLabel.get(u.id)! }))],
    ['TrainingTopic', async () => topics.filter((t) => idsByType.get('TrainingTopic')?.has(t.id)).map((t) => ({ id: t.id, label: topicLabel.get(t.id)! }))],
    ['Role', async () => (await prisma.role.findMany({ where: { id: { in: idsOf('Role') } }, select: { id: true, roleName: true } })).map((r) => ({ id: r.id, label: r.roleName }))],
    ['Department', async () => (await prisma.department.findMany({ where: { id: { in: idsOf('Department') } }, select: { id: true, name: true } })).map((r) => ({ id: r.id, label: r.name }))],
    ['Location', async () => (await prisma.location.findMany({ where: { id: { in: idsOf('Location') } }, select: { id: true, name: true } })).map((r) => ({ id: r.id, label: r.name }))],
    ['DesignationMaster', async () => (await prisma.designationMaster.findMany({ where: { id: { in: idsOf('DesignationMaster') } }, select: { id: true, displayName: true } })).map((r) => ({ id: r.id, label: r.displayName }))],
    ['TrainingMaterial', async () => (await prisma.trainingMaterial.findMany({ where: { id: { in: idsOf('TrainingMaterial') } }, select: { id: true, originalFileName: true } })).map((r) => ({ id: r.id, label: r.originalFileName }))],
    ['Question', async () => (await prisma.question.findMany({ where: { id: { in: idsOf('Question') } }, select: { id: true, questionText: true } })).map((r) => ({ id: r.id, label: truncate(r.questionText) }))],
    ['Certificate', async () => (await prisma.certificate.findMany({ where: { id: { in: idsOf('Certificate') } }, select: { id: true, certificateNumber: true } })).map((r) => ({ id: r.id, label: r.certificateNumber }))],
    ['JobDescription', async () => (await prisma.jobDescription.findMany({ where: { id: { in: idsOf('JobDescription') } }, select: { id: true, title: true } })).map((r) => ({ id: r.id, label: r.title }))],
    ['JDTemplate', async () => (await prisma.jDTemplate.findMany({ where: { id: { in: idsOf('JDTemplate') } }, select: { id: true, title: true } })).map((r) => ({ id: r.id, label: r.title }))],
    ['TopicBundle', async () => (await prisma.topicBundle.findMany({ where: { id: { in: idsOf('TopicBundle') } }, select: { id: true, name: true } })).map((r) => ({ id: r.id, label: r.name }))],
  ];
  await Promise.all(
    simple.map(async ([type, fetch]) => {
      if (!idsByType.has(type)) return;
      try {
        for (const { id, label: l } of await fetch()) put(type, id, l);
      } catch {
        /* skip */
      }
    }),
  );

  // UserSession → the affected user's name (item 1).
  for (const id of sessionIds) {
    const uid = sessionToUser.get(id) ?? id;
    const name = userLabel.get(uid);
    if (name) put('UserSession', id, name);
  }

  // Relational composite labels: "<user> · <topic>".
  for (const type of relational) {
    for (const id of idsOf(type)) {
      const rec = relRecords[`${type}:${id}`];
      if (!rec) continue;
      const parts = [rec.userId ? userLabel.get(rec.userId) : null, rec.topicId ? topicLabel.get(rec.topicId) : null].filter(Boolean);
      if (parts.length) put(type, id, parts.join(' · '));
    }
  }

  return rows.map((r) => ({ ...r, entityLabel: r.entityId ? label.get(`${r.entityType}:${r.entityId}`) ?? null : null }));
}
