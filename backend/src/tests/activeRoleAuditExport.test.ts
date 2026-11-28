import express from 'express';
import request from 'supertest';
import { exportAudit } from '../controllers/auditTrail.controller';
import { queryAuditTrail } from '../services/auditTrail.service';

jest.mock('../config/prisma', () => ({ prisma: {
  user: { findMany: jest.fn(async () => []) }, department: { findMany: jest.fn(async () => []) },
  location: { findMany: jest.fn(async () => []) }, role: { findMany: jest.fn(async () => []) },
  trainingTopic: { findMany: jest.fn(async () => []) }, designationMaster: { findMany: jest.fn(async () => []) },
} }));
jest.mock('../services/auditTrail.service', () => ({ queryAuditTrail: jest.fn(), recordEvent: jest.fn() }));
jest.mock('../services/systemConfig.service', () => ({ getOrgInfo: jest.fn(async () => ({ name: 'Test Company', timezone: 'Asia/Kolkata' })) }));
jest.mock('../utils/pdfGenerator', () => ({}));
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { fullName: 'Admin' } as any; next(); });
app.post('/export', exportAudit);

it('exports role-name snapshots and labels historical role context as unavailable', async () => {
  const base = { timestamp: new Date('2026-11-27T09:00:00Z'), userUsername: 'darshit', userFullName: 'Darshit Shah', action: 'LOGIN', entityType: 'User', entityId: null, entityLabel: 'Darshit Shah', oldValue: null, newValue: null };
  jest.mocked(queryAuditTrail).mockResolvedValue({ data: [{ ...base, activeRoleName: 'Trainer' }, { ...base, activeRoleName: null }] as any, total: 2, page: 1, pageSize: 2000 });
  const result = await request(app).post('/export').send({ format: 'csv' });
  expect(result.status).toBe(200);
  expect(result.text).toContain('Active Role');
  expect(result.text).toContain('Trainer');
  expect(result.text).toContain('Role context unavailable');
});
