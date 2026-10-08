import type { SrsCardState } from "./models";

export const DEFAULT_MAXIMUM_NEW_CARDS_PER_DAY = 10;

export interface TodayQueueInput {
  now: Date;
  maximumNewCardsPerDay: number;
  reviewStates: readonly SrsCardState[];
  introducedTodayCount: number;
  newCardIdsInLessonOrder: readonly string[];
}

export interface TodayQueuePlan {
  reviewCardIds: string[];
  newCardIds: string[];
  dueCount: number;
  newCount: number;
  estimatedMinutes: number;
}

export function calculateDailyNewLimit(
  dueCount: number,
  maximum: number,
): number {
  const safeMaximum = Math.max(0, Math.floor(maximum));
  if (dueCount >= 50) return 0;
  if (dueCount >= 30) return Math.min(5, safeMaximum);
  return safeMaximum;
}

export function buildTodayQueue(input: TodayQueueInput): TodayQueuePlan {
  const endOfToday = new Date(input.now);
  endOfToday.setHours(23, 59, 59, 999);
  const reviewCardIds = input.reviewStates
    .filter((state) => new Date(state.dueAt) <= endOfToday)
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
    .map((state) => state.cardId);
  const dailyLimit = calculateDailyNewLimit(
    reviewCardIds.length,
    input.maximumNewCardsPerDay,
  );
  const remainingNewSlots = Math.max(
    0,
    dailyLimit - input.introducedTodayCount,
  );
  const newCardIds = [...new Set(input.newCardIdsInLessonOrder)].slice(
    0,
    remainingNewSlots,
  );

  return {
    reviewCardIds,
    newCardIds,
    dueCount: reviewCardIds.length,
    newCount: newCardIds.length,
    estimatedMinutes: Math.max(
      reviewCardIds.length + newCardIds.length > 0 ? 1 : 0,
      Math.round(reviewCardIds.length * 0.35 + newCardIds.length * 1.5),
    ),
  };
}
