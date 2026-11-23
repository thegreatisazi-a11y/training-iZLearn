/** Offline operator recovery only. Stop every API instance before running this command. */
import fs from 'fs';
import { prisma } from '../src/config/prisma';
import { redis } from '../src/config/redis';
import { allQueues } from '../src/jobs/queue';
import { restoreBackup } from '../src/services/backup.service';
import { maintenanceFile, restoreMaintenanceActive } from '../src/services/restoreMaintenance.service';
import { auditContext } from '../src/utils/auditContext';

async function main() {
  const [file, confirmation] = process.argv.slice(2);
  if (process.env.BACKUP_OFFLINE_RECOVERY !== 'true' || confirmation !== 'RESTORE' ||
      !file || !/^izlearn-full-\d{8}T\d{6}-[a-f0-9]{8}\.tar\.gz$/.test(file)) {
    throw new Error('Stop the backend first. Set BACKUP_OFFLINE_RECOVERY=true and supply a backup filename followed by RESTORE.');
  }
  const marker = maintenanceFile();
  const previous = fs.existsSync(marker) ? fs.readFileSync(marker) : null;
  if (previous) {
    fs.writeFileSync(`${marker}.previous`, previous, { mode: 0o600 });
    fs.unlinkSync(marker);
  }
  try {
    await auditContext.runAsSystem(() => restoreBackup(file, 'SYSTEM', null));
    console.log('Offline recovery complete. Start the backend and sign in with a restored account.');
  } catch (error) {
    if (previous && !restoreMaintenanceActive()) fs.writeFileSync(marker, previous, { mode: 0o600 });
    throw error;
  }
}

main().catch(() => {
  console.error('Offline recovery failed. Keep the API stopped; check the maintenance marker and recovery logs.');
  process.exitCode = 1;
}).finally(async () => {
  await Promise.allSettled(allQueues.map((queue) => queue.close()));
  redis.disconnect();
  await prisma.$disconnect();
});
