import { describe, expect, it } from "vitest";

import {
  advanceHandwritingPractice,
  answerHandwritingPractice,
  createHandwritingPractice,
  currentHandwritingCardId,
} from "../../src/domain";

describe("handwriting practice", () => {
  it("records one explicit decision per Card and completes the session", () => {
    let state = createHandwritingPractice(["one", "two"], {
      random: () => 0.999,
      now: () => 100,
    });
    expect(currentHandwritingCardId(state)).toBe("one");

    const first = answerHandwritingPractice(state, true, { now: () => 350 });
    expect(first.statisticsDelta).toMatchObject({
      cardId: "one",
      correctCount: 1,
      completedQuestions: 1,
      responseTimeMs: 250,
    });
    state = advanceHandwritingPractice(first.state, { now: () => 500 });
    expect(currentHandwritingCardId(state)).toBe("two");

    const second = answerHandwritingPractice(state, false, { now: () => 900 });
    expect(second.statisticsDelta).toMatchObject({
      cardId: "two",
      errorCount: 1,
      completedQuestions: 1,
      responseTimeMs: 400,
    });
    state = advanceHandwritingPractice(second.state);
    expect(state).toMatchObject({
      status: "completed",
      correctCount: 1,
      incorrectCount: 1,
    });
  });

  it("requires a decision before moving to the next Card", () => {
    const state = createHandwritingPractice(["one"], { now: () => 0 });
    expect(() => advanceHandwritingPractice(state)).toThrow(
      /Choose a handwriting result/u,
    );
  });
});
