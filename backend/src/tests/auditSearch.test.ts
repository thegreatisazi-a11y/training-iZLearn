import type { AuditTrail } from '@prisma/client';
import { matchesAuditSearch, type AuditSearchNames } from '../services/auditSearch';

const names: AuditSearchNames = {
  user: new Map([['user-2', 'Jane Trainer']]),
  department: new Map(),
  location: new Map(),
};

function row(overrides: Partial<AuditTrail & { entityLabel: string | null }> = {}) {
  return {
    id: 'audit-1', userId: 'user-1', userFullName: 'John Doe', userUsername: 'jdoe',
    action: 'UPDATE', entityType: 'TrainingMaterial', entityId: 'material-1',
    entityLabel: 'Safety handbook.pdf', oldValue: null,
    newValue: { approvedBy: 'user-2', originalFileName: 'Safety handbook.pdf' },
    reasonForChange: null, ipAddress: '192.0.2.1', userAgent: null,
    sessionId: null, timestamp: new Date('2026-10-23T10:20:30Z'),
    ...overrides,
  } as AuditTrail & { entityLabel: string | null };
}

describe('audit free-text search', () => {
  it('matches the displayed entity label, not just its stored model name', () => {
    expect(matchesAuditSearch(row(), 'Training Material', names)).toBe(true);
  });

  it('matches the displayed record name and change-detail values', () => {
    expect(matchesAuditSearch(row(), 'Safety handbook.pdf', names)).toBe(true);
    expect(matchesAuditSearch(row(), 'Jane Trainer', names)).toBe(true);
    expect(matchesAuditSearch(row(), 'Original File Name', names)).toBe(true);
  });

  it('searches new usernames and preserves legacy full-name search', () => {
    expect(matchesAuditSearch(row(), 'jdoe', names)).toBe(true);
    expect(matchesAuditSearch(row(), 'John Doe', names)).toBe(false);
    expect(matchesAuditSearch(row({ userUsername: null }), 'John Doe', names)).toBe(true);
  });

  it('does not search redacted credential fields', () => {
    expect(matchesAuditSearch(row({ newValue: { passwordHash: 'secret-hash' } }), 'secret-hash', names)).toBe(false);
  });
});
