/** Run in backend: npx tsx scripts/check-email.ts [--to address@example.com] */
import nodemailer from 'nodemailer';
import { prisma } from '../src/config/prisma';
import { getConfig } from '../src/services/systemConfig.service';
import { queueEmail } from '../src/services/email.service';
import { redis, redisReady } from '../src/config/redis';
import { allQueues } from '../src/jobs/queue';

async function main() {
  const values = await Promise.all(['smtp.host', 'smtp.port', 'smtp.user', 'smtp.password', 'smtp.from'].map(getConfig));
  const [host, portText, user, pass, from] = values;
  console.log('SMTP configuration:', { hostConfigured: !!host, senderConfigured: !!from, loginConfigured: !!user });
  const statuses = await prisma.emailNotificationLog.groupBy({ by: ['status'], _count: { _all: true } });
  console.log('Email log counts:', statuses.map((s) => ({ status: s.status, count: s._count._all })));
  if (!host || !from) throw new Error('Configure SMTP host and sender in System Configuration first.');
  const port = Number(portText || 587);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465,
    auth: user ? { user, pass } : undefined, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000 });
  try { await transport.verify(); } finally { transport.close(); }
  console.log('SMTP connection and authentication passed. This alone does not confirm inbox delivery.');
  const option = process.argv.indexOf('--to');
  if (option < 0) return;
  const to = process.argv[option + 1];
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Supply a valid address after --to.');
  for (let i = 0; i < 20 && !redisReady(); i++) await new Promise((resolve) => setTimeout(resolve, 250));
  if (!redisReady()) throw new Error('Redis is unavailable; no test email was queued.');
  const log = await queueEmail({ toEmail: to, type: 'deliveryTest', subject: 'izLearn email delivery test',
    html: '<p>This is the requested izLearn email delivery test. No account credentials are included.</p>' });
  if (!log) throw new Error('Test email was not queued.');
  console.log('Test queued. The backend must be running to process it.');
  for (let i = 0; i < 45; i++) {
    const current = await prisma.emailNotificationLog.findUniqueOrThrow({ where: { id: log.id } });
    if (current.status === 'SENT') {
      console.log('SENT: SMTP server accepted the test. Check the recipient inbox and spam folder to confirm delivery.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Test not SENT within 45 seconds. Check the email worker and email notification log for failures.');
}

main().catch((error) => {
  // Do not print transport errors or connection strings that may contain credentials.
  console.error('Email verification failed:', error instanceof Error && !('code' in error)
    ? error.message : 'Connection/authentication failed. Check SMTP settings and network access.');
  process.exitCode = 1;
}).finally(async () => {
  await Promise.allSettled(allQueues.map((q) => q.close()));
  redis.disconnect();
  await prisma.$disconnect();
});
