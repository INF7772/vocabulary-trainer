import type { GlobalCardStatistics, Timestamp } from './models';
import {
  calculateAccuracy,
  calculateAverageResponseTime,
} from './statistics';

export interface StatisticsDelta {
  cardId: string;
  correctCount: number;
  errorCount: number;
  completedQuestions: number;
  responseTimeMs: number;
}

export interface StatisticsSummary extends GlobalCardStatistics {
  accuracy: number | null;
}

export function emptyStatistics(
  cardId: string,
  updatedAt: Timestamp,
): GlobalCardStatistics {
  return {
    cardId,
    correctCount: 0,
    errorCount: 0,
    totalCompletedQuestions: 0,
    totalResponseTimeMs: 0,
    averageResponseTimeMs: null,
    updatedAt,
  };
}

export function errorDelta(cardId: string): StatisticsDelta {
  return {
    cardId,
    correctCount: 0,
    errorCount: 1,
    completedQuestions: 0,
    responseTimeMs: 0,
  };
}

export function correctCompletionDelta(
  cardId: string,
  responseTimeMs: number,
): StatisticsDelta {
  return {
    cardId,
    correctCount: 1,
    errorCount: 0,
    completedQuestions: 1,
    responseTimeMs: validateResponseTime(responseTimeMs),
  };
}

export function giveUpCompletionDelta(
  cardId: string,
  responseTimeMs: number,
): StatisticsDelta {
  return {
    cardId,
    correctCount: 0,
    errorCount: 0,
    completedQuestions: 1,
    responseTimeMs: validateResponseTime(responseTimeMs),
  };
}

export function unknownCompletionDelta(
  cardId: string,
  responseTimeMs: number,
): StatisticsDelta {
  return {
    cardId,
    correctCount: 0,
    errorCount: 1,
    completedQuestions: 1,
    responseTimeMs: validateResponseTime(responseTimeMs),
  };
}

/** Reclassifies an already persisted unknown completion as correct. */
export function correctUnknownCompletionDelta(
  cardId: string,
  unknownErrorCount = 1,
): StatisticsDelta {
  if (!Number.isInteger(unknownErrorCount) || unknownErrorCount < 0) {
    throw new Error('Unknown error count must be a non-negative integer.');
  }
  return {
    cardId,
    correctCount: 1,
    errorCount: -unknownErrorCount,
    completedQuestions: 0,
    responseTimeMs: 0,
  };
}

/** Compensates a just-recorded rejected answer before a manual correction. */
export function reverseErrorDeltas(
  deltas: readonly StatisticsDelta[],
): StatisticsDelta[] {
  return deltas
    .filter((delta) => delta.errorCount > 0)
    .map((delta) => ({
      cardId: delta.cardId,
      correctCount: 0,
      errorCount: -delta.errorCount,
      completedQuestions: 0,
      responseTimeMs: 0,
    }));
}

export function multipleChoiceErrorDeltas(
  expectedCardId: string,
  mistakenCardId: string,
): StatisticsDelta[] {
  return expectedCardId === mistakenCardId
    ? [errorDelta(expectedCardId)]
    : [errorDelta(expectedCardId), errorDelta(mistakenCardId)];
}

export function typingErrorDeltas(
  expectedCardId: string,
  mistakenCardId?: string,
): StatisticsDelta[] {
  return mistakenCardId
    ? multipleChoiceErrorDeltas(expectedCardId, mistakenCardId)
    : [errorDelta(expectedCardId)];
}

export function applyStatisticsDelta(
  current: GlobalCardStatistics | undefined,
  delta: StatisticsDelta,
  updatedAt: Timestamp,
): GlobalCardStatistics {
  validateDelta(delta);
  const base = current ?? emptyStatistics(delta.cardId, updatedAt);

  if (base.cardId !== delta.cardId) {
    throw new Error('Statistics delta Card does not match the record Card.');
  }

  const updated: GlobalCardStatistics = {
    ...base,
    correctCount: base.correctCount + delta.correctCount,
    errorCount: base.errorCount + delta.errorCount,
    totalCompletedQuestions:
      base.totalCompletedQuestions + delta.completedQuestions,
    totalResponseTimeMs: base.totalResponseTimeMs + delta.responseTimeMs,
    averageResponseTimeMs: null,
    lastErrorAt:
      delta.errorCount > 0
        ? updatedAt
        : delta.errorCount < 0 && base.errorCount + delta.errorCount === 0
          ? undefined
          : base.lastErrorAt,
    updatedAt,
  };

  if (
    updated.correctCount < 0 ||
    updated.errorCount < 0 ||
    updated.totalCompletedQuestions < 0 ||
    updated.totalResponseTimeMs < 0
  ) {
    throw new Error('A statistics correction cannot make totals negative.');
  }

  return {
    ...updated,
    averageResponseTimeMs: calculateAverageResponseTime(updated),
  };
}

export function applyStatisticsDeltas(
  current: readonly GlobalCardStatistics[],
  deltas: readonly StatisticsDelta[],
  updatedAt: Timestamp,
): GlobalCardStatistics[] {
  const byCardId = new Map(current.map((item) => [item.cardId, item]));

  for (const delta of deltas) {
    byCardId.set(
      delta.cardId,
      applyStatisticsDelta(byCardId.get(delta.cardId), delta, updatedAt),
    );
  }

  return [...byCardId.values()];
}

export function summarizeStatistics(
  statistics: GlobalCardStatistics,
): StatisticsSummary {
  return {
    ...statistics,
    accuracy: calculateAccuracy(statistics),
  };
}

function validateDelta(delta: StatisticsDelta): void {
  const values = [
    delta.correctCount,
    delta.errorCount,
    delta.completedQuestions,
    delta.responseTimeMs,
  ];

  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Statistics deltas must be finite.');
  }
  if (
    delta.correctCount < 0 ||
    delta.completedQuestions < 0 ||
    delta.responseTimeMs < 0
  ) {
    throw new Error('Only error corrections may be negative.');
  }
}

function validateResponseTime(responseTimeMs: number): number {
  if (!Number.isFinite(responseTimeMs) || responseTimeMs < 0) {
    throw new Error('Response time must be a finite, non-negative number.');
  }

  return responseTimeMs;
}
