import { describe, expect, it } from 'vitest';
import { changeSummary } from './AuditTrailPage';

type AuditEntry = Parameters<typeof changeSummary>[0];

const baseEntry = {
  id: 'audit-1', timestamp: '2026-10-26T12:00:00.000Z', userFullName: 'Admin',
  action: 'UPDATE', entityType: 'TrainingAssignment', entityId: 'assignment-1', reasonForChange: 'Role exception',
} satisfies Omit<AuditEntry, 'oldValue' | 'newValue'>;

describe('training exception audit change details', () => {
  it('shows the status and reason from an older partial not-required audit without false deletions', () => {
    const summary = changeSummary({
      ...baseEntry,
      oldValue: { id: 'assignment-1', userId: 'user-1', topicId: 'course-1', status: 'PENDING', assignedBy: 'admin-1' },
      newValue: { status: 'NOT_REQUIRED', notRequiredReason: 'Role exception' },
    });

    expect(summary).toContain('Status: Pending → Not Required');
    expect(summary).toContain('Not Required Reason: ∅ → Role exception');
    expect(summary).not.toContain('User:');
    expect(summary).not.toContain('Assigned By:');
  });

  it('shows the status from an older partial restore audit', () => {
    const summary = changeSummary({
      ...baseEntry,
      oldValue: { id: 'assignment-1', userId: 'user-1', status: 'NOT_REQUIRED', notRequiredReason: 'Role exception' },
      newValue: { status: 'PENDING' },
    });

    expect(summary).toBe('Status: Not Required → Pending');
  });

  it('compares complete snapshots for new audit rows', () => {
    const summary = changeSummary({
      ...baseEntry,
      oldValue: { id: 'assignment-1', userId: 'user-1', status: 'PENDING', notRequiredReason: null },
      newValue: { id: 'assignment-1', userId: 'user-1', status: 'NOT_REQUIRED', notRequiredReason: 'Role exception' },
    });

    expect(summary).toContain('Status: Pending → Not Required');
    expect(summary).toContain('Not Required Reason: ∅ → Role exception');
    expect(summary).not.toContain('User:');
  });
});
