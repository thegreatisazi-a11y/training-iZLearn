import { gradeQuestion } from '../utils/grading';

describe('assessment grading (Module 7)', () => {
  it('grades single-choice questions', () => {
    expect(gradeQuestion({ questionType: 'MULTIPLE_CHOICE_SINGLE', correctAnswer: ['a'] }, 'a')).toBe(true);
    expect(gradeQuestion({ questionType: 'MULTIPLE_CHOICE_SINGLE', correctAnswer: ['a'] }, 'b')).toBe(false);
  });

  it('grades multi-choice regardless of order', () => {
    expect(gradeQuestion({ questionType: 'MULTIPLE_CHOICE_MULTI', correctAnswer: ['a', 'b'] }, ['b', 'a'])).toBe(true);
    expect(gradeQuestion({ questionType: 'MULTIPLE_CHOICE_MULTI', correctAnswer: ['a', 'b'] }, ['a'])).toBe(false);
  });

  it('grades true/false', () => {
    expect(gradeQuestion({ questionType: 'TRUE_FALSE', correctAnswer: 'true' }, 'TRUE')).toBe(true);
    expect(gradeQuestion({ questionType: 'TRUE_FALSE', correctAnswer: 'true' }, 'false')).toBe(false);
  });

  it('grades fill-in-the-blanks with accepted variants, case/space insensitive', () => {
    expect(gradeQuestion({ questionType: 'FILL_IN_THE_BLANKS', correctAnswer: ['Paris', 'paris'] }, '  PARIS ')).toBe(true);
    expect(gradeQuestion({ questionType: 'FILL_IN_THE_BLANKS', correctAnswer: ['Paris'] }, 'London')).toBe(false);
  });

  it('grades match-the-words pairs', () => {
    const q = { questionType: 'MATCH_THE_WORDS', correctAnswer: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }] };
    expect(gradeQuestion(q, { a: '1', b: '2' })).toBe(true);
    expect(gradeQuestion(q, { a: '2', b: '1' })).toBe(false);
  });
});
