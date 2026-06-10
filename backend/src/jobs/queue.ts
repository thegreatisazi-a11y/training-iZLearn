import Queue from 'bull';
import { env } from '../config/env';

/**
 * Bull queues (Module 10/16). All share the Redis backend. Job *processing* is
 * wired in jobs/index.ts; this module only declares the queues so services can
 * enqueue work without importing the processors (avoids circular imports).
 */
const connection = env.redis.url;

export const emailQueue = new Queue('email', connection);
export const adSyncQueue = new Queue('ad-sync', connection);
export const refresherQueue = new Queue('refresher-check', connection);
export const dueReminderQueue = new Queue('due-reminder', connection);
export const backupQueue = new Queue('db-backup', connection);

export const allQueues = [emailQueue, adSyncQueue, refresherQueue, dueReminderQueue, backupQueue];

export interface EmailJobData {
  logId: string;
  to: string;
  subject: string;
  html: string;
}
