import { withholdAnswerKey, maySeeAnswerKey } from '../utils/answerKey';

/**
 * The answer key must not reach a learner who can still re-attempt the assessment.
 *
 * This is enforced server-side in two places (submitAttempt and reviewAttempt). Without
 * these tests, deleting it from either would be completely silent — the code would still
 * compile, build and pass every other suite while the key leaked into the API response,
 * where it is readable in devtools whether or not the page renders it.
 */
describe('maySeeAnswerKey', () => {
  it('withholds it from a learner who failed their own attempt', () => {
    expect(maySeeAnswerKey(true, false)).toBe(false);
  });

  it('reveals it to a learner who passed — no further attempt is possible', () => {
    expect(maySeeAnswerKey(true, true)).toBe(true);
  });

  it('reveals it to a manager reviewing someone else, pass or fail', () => {
    expect(maySeeAnswerKey(false, false)).toBe(true);
    expect(maySeeAnswerKey(false, true)).toBe(true);
  });
});

describe('withholdAnswerKey', () => {
  const details = () => [
    { questionId: 'q1', isCorrect: false, userAnswer: 'a', correctAnswer: 'b', explanation: 'because b' },
    { questionId: 'q2', isCorrect: true, userAnswer: 'c', correctAnswer: 'c', explanation: 'because c' },
  ];

  it('strips the correct answer AND the explanation when not revealing', () => {
    const d = details();
    withholdAnswerKey(d, false);
    expect(d.map((x) => x.correctAnswer)).toEqual([null, null]);
    // The explanation goes too — it states the answer in prose.
    expect(d.map((x) => x.explanation)).toEqual([null, null]);
  });

  it('keeps the feedback the learner is entitled to', () => {
    const d = details();
    withholdAnswerKey(d, false);
    // Which questions were wrong, and what they themselves answered, must survive.
    expect(d.map((x) => x.isCorrect)).toEqual([false, true]);
    expect(d.map((x) => x.userAnswer)).toEqual(['a', 'c']);
    expect(d.map((x) => x.questionId)).toEqual(['q1', 'q2']);
  });

  it('leaves everything intact when revealing', () => {
    const d = details();
    withholdAnswerKey(d, true);
    expect(d[0].correctAnswer).toBe('b');
    expect(d[0].explanation).toBe('because b');
  });

  it('mutates in place, so an array sharing the same objects is covered too', () => {
    // submitAttempt/reviewAttempt push the incorrect details into a SECOND array by
    // reference; one pass must cover both or the key leaks through incorrectDetails.
    const all = details();
    const incorrect = all.filter((x) => !x.isCorrect);
    withholdAnswerKey(all, false);
    expect(incorrect[0].correctAnswer).toBeNull();
    expect(incorrect[0].explanation).toBeNull();
  });
});
