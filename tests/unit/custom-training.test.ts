import { describe, expect, it } from "vitest";

import {
  acceptRejectedTrainingAnswer,
  answerTrainingChoice,
  answerTrainingTyping,
  createTrainingSession,
  giveUpTrainingQuestion,
  resumeTraining,
  stopTraining,
  type TrainingExerciseType,
} from "../../src/domain";
import { practiceCards } from "../utils/practice-cards";

describe("custom training", () => {
  it("converts kana typing formats to glyph choices", () => {
    const cards = practiceCards(4).map((card, index) => ({
      ...card,
      target: ["\u3042", "\u3044", "\u3046", "\u3048"][index]!,
      isKanaStudy: true,
    }));
    const meaning = createTrainingSession(cards, ["meaning-typing"], {
      random: () => 0,
      now: () => 0,
    });
    const audio = createTrainingSession(cards, ["audio-typing"], {
      random: () => 0,
      now: () => 0,
    });

    expect(meaning.currentQuestion).toMatchObject({
      exerciseType: "meaning-choice",
      optionCardIds: expect.any(Array),
    });
    expect(meaning.currentQuestion?.optionCardIds).toHaveLength(4);
    expect(audio.currentQuestion?.exerciseType).toBe("audio-choice");
  });

  it("keeps ambiguous symbol drawing feasible and avoids ambiguous choices", () => {
    const cards = practiceCards(2).map((card, index) => ({
      ...card,
      target: ["\u3058", "\u3062"][index]!,
      meaning: "ji",
      isKanaStudy: true,
      requiresHandwriting: true,
      ambiguousMeaning: true,
      acceptedDrawingTargets: ["\u3058", "\u3062"],
    }));
    const drawing = createTrainingSession(cards, ["meaning-typing"], {
      random: () => 0,
      now: () => 0,
    });
    const choice = createTrainingSession(cards, ["meaning-choice"], {
      random: () => 0,
      now: () => 0,
    });

    expect(drawing.currentQuestion?.exerciseType).toBe("meaning-typing");
    expect(choice.currentQuestion?.exerciseType).toBe("word-choice");
  });

  it.each([
    "meaning-choice",
    "word-choice",
    "audio-choice",
    "audio-typing",
    "meaning-typing",
  ] as TrainingExerciseType[])("creates %s questions", (exerciseType) => {
    const state = createTrainingSession(
      practiceCards(4),
      [exerciseType],
      { random: () => 0, now: () => 100 },
    );
    expect(state.currentQuestion?.exerciseType).toBe(exerciseType);
    expect(state.currentQuestion?.optionCardIds.length).toBe(
      exerciseType.endsWith("-choice") ? 4 : 0,
    );
  });

  it("keeps a configured non-random Card order", () => {
    const cards = practiceCards(3);
    let state = createTrainingSession(
      cards,
      ["meaning-typing"],
      { random: () => 0.8, now: () => 0, randomizeDeck: false },
    );
    expect(state.currentQuestion?.cardId).toBe("card-1");
    state = answerTrainingTyping(state, cards, "target 1", {
      random: () => 0.8,
      now: () => 10,
    }).state;
    expect(state.currentQuestion?.cardId).toBe("card-2");
  });

  it("uses untested source Cards only as choice distractors", () => {
    const sourceCards = practiceCards(3);
    const state = createTrainingSession(
      [sourceCards[0]!],
      ["meaning-choice"],
      {
        random: () => 0,
        now: () => 0,
        choiceCandidates: sourceCards,
      },
    );

    expect(state.totalQuestionCount).toBe(1);
    expect(state.currentQuestion?.cardId).toBe("card-1");
    expect(state.currentQuestion?.optionCardIds).toHaveLength(3);
  });

  it("penalizes both Cards for a wrong choice and only completes on success", () => {
    const cards = practiceCards(4);
    let now = 1_000;
    const dependencies = { random: () => 0.9, now: () => now };
    const state = createTrainingSession(
      cards,
      ["audio-choice"],
      dependencies,
    );
    const question = state.currentQuestion!;
    const mistaken = question.optionCardIds.find(
      (cardId) => cardId !== question.cardId,
    )!;
    const wrong = answerTrainingChoice(
      state,
      cards,
      mistaken,
      dependencies,
    );
    expect(wrong.feedback).toBe("incorrect");
    expect(wrong.statisticsDeltas.map((delta) => delta.cardId)).toEqual([
      question.cardId,
      mistaken,
    ]);
    expect(wrong.state.completedQuestionCount).toBe(0);
    now = 2_500;
    const correct = answerTrainingChoice(
      wrong.state,
      cards,
      question.cardId,
      dependencies,
    );
    expect(correct.statisticsDeltas[0]).toMatchObject({
      correctCount: 1,
      completedQuestions: 1,
      responseTimeMs: 1_500,
    });
  });

  it("uses exact typing and recognizes another Card as a confusion", () => {
    const cards = practiceCards(3);
    const state = createTrainingSession(
      cards,
      ["audio-typing"],
      { random: () => 0, now: () => 100 },
    );
    const expectedId = state.currentQuestion!.cardId;
    const mistaken = cards.find((card) => card.id !== expectedId)!;
    const wrong = answerTrainingTyping(state, cards, mistaken.target, {
      now: () => 200,
    });
    expect(wrong.statisticsDeltas.map((delta) => delta.cardId)).toEqual([
      expectedId,
      mistaken.id,
    ]);
    const expected = cards.find((card) => card.id === expectedId)!;
    expect(
      answerTrainingTyping(wrong.state, cards, expected.target, {
        now: () => 500,
      }).feedback,
    ).toBe("correct");
  });

  it("supports I do not know and manual correction of a rejected answer", () => {
    const cards = practiceCards(4);
    const dependencies = { random: () => 0.9, now: () => 1_000 };
    const before = createTrainingSession(
      cards,
      ["meaning-choice"],
      dependencies,
    );
    const question = before.currentQuestion!;
    const mistaken = question.optionCardIds.find((id) => id !== question.cardId)!;
    const rejected = answerTrainingChoice(before, cards, mistaken, dependencies);
    const corrected = acceptRejectedTrainingAnswer(before, cards, dependencies);
    const unknown = giveUpTrainingQuestion(before, cards, dependencies);

    expect(rejected.feedback).toBe("incorrect");
    expect(corrected.feedback).toBe("correct");
    expect(corrected.state.completedQuestionCount).toBe(1);
    expect(unknown.feedback).toBe("gave-up");
    expect(unknown.statisticsDeltas[0]).toMatchObject({
      errorCount: 1,
      completedQuestions: 1,
    });
  });

  it("runs every selected word through every format, supports stopping, and resets the timer on resume", () => {
    const cards = practiceCards(2);
    let state = createTrainingSession(
      cards,
      ["meaning-typing", "audio-typing"],
      { random: () => 0, now: () => 10 },
    );
    expect(state.totalQuestionCount).toBe(4);
    expect(state.remainingQuestions).toHaveLength(3);
    expect(
      resumeTraining(state, { now: () => 900 }).currentQuestion?.startedAtMs,
    ).toBe(900);
    expect(stopTraining(state).status).toBe("stopped");
    for (let index = 0; index < 4; index += 1) {
      const currentCard = cards.find(
        (card) => card.id === state.currentQuestion?.cardId,
      )!;
      state = answerTrainingTyping(state, cards, currentCard.target, {
        random: () => 0,
        now: () => 20 + index,
      }).state;
    }
    expect(state.status).toBe("completed");
  });
});
