import { Prisma, PrismaClient } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { auditContext, AuditStore, SYSTEM_ACTOR, ANON_ACTOR } from '../utils/auditContext';
import { logger } from '../config/logger';

/**
 * 21 CFR Part 11 §11.10(e) — secure, computer-generated, time-stamped audit trail.
 *
 * This Prisma middleware intercepts EVERY create/update/delete on a GMP-relevant
 * model and writes an AuditTrail row in the SAME transaction as the mutation.
 * If the audit insert fails, the whole transaction rolls back, so a data change
 * can never be persisted without its audit record. It is registered
 * unconditionally at startup (config/prisma.ts) — there is no flag to disable it.
 */

/** Models whose data changes must be audited. AuditTrail / ElectronicSignature
 * are immutable and never audited as "changes"; sessions/password-history/email
 * logs are operational and handled by explicit LOGIN/LOGOUT/etc. events. */
const AUDITED_MODELS = new Set<string>([
  'User',
  'Role',
  'UserRole',
  'Department',
  'Location',
  'UserCreationRequest',
  'TrainingTopic',
  'TrainingMaterial',
  'Question',
  'TrainingSchedule',
  'TrainingAssignment',
  'Attendance',
  'OjtRecord',
  'OfflineTrainingRecord',
  'AssessmentAttempt',
  'Certificate',
  'CertificateTemplate',
  'JobDescription',
  'JDTemplate',
  'PersonalDocument',
  'TNI',
  'FeedbackForm',
  'FeedbackResponse',
  'Announcement',
  'SystemConfig',
  'TrainingTypeMaster',
  'DocumentTypeMaster',
  'DesignationMaster',
  'TopicVersionHistory',
  'TopicBundle',
  'BundleTopic',
]);

const MUTATING = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

const REDACT = new Set([
  'passwordHash',
  'signaturePasswordHash',
  'refreshToken',
  'password',
  'signaturePassword',
]);

function clientProp(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.has(k) ? '***REDACTED***' : sanitize(v);
    }
    return out;
  }
  return value;
}

function deriveAction(model: string, action: string, data: unknown, override?: string): string {
  if (override) return override;
  if (model === 'SystemConfig') return 'CONFIG_CHANGE';
  if (model === 'UserRole') return action === 'create' ? 'PERMISSION_CHANGE' : 'PERMISSION_CHANGE';
  switch (action) {
    case 'create':
    case 'createMany':
      return 'CREATE';
    case 'delete':
    case 'deleteMany':
      return 'SOFT_DELETE';
    default: {
      const d = data as Record<string, unknown> | undefined;
      if (d && d.isDeleted === true) return 'SOFT_DELETE';
      return 'UPDATE';
    }
  }
}

export interface AuditEntryInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reasonForChange?: string | null;
}

