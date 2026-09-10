import { applicableExtraAttempts, effectiveMaxAttempts, attemptsUsed } from '../utils/attemptAllowance';

/**
 * Regression tests for the attempt-count defect where a learner who had used 4 of an
 * allowed 4 attempts saw "Attempt 4 of 2" while their supervisor saw "6 / 4" — three
 * different counts against two different denominators, none of which matched the limit
 * the server enforced.
 */
describe('applicableExtraAttempts', () => {
  it('applies a grant made for the version being assessed', () => {
    expect(applicableExtraAttempts([{ extraAttempts: 2, extraAttemptsVersion: 3 }], 3)).toBe(2);
  });

  it('ignores a grant made for an earlier version', () => {
    // The bug: a grant on v2 kept applying on v3, which already gets a fresh allowance —
    // so v3 silently allowed maxAttempts + the stale offset, i.e. double.
    expect(applicableExtraAttempts([{ extraAttempts: 2, extraAttemptsVersion: 2 }], 3)).toBe(0);
  });

  it('ignores an unstamped legacy grant, whose version is unknown', () => {
    expect(applicableExtraAttempts([{ extraAttempts: 2 }], 3)).toBe(0);
    expect(applicableExtraAttempts([{ extraAttempts: 2, extraAttemptsVersion: null }], 3)).toBe(0);
  });

  it('takes the largest matching grant when a user holds several assignments', () => {
    expect(
      applicableExtraAttempts(
        [
          { extraAttempts: 1, extraAttemptsVersion: 3 },
          { extraAttempts: 4, extraAttemptsVersion: 3 },
          { extraAttempts: 9, extraAttemptsVersion: 2 },
        ],
        3,
      ),
    ).toBe(4);
  });

  it('grants nothing when the course version is unknown', () => {
    expect(applicableExtraAttempts([{ extraAttempts: 2, extraAttemptsVersion: 3 }], null)).toBe(0);
  });
});

describe('effectiveMaxAttempts', () => {
  it('is the raw maximum when no grant applies', () => {
    expect(effectiveMaxAttempts(2, [], 3)).toBe(2);
  });

  it('adds a grant made for this version — the real CVT-1 case', () => {
    // maxAttempts 2, blocked after 2 on v3, retake granted (offset = 2 used) => 4 allowed.
    expect(effectiveMaxAttempts(2, [{ extraAttempts: 2, extraAttemptsVersion: 3 }], 3)).toBe(4);
  });

  it('does not carry a v2 grant into v3', () => {
    expect(effectiveMaxAttempts(2, [{ extraAttempts: 2, extraAttemptsVersion: 2 }], 3)).toBe(2);
  });

  it('treats a missing maximum as zero rather than NaN', () => {
    expect(effectiveMaxAttempts(null, [], 3)).toBe(0);
    expect(effectiveMaxAttempts(undefined, [{ extraAttempts: 2, extraAttemptsVersion: 3 }], 3)).toBe(2);
  });
});

describe('attemptsUsed', () => {
  // The exact attempt history behind the "6 / 4" report.
  const cvt1 = [
    { topicVersion: 2, completedAt: new Date() },
    { topicVersion: 2, completedAt: new Date() },
    { topicVersion: 3, completedAt: new Date() },
    { topicVersion: 3, completedAt: new Date() },
    { topicVersion: 3, completedAt: new Date() },
    { topicVersion: 3, completedAt: new Date() },
  ];

  it('counts only the current version — 4 on v3, not 6 overall', () => {
    expect(attemptsUsed(cvt1, 3)).toBe(4);
    expect(attemptsUsed(cvt1, 2)).toBe(2);
  });

  it('ignores attempts that are still open', () => {
    expect(attemptsUsed([{ topicVersion: 3, completedAt: null }], 3)).toBe(0);
  });

  it('counts a completed attempt whatever ended it, technical failures included', () => {
    // Deliberate policy: a system failure consumes an attempt and the reason is recorded,
    // so a supervisor decides on an unblock rather than the system forgiving it silently.
    const withTechnicalFailure = [
      { topicVersion: 1, completedAt: new Date() },
      { topicVersion: 1, completedAt: new Date() },
    ];
    expect(attemptsUsed(withTechnicalFailure, 1)).toBe(2);
  });
});
