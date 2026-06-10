import { loginSchema, pastOrPresentDate, passwordPolicy, createScheduleSchema } from '@izlearn/shared';

describe('shared Zod validation (used identically on FE & BE)', () => {
  it('login requires username and password', () => {
    expect(loginSchema.safeParse({ windowsUsername: '', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ windowsUsername: 'jdoe', password: 'secret' }).success).toBe(true);
  });

  it('rejects future dates (no-future rule §6)', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(pastOrPresentDate.safeParse(future).success).toBe(false);
    expect(pastOrPresentDate.safeParse(new Date('2020-01-01')).success).toBe(true);
  });

  it('enforces password complexity', () => {
    expect(passwordPolicy(8).safeParse('weak').success).toBe(false);
    expect(passwordPolicy(8).safeParse('Abcd123!').success).toBe(true);
  });

  it('parses a valid training schedule payload', () => {
    const r = createScheduleSchema.safeParse({
      topicId: '11111111-1111-1111-1111-111111111111',
      scheduledDate: '2030-01-01T09:00:00.000Z',
      trainerId: '22222222-2222-2222-2222-222222222222',
      trainingType: 'CLASSROOM',
      traineeIds: ['33333333-3333-3333-3333-333333333333'],
    });
    expect(r.success).toBe(true);
  });
});
