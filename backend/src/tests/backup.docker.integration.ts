/** Run only against a disposable MongoDB database and local storage volume. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { listBackups, restoreBackup, runBackup, verifyBackup, importBackup } from '../services/backup.service';
import { allQueues } from '../jobs/queue';
import { redis } from '../config/redis';

async function main() {
  if (process.env.BACKUP_INTEGRATION_TEST !== 'true' ||
      !env.databaseUrl.includes('backup-integration') ||
      env.storage.root !== '/tmp/izlearn-backup-integration/files' ||
      process.env.BACKUP_DESTINATION !== '/tmp/izlearn-backup-integration/backups' ||
      !env.redis.url.includes('izlearn-restore-test-redis')) {
    throw new Error('Refusing to run outside the isolated backup integration environment.');
  }

  const key = 'backup.integration.probe';
  const file = path.join(env.storage.root, 'materials', 'probe.pdf');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'PDF version 1');
  await prisma.systemConfig.create({ data: { key, value: 'version 1', updatedBy: 'integration-test' } });

  await prisma.userSession.create({ data: {
    userId: 'test-user', sessionId: 'test-session', refreshToken: 'test-only-token', isActive: true,
    expiresAt: new Date(Date.now() + 3600000),
  } });
  const backup = await runBackup('integration-test');
  assert.equal(backup.manifest.filesCount, 1);
  assert.equal((await verifyBackup(backup.file)).valid, true);
  const imported = await importBackup(path.join(process.env.BACKUP_DESTINATION!, backup.file), 'integration-test');
  assert.notEqual(imported.file, backup.file);

  fs.writeFileSync(file, 'PDF version 2');
  fs.writeFileSync(path.join(env.storage.root, 'materials', 'newer.pdf'), 'newer file');
  await prisma.systemConfig.update({ where: { key }, data: { value: 'version 2' } });
  await prisma.$runCommandRaw({ create: 'NewerOnlyCollection' });
  const result = await restoreBackup(imported.file, 'integration-test', {
    id: 'backup-integration-signature', userId: 'integration-test', userFullName: 'Integration Test',
    recordType: 'Backup', recordId: backup.file, meaning: 'Performed', signedAt: new Date(), ipAddress: null,
  });

  assert.equal(result.file, imported.file);
  assert.equal((await prisma.systemConfig.findUniqueOrThrow({ where: { key } })).value, 'version 1');
  assert.equal(fs.readFileSync(file, 'utf8'), 'PDF version 1');
  assert.equal(fs.existsSync(path.join(env.storage.root, 'materials', 'newer.pdf')), false);
  assert.equal((await listBackups()).length, 3);
  assert.equal(await prisma.userSession.count({ where: { isActive: true } }), 0);
  const collections = await prisma.$runCommandRaw({ listCollections: 1, filter: { name: 'NewerOnlyCollection' } }) as any;
  assert.equal(collections.cursor.firstBatch.length, 0);
  assert.equal(await prisma.electronicSignature.count({ where: { id: 'backup-integration-signature' } }), 1);
  console.log('PASS: upload validation, MongoDB and file restore, safety snapshot, signature, session invalidation');
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await Promise.allSettled(allQueues.map((queue) => queue.close()));
    redis.disconnect();
    await prisma.$disconnect();
  });
