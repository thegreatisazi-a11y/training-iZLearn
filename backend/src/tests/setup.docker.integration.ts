/** Run only against a disposable MongoDB replica set; never a deployed database. */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { disconnectSetup, runBootstrap, runReleaseMigrations } from '../../prisma/seed';
import { repairBootstrapAdmin } from '../../prisma/repairAdmin';

const prisma = new PrismaClient();

async function main() {
  if (process.env.SETUP_INTEGRATION_TEST !== 'true' ||
      !process.env.DATABASE_URL?.includes('/setup-integration?') ||
      process.env.SEED_ADMIN_USERNAME !== 'integration-admin' ||
      process.env.SEED_ADMIN_PASSWORD !== 'integration-only-password-2026') {
    throw new Error('Refusing to run setup integration outside the disposable test database.');
  }
  const password = process.env.SEED_ADMIN_PASSWORD;
  delete process.env.SEED_ADMIN_PASSWORD;
  await assert.rejects(runBootstrap(), /Set SEED_ADMIN_PASSWORD/);
  assert.equal(await prisma.systemConfig.count(), 0);
  process.env.SEED_ADMIN_PASSWORD = password;
  await runBootstrap();
  const admin = await prisma.user.findUniqueOrThrow({ where: { windowsUsername: 'integration-admin' } });
  const firstHash = admin.passwordHash;
  const system = await prisma.role.findFirstOrThrow({ where: { isSystem: true } });
  assert.equal(await prisma.userRole.count({ where: { userId: admin.id, roleId: system.id, isActive: true } }), 1);
  assert.equal(await prisma.passwordHistory.count({ where: { userId: admin.id } }), 1);
  process.env.SEED_ADMIN_USERNAME = 'different-admin';
  await assert.rejects(runBootstrap(), /Refusing to create a new privileged account/);
  process.env.SEED_ADMIN_USERNAME = 'integration-admin';

  const extra = await prisma.role.create({ data: { roleName: 'Extra System', permissions: {}, createdBy: 'TEST', isSystem: true } });
  await assert.rejects(runReleaseMigrations(), /exactly one active system role/);
  assert.equal(await prisma.systemConfig.count({ where: { key: 'migration.release_2026_10_bootstrap_split_v1' } }), 0);
  await prisma.role.delete({ where: { id: extra.id } });
  await runReleaseMigrations();
  assert.equal(await prisma.systemConfig.count({ where: { key: 'migration.release_2026_10_bootstrap_split_v1' } }), 1);

  // A later admin choice must survive a repeated release command.
  const changed = (await prisma.role.findUniqueOrThrow({ where: { id: system.id } })).permissions as Record<string, Record<string, boolean>>;
  changed.team.view_all = false;
  await prisma.role.update({ where: { id: system.id }, data: { permissions: changed } });
  await runReleaseMigrations();
  assert.equal(((await prisma.role.findUniqueOrThrow({ where: { id: system.id } })).permissions as typeof changed).team.view_all, false);

  await prisma.role.update({ where: { id: system.id }, data: { roleName: 'Platform Owner' } });
  await runBootstrap();
  assert.equal(await prisma.role.count({ where: { isSystem: true, isDeleted: false } }), 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash, firstHash);

  const duplicateA = await prisma.role.create({ data: { roleName: 'Sample Role', permissions: {}, createdBy: 'TEST' } });
  const duplicateB = await prisma.role.create({ data: { roleName: 'SAMPLE_ROLE', permissions: {}, createdBy: 'TEST' } });
  await assert.rejects(runBootstrap(), /Duplicate role identity/);
  await prisma.role.delete({ where: { id: duplicateA.id } });
  await prisma.role.delete({ where: { id: duplicateB.id } });

  await prisma.userRole.delete({ where: { userId_roleId: { userId: admin.id, roleId: system.id } } });
  await assert.rejects(runBootstrap(), /no active system-role assignment/);
  await assert.rejects(repairBootstrapAdmin(admin.id, 'somebody-else'), /not the active SYSTEM-created bootstrap account/);
  await repairBootstrapAdmin(admin.id, 'integration-admin');
  assert.equal(await prisma.userRole.count({ where: { userId: admin.id, roleId: system.id, isActive: true } }), 1);
  console.log('PASS: fresh bootstrap, restart, release idempotence, rename, duplicates, and explicit admin repair');
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await disconnectSetup(); await prisma.$disconnect(); });
