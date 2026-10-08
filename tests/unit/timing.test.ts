import { describe, expect, it } from "vitest";

import { answerLearnChoice, createLearnSession } from "../../src/domain";
import { practiceCards } from "../utils/practice-cards";

describe("practice latency budget", () => {
  it("runs 1,000 deterministic Learn transitions without an algorithmic pause", () => {
    const cards = practiceCards(10);
    const startedAt = performance.now();

    for (let index = 0; index < 1_000; index += 1) {
      const state = createLearnSession(
        { id: `latency-${index}`, lessonId: "lesson", cards },
        { random: () => 0.5, now: () => index },
      );
      answerLearnChoice(
        state,
        cards,
        state.currentQuestion!.cardId,
        { random: () => 0.5, now: () => index + 1 },
      );
    }

    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
