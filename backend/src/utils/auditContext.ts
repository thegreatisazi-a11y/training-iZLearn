import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request / per-job audit context.
 *
 * Carries WHO is acting (actor), the request metadata (ip / user-agent /
 * session) and the mandatory reasonForChange into the Prisma audit middleware,
 * which runs deep in the data layer and otherwise has no idea who triggered a
 * write. Implemented with AsyncLocalStorage so the context flows across awaits
 * without being threaded through every function call.
 */

export interface AuditActor {
  userId: string;
  userFullName: string;
  sessionId?: string;
}

export interface AuditStore {
  actor: AuditActor;
  ipAddress?: string;
  userAgent?: string;
  reasonForChange?: string;
  /** Recursion guard — set while the audit middleware is wrapping an op in a transaction. */
  inAudit: boolean;
  /** Optional action override (e.g. APPROVE / REJECT) for the next audited write. */
  actionOverride?: string;
}

export const SYSTEM_ACTOR: AuditActor = { userId: 'SYSTEM', userFullName: 'System' };
export const ANON_ACTOR: AuditActor = { userId: 'ANONYMOUS', userFullName: 'Anonymous' };

const als = new AsyncLocalStorage<AuditStore>();

export const auditContext = {
  als,

  run<T>(store: Partial<AuditStore> & { actor: AuditActor }, fn: () => T): T {
    return als.run({ inAudit: false, ...store }, fn);
  },

  /** Establish a SYSTEM context (used by background jobs and bootstrap tasks). */
  runAsSystem<T>(fn: () => T): T {
    return als.run({ actor: SYSTEM_ACTOR, inAudit: false }, fn);
  },

  getStore(): AuditStore | undefined {
    return als.getStore();
  },

  setActor(actor: AuditActor): void {
    const s = als.getStore();
    if (s) s.actor = actor;
  },

  setReason(reason?: string | null): void {
    const s = als.getStore();
    if (s && reason) s.reasonForChange = reason;
  },

  setActionOverride(action?: string): void {
    const s = als.getStore();
    if (s) s.actionOverride = action;
  },

  setRequestMeta(meta: { ipAddress?: string; userAgent?: string; sessionId?: string }): void {
    const s = als.getStore();
    if (!s) return;
    if (meta.ipAddress) s.ipAddress = meta.ipAddress;
    if (meta.userAgent) s.userAgent = meta.userAgent;
    if (meta.sessionId) s.actor.sessionId = meta.sessionId;
  },
};
