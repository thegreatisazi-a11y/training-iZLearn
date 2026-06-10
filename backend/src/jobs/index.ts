import { emailQueue, adSyncQueue, refresherQueue, dueReminderQueue, backupQueue, allQueues, EmailJobData } from './queue';
import { sendQueuedEmail } from '../services/email.service';
import { runRefresherCheck } from './processors/refresher.processor';
import { runDueReminderCheck } from './processors/dueReminder.processor';
import { runAdSync } from './processors/adSync.processor';
import { runBackupJob } from './processors/backup.processor';
import { auditContext } from '../utils/auditContext';
import { getConfig, getBool } from '../services/systemConfig.service';
import { logger } from '../config/logger';

/**
 * Register Bull processors and schedule the repeatable (cron) jobs. Job bodies
 * run inside a SYSTEM audit context so any writes they make are attributable.
 */
export async function startJobs(): Promise<void> {
  emailQueue.process('send', 5, async (job) => auditContext.runAsSystem(() => sendQueuedEmail(job.data as EmailJobData)));
  refresherQueue.process(async () => auditContext.runAsSystem(() => runRefresherCheck()));
  dueReminderQueue.process(async () => auditContext.runAsSystem(() => runDueReminderCheck()));
  adSyncQueue.process(async () => auditContext.runAsSystem(() => runAdSync()));
  backupQueue.process(async (job) => auditContext.runAsSystem(() => runBackupJob(job.data as { triggeredBy?: string })));

  allQueues.forEach((q) =>
    q.on('failed', (job, err) => logger.error(`Job ${q.name}#${job?.id} failed`, { err: err.message })),
  );

  try {
    const ldapCron = (await getConfig('ldap.sync_cron')) || '0 2 * * *';
    await adSyncQueue.add({}, { repeat: { cron: ldapCron }, removeOnComplete: true, removeOnFail: 50 });
    await refresherQueue.add({}, { repeat: { cron: '0 3 * * *' }, removeOnComplete: true, removeOnFail: 50 });
    await dueReminderQueue.add({}, { repeat: { cron: '0 6 * * *' }, removeOnComplete: true, removeOnFail: 50 });

    if (await getBool('backup.auto_enabled')) {
      const backupCron = (await getConfig('backup.cron_expression')) || '0 1 * * *';
      await backupQueue.add({ triggeredBy: 'SYSTEM' }, { repeat: { cron: backupCron }, removeOnComplete: true, removeOnFail: 50 });
    }
    logger.info('Background jobs registered.');
  } catch (err) {
    logger.error('Failed to schedule repeatable jobs', { err: (err as Error).message });
  }
}

export async function stopJobs(): Promise<void> {
  await Promise.all(allQueues.map((q) => q.close()));
}

export { emailQueue, adSyncQueue, refresherQueue, dueReminderQueue, backupQueue };
