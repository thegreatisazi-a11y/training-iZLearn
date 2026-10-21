/** Run only against a disposable MongoDB database and local storage volume. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { listBackups, restoreBackup, runBackup, verifyBackup } from '../services/backup.service';

async function main() {
  if (process.env.BACKUP_INTEGRATION_TEST !== 'true' ||
      !env.databaseUrl.includes('backup-integration') ||
      env.storage.root !== '/tmp/izlearn-backup-integration/files' ||
      process.env.BACKUP_DESTINATION !== '/tmp/izlearn-backup-integration/backups') {
    throw new Error('Refusing to run outside the isolated backup integration environment.');
  }

  const key = 'backup.integration.probe';
  const file = path.join(env.storage.root, 'materials', 'probe.pdf');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'PDF version 1');
  await prisma.systemConfig.create({ data: { key, value: 'version 1', updatedBy: 'integration-test' } });

  const backup = await runBackup('integration-test');
  assert.equal(backup.manifest.filesCount, 1);
  assert.equal((await verifyBackup(backup.file)).valid, true);

  fs.writeFileSync(file, 'PDF version 2');
  fs.writeFileSync(path.join(env.storage.root, 'materials', 'newer.pdf'), 'newer file');
  await prisma.systemConfig.update({ where: { key }, data: { value: 'version 2' } });
  const result = await restoreBackup(backup.file, 'integration-test', {
    id: 'backup-integration-signature', userId: 'integration-test', userFullName: 'Integration Test',
    recordType: 'Backup', recordId: backup.file, meaning: 'Performed', signedAt: new Date(), ipAddress: null,
  });

  assert.equal(result.file, backup.file);
  assert.equal((await prisma.systemConfig.findUniqueOrThrow({ where: { key } })).value, 'version 1');
  assert.equal(fs.readFileSync(file, 'utf8'), 'PDF version 1');
  assert.equal(fs.existsSync(path.join(env.storage.root, 'materials', 'newer.pdf')), false);
  assert.equal((await listBackups()).length, 2);
  assert.equal(await prisma.electronicSignature.count({ where: { id: 'backup-integration-signature' } }), 1);
  console.log('PASS: MongoDB, file, safety snapshot, signature, and backup verification');
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
