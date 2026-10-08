import { describe, expect, it } from "vitest";

import {
  buildTodayQueue,
  calculateDailyNewLimit,
  createDueSrsState,
  graduateToSrs,
} from "../../src/domain";

describe("Today queue", () => {
  it("reduces new material as the review debt grows", () => {
    expect(calculateDailyNewLimit(7, 10)).toBe(10);
    expect(calculateDailyNewLimit(31, 10)).toBe(5);
    expect(calculateDailyNewLimit(58, 10)).toBe(0);
  });

  it("prioritizes due reviews and respects the remaining daily new limit", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    const due = createDueSrsState("due", new Date("2026-10-01T12:00:00.000Z"));
    const future = graduateToSrs("future", now);
    const plan = buildTodayQueue({
      now,
      maximumNewCardsPerDay: 3,
      introducedTodayCount: 1,
      reviewStates: [future, due],
      newCardIdsInLessonOrder: ["new-1", "new-2", "new-3"],
    });

    expect(plan.reviewCardIds).toEqual(["due"]);
    expect(plan.newCardIds).toEqual(["new-1", "new-2"]);
  });
});