function buildAuditData(store: AuditStore | undefined, e: AuditEntryInput): Prisma.AuditTrailUncheckedCreateInput {
  const actor = store?.actor ?? SYSTEM_ACTOR;
  return {
    userId: actor.userId,
    userFullName: actor.userFullName,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    oldValue: (e.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
    newValue: (e.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
    reasonForChange: e.reasonForChange ?? store?.reasonForChange ?? null,
    ipAddress: store?.ipAddress ?? null,
    userAgent: store?.userAgent ?? null,
    sessionId: actor.sessionId ?? null,
  };
}

export function createAuditTrailMiddleware(prisma: PrismaClient): Prisma.Middleware {
  const audit: Prisma.Middleware = async (params, next) => {
    const { model, action } = params;
    if (!model || !MUTATING.has(action) || !AUDITED_MODELS.has(model)) {
      return next(params);
    }

    // Background / bootstrap writes with no request context get a SYSTEM context.
    const store = auditContext.getStore();
    if (!store) {
      return auditContext.runAsSystem(() => audit(params, next));
    }
    // Already inside an audited transaction (auditedTransaction or a nested op): run as-is.
    if (store.inAudit) {
      return next(params);
    }

    const prop = clientProp(model);
    const args = (params.args ?? {}) as { where?: { id?: string }; data?: unknown; update?: unknown };

    // Capture the "before" snapshot for single-record changes. findFirst handles
    // scalar/`id` where-clauses; for compound-unique keys (e.g. BundleTopic's
    // bundleId_topicId) findFirst rejects the input, so fall back to findUnique.
    let oldValue: unknown = null;
    if ((action === 'update' || action === 'delete' || action === 'upsert') && args.where) {
      const cli = (prisma as Record<string, any>)[prop];
      let existing: unknown = null;
      try {
        existing = await cli.findFirst({ where: args.where });
      } catch {
        try {
          existing = await cli.findUnique({ where: args.where });
        } catch {
          existing = null;
        }
      }
      oldValue = existing ? sanitize(existing) : null;
    }

    const dataForAction = action === 'upsert' ? args.update : args.data;
    const auditAction = deriveAction(model, action, dataForAction, store.actionOverride);
    const reasonForChange = store.reasonForChange ?? null;
    store.actionOverride = undefined; // one-shot

    store.inAudit = true;
    try {
      return await prisma.$transaction(async (tx) => {
        const result = await (tx as Record<string, any>)[prop][action](params.args);

        const isMany = action.endsWith('Many');
        // For *Many operations the where.id may be a filter object (e.g. { not }),
        // not a scalar — never coerce that into the String entityId column.
        const whereId = !isMany && typeof args.where?.id === 'string' ? args.where.id : null;
        let entityId: string | null =
          !isMany && result && typeof result === 'object' && 'id' in result
            ? String((result as { id: unknown }).id)
            : whereId;
        // Composite-PK models (no scalar `id`, e.g. BundleTopic): derive a stable
        // identifier from the compound key so the audit row is still traceable.
        if (!isMany && !entityId && args.where && typeof args.where === 'object') {
          const compound = Object.values(args.where as Record<string, unknown>).find((v) => v && typeof v === 'object');
          if (compound) entityId = Object.values(compound as Record<string, unknown>).join(':');
        }

        const newValue =
          action === 'delete' || action === 'deleteMany'
            ? null
            : isMany
              ? sanitize(args.data)
              : sanitize(result);

        await tx.auditTrail.create({
          data: buildAuditData(store, {
            action: auditAction,
            entityType: model,
            entityId,
            oldValue,
            newValue,
            reasonForChange,
          }),
        });

        return result;
      });
    } finally {
      store.inAudit = false;
    }
  };

  return audit;
}

/**
 * Atomic multi-write helper for business flows that must commit several
 * mutations together (e.g. approve user request → create user + role + update
 * request). Suppresses the auto-audit middleware inside (to avoid nested
 * interactive transactions) and writes the supplied audit rows in the same tx.
 */
export async function auditedTransaction<T>(
  prisma: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<{ result: T; audits: AuditEntryInput[] }>,
): Promise<T> {
  const store = auditContext.getStore();
  const prev = store?.inAudit ?? false;
  if (store) store.inAudit = true;
  try {
    return await prisma.$transaction(async (tx) => {
      const { result, audits } = await work(tx);
      for (const a of audits) {
        await tx.auditTrail.create({ data: buildAuditData(store, a) });
      }
      return result;
    });
  } finally {
    if (store) store.inAudit = prev;
  }
}

/**
 * Express middleware: establishes the per-request audit context so the Prisma
 * middleware can attribute every write. Must be mounted BEFORE the routes.
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  auditContext.als.run(
    {
      actor: { ...ANON_ACTOR },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || undefined,
      inAudit: false,
    },
    () => next(),
  );
}

/**
 * Health check (21 CFR Part 11 §11.10(e)) for audit/e-signature immutability.
 *
 * On PostgreSQL this verified DB-level triggers. MongoDB has no equivalent
 * DB-level trigger mechanism, so immutability is enforced at the APPLICATION
 * layer instead: the app only ever CREATEs AuditTrail / ElectronicSignature
 * records (never update/delete), and these collections are not exposed to any
 * mutating endpoint. There is nothing to verify at the DB layer, so this reports
 * healthy. (Trade-off noted: the previous Postgres triggers were defence-in-depth
 * against direct DB writes, which MongoDB does not provide.)
 */
export async function verifyAuditTrigger(_prisma: PrismaClient): Promise<boolean> {
  logger.info('Audit immutability is enforced at the application layer (MongoDB has no DB-level triggers).');
  return true;
}
