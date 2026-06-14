import nodemailer, { Transporter } from 'nodemailer';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { auditContext } from '../utils/auditContext';
import { getConfig, getNumber } from './systemConfig.service';
import { emailQueue, EmailJobData } from '../jobs/queue';
import { redisReady } from '../config/redis';

export interface QueueEmailInput {
  userId?: string | null;
  toEmail: string;
  type: string;
  subject: string;
  html: string;
  scheduledAt?: Date;
}

/**
 * Queue an email: log it (EmailNotificationLog = QUEUED) and enqueue a Bull job.
 * Every email the system sends is therefore auditable (Module 10).
 */
export async function queueEmail(input: QueueEmailInput) {
  if (!input.toEmail) return null;
  const createdBy = auditContext.getStore()?.actor.userId ?? 'SYSTEM';
  const log = await prisma.emailNotificationLog.create({
    data: {
      userId: input.userId ?? null,
      toEmail: input.toEmail,
      type: input.type,
      subject: input.subject,
      status: 'QUEUED',
      scheduledAt: input.scheduledAt ?? null,
      createdBy,
    },
  });

  // Enqueue the Bull job — but never let a down/unreachable Redis block the request.
  // The EmailNotificationLog row above is the durable audit record; if Redis is
  // unavailable the job is simply not scheduled (best-effort, per Module 10).
  if (redisReady()) {
    const delay = input.scheduledAt ? Math.max(0, input.scheduledAt.getTime() - Date.now()) : 0;
    try {
      await emailQueue.add(
        'send',
        { logId: log.id, to: input.toEmail, subject: input.subject, html: input.html } as EmailJobData,
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, delay, removeOnComplete: 500, removeOnFail: 1000 },
      );
    } catch (err) {
      logger.warn(`Email job not enqueued (Redis error): ${(err as Error).message}. Logged in DB as QUEUED.`);
    }
  } else {
    logger.warn('Email job not enqueued: Redis unavailable. Logged in DB as QUEUED.');
  }
  return log;
}

let transporter: Transporter | null = null;
let transporterKey = '';

async function getTransporter(): Promise<Transporter> {
  const host = await getConfig('smtp.host');
  const port = await getNumber('smtp.port', 587);
  const user = await getConfig('smtp.user');
  const pass = await getConfig('smtp.password');
  const key = `${host}:${port}:${user}`;
  if (transporter && key === transporterKey) return transporter;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
  transporterKey = key;
  return transporter;
}

/** Called by the email job processor. Sends and records SENT/FAILED. */
export async function sendQueuedEmail(data: EmailJobData): Promise<void> {
  try {
    const from = (await getConfig('smtp.from')) || 'izLearn <no-reply@example.com>';
    const tx = await getTransporter();
    await tx.sendMail({ from, to: data.to, subject: data.subject, html: data.html });
    await prisma.emailNotificationLog.update({ where: { id: data.logId }, data: { status: 'SENT', sentAt: new Date() } });
  } catch (err) {
    logger.error('Email send failed', { logId: data.logId, err: (err as Error).message });
    await prisma.emailNotificationLog.update({
      where: { id: data.logId },
      data: { status: 'FAILED', errorMsg: (err as Error).message },
    });
    throw err;
  }
}
