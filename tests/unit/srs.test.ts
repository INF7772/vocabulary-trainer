import { describe, expect, it } from "vitest";

import {
  createDueSrsState,
  graduateToSrs,
  previewSrsReview,
  scheduleSrsReview,
} from "../../src/domain";

describe("FSRS scheduling", () => {
  const now = new Date("2026-10-02T08:00:00.000Z");

  it("graduates a learned Card into a future review", () => {
    const state = graduateToSrs("card-1", now);

    expect(state.cardId).toBe("card-1");
    expect(state.state).toBe("Review");
    expect(new Date(state.dueAt).getTime()).toBeGreaterThan(now.getTime());
    expect(state.reps).toBe(1);
  });

  it("keeps the four self-ratings ordered by interval", () => {
    const state = createDueSrsState("card-1", now);
    const preview = previewSrsReview(state, now);
    const intervals = Object.fromEntries(
      preview.map((item) => [item.rating, item.intervalMs]),
    );

    expect(intervals.again).toBeLessThanOrEqual(intervals.hard);
    expect(intervals.hard).toBeLessThanOrEqual(intervals.good);
    expect(intervals.good).toBeLessThanOrEqual(intervals.easy);
  });

  it("raises lapses after a failed mature review", () => {
    const learned = graduateToSrs("card-1", now);
    const due = new Date(learned.dueAt);
    const forgotten = scheduleSrsReview(learned, "again", due);

    expect(forgotten.lapses).toBe(1);
    expect(forgotten.difficulty).toBeGreaterThan(learned.difficulty);
  });
});
