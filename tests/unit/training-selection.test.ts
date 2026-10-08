import { describe, expect, it } from "vitest";

import {
  hasRecentError,
  resolveTrainingSelection,
  type GlobalCardStatistics,
  type TrainingSelectionCard,
} from "../../src/domain";

function statistics(
  cardId: string,
  overrides: Partial<GlobalCardStatistics> = {},
): GlobalCardStatistics {
  return {
    cardId,
    totalCompletedQuestions: 10,
    correctCount: 8,
    errorCount: 2,
    totalResponseTimeMs: 10_000,
    averageResponseTimeMs: 1_000,
    updatedAt: "2026-09-29T00:00:00.000Z",
    ...overrides,
  };
}

const cards: TrainingSelectionCard[] = [
  {
    cardId: "new",
    learned: false,
    markedForStudy: false,
  },
  {
    cardId: "difficult",
    learned: true,
    markedForStudy: true,
    statistics: statistics("difficult"),
  },
  {
    cardId: "recent",
    learned: false,
    markedForStudy: false,
    statistics: statistics("recent", {
      lastErrorAt: "2026-09-28T00:00:00.000Z",
    }),
  },
];

describe("training selection", () => {
  it("unites quick selections and applies manual changes to the same final list", () => {
    const result = resolveTrainingSelection({
      cards,
      activeSelections: new Set(["difficult", "recent-errors"]),
      manuallyIncludedCardIds: new Set(["new"]),
      manuallyExcludedCardIds: new Set(["recent"]),
      accuracyLimit: 80,
      nowMs: Date.parse("2026-09-29T00:00:00.000Z"),
    });

    expect([...result].sort()).toEqual(["difficult", "new"]);
  });

  it("expires a recent error exactly at the 30 day boundary", () => {
    const now = Date.parse("2026-09-29T00:00:00.000Z");
    expect(
      hasRecentError(
        statistics("card", { lastErrorAt: "2026-08-30T00:00:00.001Z" }),
        now,
      ),
    ).toBe(true);
    expect(
      hasRecentError(
        statistics("card", { lastErrorAt: "2026-08-30T00:00:00.000Z" }),
        now,
      ),
    ).toBe(false);
  });
});
