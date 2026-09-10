/**
 * The ONE definition of "how many assessment attempts does this learner get".
 *
 * There used to be three different counts and two different denominators in the codebase,
 * and no two agreed. A learner who had used 4 of an allowed 4 attempts saw "Attempt 4 of 2"
 * on their result screen while their supervisor saw "6 / 4" — neither matched the limit the
 * server actually enforced. Every place that shows or enforces an attempt limit now goes
 * through this file.
 *
 * The rules, all of which are scoped to the course's CURRENT VERSION:
 *
 *  - A revision resets the allowance. `startAttempt` has always scoped its limit to
 *    `topicVersion`, so re-training on a revised course starts from a clean slate.
 *  - `extraAttempts` is a HIGH-WATER OFFSET, not a number of spare attempts: an approved
 *    retake sets it to the attempts used so far, so `maxAttempts + extraAttempts` grants a
 *    fresh full allowance. It therefore only makes sense against the version it was granted
 *    for, which `extraAttemptsVersion` records.
 *  - EVERY completed attempt counts, including ones that ended in a technical failure.
 *    The reason is still recorded (see `failureReasonIsTechnical`, used by the audit trail)
 *    so a supervisor can see it was not the learner's fault and approve an unblock — but it
 *    is their decision to make, not an automatic exemption. This replaced an earlier rule
 *    that silently forgave ABANDONED and SYSTEM_FAILURE, which meant the number shown to
 *    the learner and the number the gate enforced could differ.
 */

/** Just enough of a TrainingAssignment to read a grant off it. */
export interface AttemptGrant {
  extraAttempts?: number | null;
  extraAttemptsVersion?: number | null;
}

/**
 * Extra attempts that still apply, i.e. those granted for the version being assessed.
 *
 * A grant with no recorded version does NOT apply: it predates version stamping, so which
 * version it was for is unknown. That is safe — the learner still gets the current version's
 * full fresh allowance; they just don't get it twice.
 */
export function applicableExtraAttempts(grants: AttemptGrant[], currentVersion: number | null | undefined): number {
  if (currentVersion == null) return 0;
  let extra = 0;
  for (const g of grants) {
    if (g.extraAttemptsVersion === currentVersion) extra = Math.max(extra, g.extraAttempts ?? 0);
  }
  return extra;
}

/** The attempt limit actually enforced for this course version. */
export function effectiveMaxAttempts(
  maxAttempts: number | null | undefined,
  grants: AttemptGrant[],
  currentVersion: number | null | undefined,
): number {
  return (maxAttempts ?? 0) + applicableExtraAttempts(grants, currentVersion);
}

/** Just enough of an AssessmentAttempt to count it. */
export interface CountableAttempt {
  topicVersion?: number | null;
  completedAt?: Date | null;
}

/**
 * Attempts consumed against the current version's allowance.
 *
 * Counts every COMPLETED attempt on that version, whatever its submission reason — see the
 * note at the top of this file. An attempt that is still open is not counted; `startAttempt`
 * finalizes abandoned ones before it counts, so nothing escapes by being left unfinished.
 */
export function attemptsUsed(attempts: CountableAttempt[], currentVersion: number | null | undefined): number {
  return attempts.filter((a) => a.completedAt && a.topicVersion === currentVersion).length;
}
