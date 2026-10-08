export const MAX_LEARN_BATCH_SIZE = 10;

export interface NextBatchPlan {
  cardIds: string[];
  difficultCardIds: string[];
  newCardIds: string[];
  remainingDifficultCardIds: string[];
  remainingNewCardIds: string[];
}

export function takeNextBatch(
  difficultCardIds: readonly string[],
  newCardIds: readonly string[],
  maximumSize = MAX_LEARN_BATCH_SIZE,
): NextBatchPlan {
  if (!Number.isInteger(maximumSize) || maximumSize < 1) {
    throw new Error('Learn batch size must be a positive integer.');
  }

  const difficult = difficultCardIds.slice(0, maximumSize);
  const newSlots = maximumSize - difficult.length;
  const fresh = newCardIds.slice(0, newSlots);

  return {
    cardIds: [...difficult, ...fresh],
    difficultCardIds: difficult,
    newCardIds: fresh,
    remainingDifficultCardIds: difficultCardIds.slice(difficult.length),
    remainingNewCardIds: newCardIds.slice(fresh.length),
  };
}
