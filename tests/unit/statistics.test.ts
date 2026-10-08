import { describe, expect, it } from 'vitest';

import {
  applyStatisticsDeltas,
  calculateAccuracy,
  calculateAverageResponseTime,
  correctUnknownCompletionDelta,
  correctCompletionDelta,
  multipleChoiceErrorDeltas,
  reverseErrorDeltas,
  summarizeStatistics,
  typingErrorDeltas,
  unknownCompletionDelta,
} from '../../src/domain';

describe('statistics calculations', () => {
  it('returns a neutral accuracy when there are no attempts', () => {
    expect(calculateAccuracy({ correctCount: 0, errorCount: 0 })).toBeNull();
  });

  it('calculates accuracy from correct and error counts', () => {
    expect(calculateAccuracy({ correctCount: 3, errorCount: 1 })).toBe(75);
  });

  it('returns a neutral average when no questions are complete', () => {
    expect(
      calculateAverageResponseTime({
        totalCompletedQuestions: 0,
        totalResponseTimeMs: 0,
      }),
    ).toBeNull();
  });

  it('calculates average response time from completed questions', () => {
    expect(
      calculateAverageResponseTime({
        totalCompletedQuestions: 4,
        totalResponseTimeMs: 10_000,
      }),
    ).toBe(2_500);
  });

  it('accumulates questions, errors, response time, average, and accuracy', () => {
    const updated = applyStatisticsDeltas(
      [],
      [
        ...multipleChoiceErrorDeltas('expected', 'mistaken'),
        correctCompletionDelta('expected', 2_400),
        correctCompletionDelta('expected', 1_600),
      ],
      '2026-09-24T00:00:00.000Z',
    );
    const expected = updated.find((item) => item.cardId === 'expected');
    const mistaken = updated.find((item) => item.cardId === 'mistaken');

    expect(expected).toMatchObject({
      correctCount: 2,
      errorCount: 1,
      totalCompletedQuestions: 2,
      totalResponseTimeMs: 4_000,
      averageResponseTimeMs: 2_000,
      lastErrorAt: '2026-09-24T00:00:00.000Z',
    });
    expect(summarizeStatistics(expected!).accuracy).toBeCloseTo(66.666, 2);
    expect(mistaken).toMatchObject({
      correctCount: 0,
      errorCount: 1,
      totalCompletedQuestions: 0,
      averageResponseTimeMs: null,
    });
  });

  it('penalizes expected and mistaken Cards for a wrong distractor', () => {
    expect(multipleChoiceErrorDeltas('expected', 'mistaken')).toEqual([
      expect.objectContaining({ cardId: 'expected', errorCount: 1 }),
      expect.objectContaining({ cardId: 'mistaken', errorCount: 1 }),
    ]);
  });

  it('penalizes both Cards for another exact target typed as the answer', () => {
    expect(typingErrorDeltas('expected', 'mistaken')).toEqual([
      expect.objectContaining({ cardId: 'expected', errorCount: 1 }),
      expect.objectContaining({ cardId: 'mistaken', errorCount: 1 }),
    ]);
  });

  it('penalizes only the expected Card for a random typo', () => {
    expect(typingErrorDeltas('expected')).toEqual([
      expect.objectContaining({ cardId: 'expected', errorCount: 1 }),
    ]);
  });

  it('reverses only the rejected error before a manual correction', () => {
    const wrong = multipleChoiceErrorDeltas('expected', 'mistaken');
    const afterWrong = applyStatisticsDeltas(
      [],
      wrong,
      '2026-10-04T10:00:00.000Z',
    );
    const corrected = applyStatisticsDeltas(
      afterWrong,
      [
        ...reverseErrorDeltas(wrong),
        correctCompletionDelta('expected', 1_200),
      ],
      '2026-10-04T10:00:01.000Z',
    );

    expect(corrected.find((item) => item.cardId === 'expected')).toMatchObject({
      correctCount: 1,
      errorCount: 0,
      totalCompletedQuestions: 1,
      lastErrorAt: undefined,
    });
    expect(corrected.find((item) => item.cardId === 'mistaken')).toMatchObject({
      correctCount: 0,
      errorCount: 0,
      lastErrorAt: undefined,
    });
  });

  it('reclassifies I do not know without counting the completed question twice', () => {
    const afterUnknown = applyStatisticsDeltas(
      [],
      [unknownCompletionDelta('expected', 1_200)],
      '2026-10-06T10:00:00.000Z',
    );
    const corrected = applyStatisticsDeltas(
      afterUnknown,
      [correctUnknownCompletionDelta('expected')],
      '2026-10-06T10:00:01.000Z',
    );

    expect(corrected[0]).toMatchObject({
      correctCount: 1,
      errorCount: 0,
      totalCompletedQuestions: 1,
      totalResponseTimeMs: 1_200,
      lastErrorAt: undefined,
    });
  });
});
