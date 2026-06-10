/**
 * Pure assessment-grading logic (no I/O) — extracted so it can be unit-tested
 * in isolation and reused by the assessment service.
 */

export interface GradableQuestion {
  questionType: string;
  correctAnswer: unknown;
}

export function normalizeAnswer(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

/** Grade a single answer against its question definition. Returns true if correct. */
export function gradeQuestion(q: GradableQuestion, userAnswer: unknown): boolean {
  const correct = q.correctAnswer;
  switch (q.questionType) {
    case 'MULTIPLE_CHOICE_SINGLE':
    case 'TRUE_FALSE': {
      const expected = Array.isArray(correct) ? correct[0] : correct;
      return normalizeAnswer(userAnswer) === normalizeAnswer(expected);
    }
    case 'MULTIPLE_CHOICE_MULTI': {
      const expected = (Array.isArray(correct) ? correct : [correct]).map(normalizeAnswer).sort();
      const given = (Array.isArray(userAnswer) ? userAnswer : [userAnswer]).map(normalizeAnswer).sort();
      return expected.length === given.length && expected.every((v, i) => v === given[i]);
    }
    case 'FILL_IN_THE_BLANKS': {
      const variants = (Array.isArray(correct) ? correct : [correct]).map(normalizeAnswer);
      return variants.includes(normalizeAnswer(userAnswer));
    }
    case 'MATCH_THE_WORDS': {
      const pairs = (Array.isArray(correct) ? correct : []) as Array<{ left: string; right: string }>;
      const ua = (userAnswer ?? {}) as Record<string, string>;
      return pairs.length > 0 && pairs.every((p) => normalizeAnswer(ua[p.left]) === normalizeAnswer(p.right));
    }
    default:
      return false;
  }
}
