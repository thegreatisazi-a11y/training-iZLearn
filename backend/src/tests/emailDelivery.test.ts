import net from 'net';
import type { AddressInfo } from 'net';
import { sendQueuedEmail } from '../services/email.service';
import { prisma } from '../config/prisma';
import { getConfig } from '../services/systemConfig.service';
import { renderEmail } from '../utils/emailTemplates';

jest.mock('../config/prisma', () => ({ prisma: { emailNotificationLog: { update: jest.fn() } } }));
jest.mock('../services/systemConfig.service', () => ({ getConfig: jest.fn(), getNumber: jest.fn(async () => port) }));
jest.mock('../jobs/queue', () => ({ emailQueue: { add: jest.fn() } }));
jest.mock('../config/redis', () => ({ redisReady: () => true }));

let port = 0;

it('delivers a rendered welcome email to a local SMTP capture server and records SENT', async () => {
  let captured = '';
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost test SMTP\r\n');
    let pending = '';
    let inData = false;
    socket.on('data', (data) => {
      pending += data.toString();
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n');
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (inData) {
          if (line === '.') { inData = false; socket.write('250 Accepted\r\n'); }
          else captured += `${line}\r\n`;
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n');
        else if (/^DATA/.test(line)) { inData = true; socket.write('354 Send message\r\n'); }
        else if (/^QUIT/.test(line)) socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    port = (server.address() as AddressInfo).port;
    jest.mocked(getConfig).mockImplementation(async (key) => ({
      'smtp.host': '127.0.0.1', 'smtp.from': 'izLearn <sender@example.test>', 'smtp.user': '', 'smtp.password': '',
    })[key] ?? '');
    const rendered = renderEmail('accountCreated', 'Test Company', { userName: 'Test Employee', username: 'test.employee', tempPassword: 'test-only-password' });
    await sendQueuedEmail({ logId: 'test-log', to: 'recipient@example.test', subject: rendered.subject, html: rendered.html });
    expect(captured).toContain('recipient@example.test');
    // SMTP encodes long HTML lines using quoted-printable soft line breaks.
    const decoded = captured.replace(/=\r\n/g, '');
    expect(decoded).toContain('test.employee');
    expect(decoded).toContain('test-only-password');
    expect(prisma.emailNotificationLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'test-log' }, data: expect.objectContaining({ status: 'SENT' }),
    }));
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
