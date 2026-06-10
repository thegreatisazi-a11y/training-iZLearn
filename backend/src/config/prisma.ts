import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';
import { createAuditTrailMiddleware } from '../middlewares/auditTrail.middleware';

/**
 * Single shared Prisma client. The audit-trail middleware is registered
 * UNCONDITIONALLY here — there is no configuration flag to disable it
 * (21 CFR Part 11 §11.10(e)).
 */
export const prisma = new PrismaClient({
  log: env.isProd
    ? [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }]
    : [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }],
});

prisma.$on('warn' as never, (e: unknown) => logger.warn('prisma', { e }));
prisma.$on('error' as never, (e: unknown) => logger.error('prisma', { e }));

prisma.$use(createAuditTrailMiddleware(prisma));

export async function connectPrisma(): Promise<void> {
  await prisma.$connect();
  logger.info('Prisma connected.');
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
