/**
 * Whether a learner may see the answer key for their own assessment attempt.
 *
 * Rule: only after they have PASSED. While an attempt is a failure the assessment can be
 * re-attempted — a block is not final, the learner can request an unblock — and a retake
 * substantially reuses the same questions: `startAttempt` includes every mandatory question
 * in every attempt, and with `randomizeQuestions` off the whole paper repeats. Revealing the
 * key would let them learn the answers between attempts. Passing closes that door, because
 * `startAttempt` refuses a fresh attempt once the current version is passed, so the feedback
 * is then purely useful.
 *
 * A manager reviewing SOMEONE ELSE's attempt always sees the full breakdown — that is the
 * point of coordinator review.
 *
 * This lives in its own dependency-free module so the rule can be unit-tested. It is enforced
 * in two places (`submitAttempt` and `reviewAttempt`) and deleting it from either would
 * otherwise be silent: the code would still compile, build and pass every other test while
 * the key leaked into the API response.
 */

/** Just the fields of a QuestionResult this rule touches. */
export interface AnswerKeyBearing {
  correctAnswer?: unknown;
  explanation?: string | null;
}

/**
 * Strip the answer key from each detail unless `reveal` is true.
 *
 * Mutates in place and returns the same array. That is deliberate: callers build one array of
 * detail objects and push the incorrect ones into a second array BY REFERENCE, so mutating
 * covers both without having to keep them in sync.
 *
 * The explanation goes with the answer: an explanation almost always states the correct answer
 * in prose ("the correct procedure is to purge the line first because…"), so keeping it would
 * reopen the door the answer key closed.
 */
export function withholdAnswerKey<T extends AnswerKeyBearing>(details: T[], reveal: boolean): T[] {
  if (reveal) return details;
  for (const d of details) {
    d.correctAnswer = null;
    d.explanation = null;
  }
  return details;
}

/**
 * May this viewer see the answer key for this attempt?
 *
 * `isOwnAttempt` false means a manager is reviewing another user's attempt.
 */
export function maySeeAnswerKey(isOwnAttempt: boolean, isPassed: boolean): boolean {
  return !isOwnAttempt || isPassed;
}
