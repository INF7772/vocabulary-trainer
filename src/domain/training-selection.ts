import type { GlobalCardStatistics } from "./models";
import { calculateAccuracy } from "./statistics";

export type TrainingQuickSelection =
  | "all"
  | "new"
  | "learned"
  | "difficult"
  | "low-accuracy"
  | "recent-errors";

export interface TrainingSelectionCard {
  cardId: string;
  learned: boolean;
  markedForStudy: boolean;
  statistics?: GlobalCardStatistics;
}

export interface TrainingSelectionInput {
  cards: readonly TrainingSelectionCard[];
  activeSelections: ReadonlySet<TrainingQuickSelection>;
  manuallyIncludedCardIds: ReadonlySet<string>;
  manuallyExcludedCardIds: ReadonlySet<string>;
  accuracyLimit: number;
  nowMs: number;
}

export const RECENT_ERROR_DAYS = 30;

export function hasRecentError(
  statistics: GlobalCardStatistics | undefined,
  nowMs: number,
  days = RECENT_ERROR_DAYS,
): boolean {
  if (!statistics?.lastErrorAt || !Number.isFinite(nowMs) || days <= 0) {
    return false;
  }
  const errorTime = Date.parse(statistics.lastErrorAt);
  if (!Number.isFinite(errorTime) || errorTime > nowMs) return false;
  return nowMs - errorTime < days * 24 * 60 * 60 * 1000;
}

export function matchesTrainingQuickSelection(
  card: TrainingSelectionCard,
  selection: TrainingQuickSelection,
  accuracyLimit: number,
  nowMs: number,
): boolean {
  const accuracy = card.statistics
    ? calculateAccuracy(card.statistics)
    : null;
  switch (selection) {
    case "all":
      return true;
    case "new":
      return (
        !card.statistics || card.statistics.totalCompletedQuestions === 0
      );
    case "learned":
      return card.learned;
    case "difficult":
      return card.markedForStudy;
    case "low-accuracy":
      return accuracy !== null && accuracy < accuracyLimit;
    case "recent-errors":
      return hasRecentError(card.statistics, nowMs);
  }
}

export function resolveTrainingSelection({
  cards,
  activeSelections,
  manuallyIncludedCardIds,
  manuallyExcludedCardIds,
  accuracyLimit,
  nowMs,
}: TrainingSelectionInput): Set<string> {
  const result = new Set<string>();
  for (const card of cards) {
    if (
      [...activeSelections].some((selection) =>
        matchesTrainingQuickSelection(
          card,
          selection,
          accuracyLimit,
          nowMs,
        ),
      )
    ) {
      result.add(card.cardId);
    }
  }
  for (const cardId of manuallyIncludedCardIds) result.add(cardId);
  for (const cardId of manuallyExcludedCardIds) result.delete(cardId);
  const availableIds = new Set(cards.map((card) => card.cardId));
  return new Set([...result].filter((cardId) => availableIds.has(cardId)));
}
