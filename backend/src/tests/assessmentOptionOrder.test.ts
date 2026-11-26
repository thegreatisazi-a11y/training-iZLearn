import { startAttempt } from '../services/assessment.service';
import { prisma } from '../config/prisma';
import { gradeQuestion } from '../utils/grading';

jest.mock('../config/prisma', () => ({ prisma: {
  trainingTopic: { findFirst: jest.fn() }, trainingAssignment: { findMany: jest.fn() },
  assessmentAttempt: { findMany: jest.fn(), create: jest.fn() }, question: { findMany: jest.fn() },
} }));
jest.mock('../services/systemConfig.service', () => ({ getNumber: jest.fn().mockResolvedValue(3), getBool: jest.fn().mockResolvedValue(false) }));
jest.mock('../services/auditTrail.service', () => ({ recordEvent: jest.fn() }));
jest.mock('../services/eSignature.service', () => ({}));
jest.mock('../services/notification.service', () => ({}));
jest.mock('../services/certificate.service', () => ({}));
jest.mock('../services/materialView.service', () => ({ hasCompletedRequiredReading: jest.fn().mockResolvedValue(true) }));

const options = [{ id: 'a', text: 'First' }, { id: 'b', text: 'Second' }, { id: 'c', text: 'All of the above' }];
const db = prisma as any;
beforeEach(() => {
  jest.clearAllMocks();
  db.trainingTopic.findFirst.mockResolvedValue({ id: 'course', status: 'PUBLISHED', currentVersion: 1, maxAttempts: 3, randomizeQuestions: true, questionLimit: 3 });
  db.trainingAssignment.findMany.mockResolvedValue([]);
  db.assessmentAttempt.findMany.mockResolvedValue([]);
  db.assessmentAttempt.create.mockResolvedValue({ id: 'attempt' });
  jest.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => jest.restoreAllMocks());

it.each(['MULTIPLE_CHOICE_SINGLE', 'MULTIPLE_CHOICE_MULTI'])('shuffles questions but preserves %s options, including legacy shuffle flags', async (questionType) => {
  const questions = [true, false, undefined].map((shuffleOptions, i) => ({
    id: `q${i}`, questionType, questionText: `Question ${i}`, isMandatory: true,
    options, shuffleOptions, correctAnswer: ['c'], explanation: null,
  }));
  db.question.findMany.mockResolvedValue(questions);
  const result = await startAttempt('user', 'course');
  expect(result.questions.map((q) => q.id)).not.toEqual(questions.map((q) => q.id));
  for (const question of result.questions) {
    expect(question.options).toEqual(options);
    expect(question).not.toHaveProperty('correctAnswer');
  }
  const snapshot = db.assessmentAttempt.create.mock.calls[0][0].data.questionsUsed;
  expect(snapshot.every((q: any) => JSON.stringify(q.options) === JSON.stringify(options))).toBe(true);
  expect(snapshot.every((q: any) => gradeQuestion(q, questionType === 'MULTIPLE_CHOICE_SINGLE' ? 'c' : ['c']))).toBe(true);
  expect(questions.map((q) => q.options)).toEqual([options, options, options]);
});

it('preserves question order when question randomization is disabled', async () => {
  db.trainingTopic.findFirst.mockResolvedValue({ status: 'PUBLISHED', currentVersion: 1, maxAttempts: 3, randomizeQuestions: false, questionLimit: 3 });
  db.question.findMany.mockResolvedValue([0, 1, 2].map((i) => ({ id: `q${i}`, questionType: 'TRUE_FALSE', questionText: 'True?', isMandatory: true, options: null, correctAnswer: 'true' })));
  const result = await startAttempt('user', 'course');
  expect(result.questions.map((q) => q.id)).toEqual(['q0', 'q1', 'q2']);
});

it('continues hiding correct matching pairs from the client', async () => {
  db.question.findMany.mockResolvedValue([{
    id: 'matching', questionType: 'MATCH_THE_WORDS', questionText: 'Match', isMandatory: true,
    options: { matchPairs: [{ left: 'A', right: 'One' }, { left: 'B', right: 'Two' }] },
    correctAnswer: [{ left: 'A', right: 'One' }, { left: 'B', right: 'Two' }],
  }]);
  const result = await startAttempt('user', 'course');
  expect(result.questions[0].options).toEqual({ lefts: ['A', 'B'], rights: ['Two', 'One'] });
  expect(result.questions[0]).not.toHaveProperty('correctAnswer');
});
