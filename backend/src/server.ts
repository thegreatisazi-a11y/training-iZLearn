import http from 'http';
import { env } from './config/env';
import { logger, critical } from './config/logger';
import { connectPrisma, disconnectPrisma, prisma } from './config/prisma';
import { verifyAuditTrigger } from './middlewares/auditTrail.middleware';
import { ensureDir } from './utils/fileUtils';
import { createApp } from './app';
import { startJobs, stopJobs } from './jobs';
import { getBool, getList } from './services/systemConfig.service';

function ensureStorageDirs() {
  Object.values(env.storage).forEach((dir) => ensureDir(dir));
}

async function main() {
  await connectPrisma();

  // 21 CFR Part 11 §11.10(e): never run unprotected. Verify immutability triggers.
  const triggersOk = await verifyAuditTrigger(prisma);
  if (!triggersOk && env.isProd) {
    critical('Audit immutability triggers missing — refusing to start in production.');
    process.exit(1);
  }

  ensureStorageDirs();

  // UR-76/77: Warn if Active Directory integration is disabled.
  // In production, LDAP must be enabled to enforce AD-only user creation.
  try {
    const ldapEnabled = await getBool('ldap.enabled');
    if (!ldapEnabled) {
      logger.warn('UR-76/77: LDAP/Active Directory integration is DISABLED. Users can be created without AD validation. Enable ldap.enabled in System Config for production use.');
    }
  } catch { /* systemConfig not yet seeded — non-fatal */ }

  // UR-80: Warn if network restriction (allowed_ip_ranges) is not configured.
  // Without an IP allowlist the application is reachable from any network.
  try {
    const ipRanges = await getList('security.allowed_ip_ranges');
    if (!ipRanges.length) {
      logger.warn('UR-80: Network restriction is NOT configured (security.allowed_ip_ranges is empty). All IP addresses can access the application. Configure the allowlist in System Config for production use.');
    }
  } catch { /* systemConfig not yet seeded — non-fatal */ }

  const app = await createApp();
  const server = http.createServer(app);

  server.listen(env.port, () => {
    logger.info(`izLearn API listening on http://localhost:${env.port}`);
    logger.info(`Swagger UI:  http://localhost:${env.port}/api-docs`);
    logger.info(`Health:      http://localhost:${env.port}/api/health`);
  });

  await startJobs();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully.`);
    server.close();
    await stopJobs().catch(() => undefined);
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  critical('Fatal startup error', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
