import type { GlobalCardStatistics } from './models';

export function calculateAccuracy(
  statistics: Pick<GlobalCardStatistics, 'correctCount' | 'errorCount'>,
): number | null {
  const attempts = statistics.correctCount + statistics.errorCount;

  return attempts === 0 ? null : (statistics.correctCount / attempts) * 100;
}

export function calculateAverageResponseTime(
  statistics: Pick<
    GlobalCardStatistics,
    'totalCompletedQuestions' | 'totalResponseTimeMs'
  >,
): number | null {
  return statistics.totalCompletedQuestions === 0
    ? null
    : statistics.totalResponseTimeMs / statistics.totalCompletedQuestions;
}
