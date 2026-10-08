import { describe, expect, it } from 'vitest';

import {
  acceptRejectedLearnAnswer,
  answerLearnChoice,
  answerLearnTyping,
  createLearnSession,
  giveUpLearnQuestion,
  resumeLearnSession,
  takeNextBatch,
  type LearnSessionState,
  type LearningEngineDependencies,
  type PracticeCard,
} from '../../src/domain';
import { practiceCards } from '../utils/practice-cards';

const stableDependencies: LearningEngineDependencies = {
  random: () => 0.999_999,
  now: () => 1_000,
};

describe('Learn batch planning', () => {
  it('caps every batch at ten Cards', () => {
    const plan = takeNextBatch(
      [],
      practiceCards(12).map((card) => card.id),
    );

    expect(plan.cardIds).toHaveLength(10);
    expect(plan.remainingNewCardIds).toEqual(['card-11', 'card-12']);
  });

  it('places three difficult Cards before seven new Cards', () => {
    const difficult = ['difficult-1', 'difficult-2', 'difficult-3'];
    const fresh = Array.from({ length: 10 }, (_, index) => `new-${index + 1}`);
    const plan = takeNextBatch(difficult, fresh);

    expect(plan.cardIds).toEqual([...difficult, ...fresh.slice(0, 7)]);
    expect(plan.remainingNewCardIds).toEqual(fresh.slice(7));
  });

  it('creates a remedial batch using only difficult Cards when no new Cards remain', () => {
    const plan = takeNextBatch(['card-1', 'card-2'], []);

    expect(plan.cardIds).toEqual(['card-1', 'card-2']);
    expect(plan.newCardIds).toEqual([]);
  });
});

describe('Learn progression', () => {
  it('uses kana glyph choices instead of typed Japanese in stage 3', () => {
    const cards = practiceCards(4).map((card, index) => ({
      ...card,
      target: ["\u3042", "\u3044", "\u3046", "\u3048"][index]!,
      isKanaStudy: true,
    }));
    let state = createSession(cards);

    while (state.currentQuestion?.stage !== 3) {
      state = answerCorrectly(state, cards).state;
    }

    expect(state.currentQuestion.exerciseType).toBe('meaning-to-word');
    expect(state.currentQuestion.optionCardIds).toHaveLength(4);
  });

  it('uses drawing for symbol Lessons and avoids ambiguous reverse choices', () => {
    const cards = practiceCards(2).map((card, index) => ({
      ...card,
      target: ["\u3058", "\u3062"][index]!,
      meaning: 'ji',
      isKanaStudy: true,
      requiresHandwriting: true,
      ambiguousMeaning: true,
      acceptedDrawingTargets: ["\u3058", "\u3062"],
    }));
    let state = createSession(cards);

    expect(state.currentQuestion?.exerciseType).toBe('word-to-meaning');
    while (state.currentQuestion?.stage !== 3) {
      state = answerCorrectly(state, cards).state;
    }

    expect(state.currentQuestion.exerciseType).toBe('meaning-to-typing');
  });

  it('repairs duplicate readings in a saved symbol choice question', () => {
    const cards: PracticeCard[] = [
      { id: 'katakana-o', target: '\u30aa', meaning: 'o', isKanaStudy: true, requiresHandwriting: true, ambiguousMeaning: true },
      { id: 'katakana-wo', target: '\u30f2', meaning: ' O ', isKanaStudy: true, requiresHandwriting: true, ambiguousMeaning: true },
      { id: 'katakana-a', target: '\u30a2', meaning: 'a', isKanaStudy: true, requiresHandwriting: true },
      { id: 'katakana-i', target: '\u30a4', meaning: 'i', isKanaStudy: true, requiresHandwriting: true },
    ];
    const saved = createSession(cards);
    saved.currentQuestion = {
      sequence: 1,
      cardId: 'katakana-o',
      exerciseType: 'word-to-meaning',
      stage: 2,
      source: 'primary',
      optionCardIds: ['katakana-o', 'katakana-wo', 'katakana-a', 'katakana-i'],
      incorrectAttempts: 0,
      startedAtMs: 500,
    };

    const resumed = resumeLearnSession(saved, cards, stableDependencies);
    const visibleAnswers = resumed.currentQuestion!.optionCardIds.map(
      (id) => cards.find((card) => card.id === id)!.meaning.trim().toLowerCase(),
    );

    expect(resumed.currentQuestion!.optionCardIds).toContain('katakana-o');
    expect(new Set(visibleAnswers).size).toBe(visibleAnswers.length);
    expect(visibleAnswers.filter((answer) => answer === 'o')).toHaveLength(1);
  });

  it('accepts romaji instead of requiring Japanese IME input for vocabulary', () => {
    const cards = [{
      ...practiceCards(1)[0]!,
      target: "\u3064\u3065\u304f",
      acceptedTypingAnswers: ["tsuzuku"],
    }];
    let state = createSession(cards);
    state = answerCorrectly(state, cards).state;
    state = answerCorrectly(state, cards).state;

    const result = answerLearnTyping(
      state,
      cards,
      "tsuzuku",
      stableDependencies,
    );

    expect(result.feedback).toBe('correct');
    expect(result.state.status).toBe('completed');
  });

  it('repairs a saved kana session that was waiting for typed Japanese', () => {
    const cards = practiceCards(4).map((card, index) => ({
      ...card,
      target: ["\u3042", "\u3044", "\u3046", "\u3048"][index]!,
      isKanaStudy: true,
    }));
    const oldSession = createSession(
      cards.map((card) => ({ ...card, isKanaStudy: false })),
    );
    let state = oldSession;
    const oldCards = cards.map((card) => ({ ...card, isKanaStudy: false }));
    while (state.currentQuestion?.stage !== 3) {
      state = answerCorrectly(state, oldCards).state;
    }

    const resumed = resumeLearnSession(state, cards, stableDependencies);

    expect(resumed.currentQuestion?.exerciseType).toBe('meaning-to-word');
    expect(resumed.currentQuestion?.optionCardIds).toHaveLength(4);
  });

  it('does not show the same Card twice in a row when another Card is available', () => {
    const cards = practiceCards(3);
    let state = createSession(cards, { random: () => 0.999, now: () => 1_000 });
    const seen: string[] = [];

    while (state.status === 'active' && seen.length < 9) {
      seen.push(state.currentQuestion!.cardId);
      state = answerCorrectly(state, cards).state;
    }

    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).not.toBe(seen[index - 1]);
    }
  });

  it('runs all Cards through stages 1, 2, and 3 in order', () => {
    const cards = practiceCards(2);
    let state = createSession(cards);

    for (const expectedType of [
      'meaning-to-word',
      'meaning-to-word',
      'word-to-meaning',
      'word-to-meaning',
      'meaning-to-typing',
      'meaning-to-typing',
    ] as const) {
      expect(state.currentQuestion?.exerciseType).toBe(expectedType);
      state = answerCorrectly(state, cards).state;
    }

    expect(state.status).toBe('completed');
  });

  it('marks a Card Learned only after all three stages are clean', () => {
    const cards = practiceCards(1);
    let state = createSession(cards);

    state = answerCorrectly(state, cards).state;
    expect(state.learnedCardIds).toEqual([]);
    state = answerCorrectly(state, cards).state;
    expect(state.learnedCardIds).toEqual([]);
    const final = answerCorrectly(state, cards);

    expect(final.newlyLearnedCardIds).toEqual(['card-1']);
    expect(final.state.learnedCardIds).toEqual(['card-1']);
    expect(final.state.status).toBe('completed');
  });

  it('keeps an expected Card dirty after a later correct answer and carries it over', () => {
    const cards = practiceCards(1);
    let state = createSession(cards);
    state = answerCorrectly(state, cards).state;
    state = answerCorrectly(state, cards).state;

    const wrong = answerLearnTyping(
      state,
      cards,
      'typo',
      stableDependencies,
    );
    expect(wrong.state.currentBatch?.dirtyCardIds).toEqual(['card-1']);

    const corrected = answerLearnTyping(
      wrong.state,
      cards,
      cards[0]?.target ?? '',
      stableDependencies,
    );

    expect(corrected.state.learnedCardIds).toEqual([]);
    expect(corrected.state.difficultCardIds).toEqual(['card-1']);
    expect(corrected.state.currentBatch?.number).toBe(2);
    expect(corrected.state.currentBatch?.cardIds).toEqual(['card-1']);
  });

  it('ends only after a difficult Card completes a clean remedial batch', () => {
    const cards = practiceCards(1);
    let state = createSession(cards);
    state = answerCorrectly(state, cards).state;
    state = answerCorrectly(state, cards).state;
    state = answerLearnTyping(
      state,
      cards,
      'wrong',
      stableDependencies,
    ).state;
    state = answerCorrectly(state, cards).state;

    expect(state.status).toBe('active');
    expect(state.currentBatch?.number).toBe(2);

    while (state.status === 'active') {
      state = answerCorrectly(state, cards).state;
    }

    expect(state.remainingNewCardIds).toEqual([]);
    expect(state.difficultCardIds).toEqual([]);
    expect(state.delayedRetries).toEqual([]);
    expect(state.learnedCardIds).toEqual(['card-1']);
  });

  it('carries difficult Cards first into a batch and fills remaining places with new Cards', () => {
    const cards = practiceCards(20);
    const state = createLearnSession(
      {
        id: 'session',
        lessonId: 'lesson',
        cards,
        difficultCardIds: ['card-1', 'card-2', 'card-3'],
        newCardIds: cards.slice(3).map((card) => card.id),
      },
      stableDependencies,
    );

    expect(state.currentBatch?.cardIds).toEqual(
      cards.slice(0, 10).map((card) => card.id),
    );
    expect(state.currentBatch?.cardIds.slice(0, 3)).toEqual([
      'card-1',
      'card-2',
      'card-3',
    ]);
    expect(state.remainingNewCardIds).toEqual(
      cards.slice(10).map((card) => card.id),
    );
  });

  it('creates a new full remedial batch for Cards that were dirty', () => {
    const cards = practiceCards(10);
    let state = createSession(cards);
    const dirtyCardIds = new Set(['card-1', 'card-2', 'card-3']);

    while (state.currentBatch?.number === 1) {
      const question = state.currentQuestion;
      expect(question).not.toBeNull();

      if (
        question?.exerciseType === 'meaning-to-typing' &&
        dirtyCardIds.has(question.cardId) &&
        question.incorrectAttempts === 0
      ) {
        state = answerLearnTyping(
          state,
          cards,
          'wrong',
          stableDependencies,
        ).state;
      }

      state = answerCorrectly(state, cards).state;
    }

    expect(state.learnedCardIds).toHaveLength(7);
    expect(state.difficultCardIds).toEqual([
      'card-1',
      'card-2',
      'card-3',
    ]);
    expect(state.currentBatch?.cardIds).toEqual([
      'card-1',
      'card-2',
      'card-3',
    ]);
    expect(state.currentBatch?.stage).toBe(1);
  });
});

describe('Learn errors and delayed retries', () => {
  it('queues only one delayed retry for repeated mistakes on one question', () => {
    const cards = practiceCards(4);
    const state = createSession(cards);
    const question = state.currentQuestion!;
    const wrongCardId = question.optionCardIds.find(
      (cardId) => cardId !== question.cardId,
    )!;

    const first = answerLearnChoice(state, cards, wrongCardId, stableDependencies);
    const second = answerLearnChoice(
      first.state,
      cards,
      wrongCardId,
      stableDependencies,
    );

    expect(second.state.delayedRetries).toHaveLength(1);
  });

  it('penalizes both choice Cards but dirties only the expected Card', () => {
    const cards = practiceCards(4);
    const state = createSession(cards);
    const question = state.currentQuestion!;
    const mistakenCardId = question.optionCardIds.find(
      (cardId) => cardId !== question.cardId,
    )!;

    const result = answerLearnChoice(
      state,
      cards,
      mistakenCardId,
      stableDependencies,
    );

    expect(result.statisticsDeltas.map((delta) => delta.cardId)).toEqual([
      question.cardId,
      mistakenCardId,
    ]);
    expect(result.state.currentBatch?.dirtyCardIds).toEqual([
      question.cardId,
    ]);
  });

  it('applies dual typing penalty only for another exact Lesson target', () => {
    const cards = practiceCards(2);
    let state = createSession(cards);

    while (state.currentQuestion?.exerciseType !== 'meaning-to-typing') {
      state = answerCorrectly(state, cards).state;
    }

    const expectedCardId = state.currentQuestion.cardId;
    const mistaken = cards.find((card) => card.id !== expectedCardId)!;
    const exactOther = answerLearnTyping(
      state,
      cards,
      mistaken.target.toUpperCase(),
      stableDependencies,
    );

    expect(exactOther.statisticsDeltas.map((delta) => delta.cardId)).toEqual([
      expectedCardId,
      mistaken.id,
    ]);

    const randomTypo = answerLearnTyping(
      exactOther.state,
      cards,
      'not another target',
      stableDependencies,
    );
    expect(randomTypo.statisticsDeltas.map((delta) => delta.cardId)).toEqual([
      expectedCardId,
    ]);
  });

  it('schedules the same exercise after five subsequent completed questions', () => {
    const cards = practiceCards(10);
    const dependencies: LearningEngineDependencies = {
      random: () => 0,
      now: () => 2_000,
    };
    let state = createSession(cards, dependencies);
    const original = state.currentQuestion;
    const wrongOption = original?.optionCardIds.find(
      (cardId) => cardId !== original.cardId,
    );

    expect(original?.exerciseType).toBe('meaning-to-word');
    expect(wrongOption).toBeDefined();

    const wrong = answerLearnChoice(
      state,
      cards,
      wrongOption as string,
      dependencies,
    );
    expect(wrong.state.currentQuestion?.sequence).toBe(original?.sequence);
    expect(wrong.state.delayedRetries[0]?.dueAfterCompletedQuestions).toBe(6);

    state = answerLearnChoice(
      wrong.state,
      cards,
      original?.cardId ?? '',
      dependencies,
    ).state;

    for (let index = 0; index < 5; index += 1) {
      expect(state.currentQuestion?.source).toBe('primary');
      state = answerCorrectly(state, cards, dependencies).state;
    }

    expect(state.currentQuestion).toMatchObject({
      cardId: original?.cardId,
      exerciseType: original?.exerciseType,
      source: 'delayed-retry',
    });
    expect(state.currentBatch?.dirtyCardIds).toContain(original?.cardId);
  });

  it('unlocks Give up after two errors without revealing the answer early', () => {
    const cards = practiceCards(1);
    let state = createSession(cards);
    state = answerCorrectly(state, cards).state;
    state = answerCorrectly(state, cards).state;

    const first = answerLearnTyping(
      state,
      cards,
      'first typo',
      stableDependencies,
    );
    expect(first.giveUpAvailable).toBe(false);
    expect(first.revealAnswer).toBe(false);

    const second = answerLearnTyping(
      first.state,
      cards,
      'second typo',
      stableDependencies,
    );
    expect(second.giveUpAvailable).toBe(true);
    expect(second.revealAnswer).toBe(false);

    const gaveUp = giveUpLearnQuestion(
      second.state,
      cards,
      stableDependencies,
    );
    expect(gaveUp.feedback).toBe('gave-up');
    expect(gaveUp.revealAnswer).toBe(true);
    expect(gaveUp.playAudioCardId).toBe('card-1');
    expect(gaveUp.statisticsDeltas[0]).toMatchObject({
      correctCount: 0,
      completedQuestions: 1,
    });
    expect(gaveUp.state.learnedCardIds).toEqual([]);
    expect(gaveUp.state.difficultCardIds).toEqual(['card-1']);
  });

  it('allows immediate I do not know and keeps the Card difficult', () => {
    const cards = practiceCards(1);
    const state = createSession(cards);
    const gaveUp = giveUpLearnQuestion(state, cards, stableDependencies);

    expect(gaveUp.feedback).toBe('gave-up');
    expect(gaveUp.revealAnswer).toBe(true);
    expect(gaveUp.statisticsDeltas).toEqual([
      expect.objectContaining({ errorCount: 1, completedQuestions: 0 }),
      expect.objectContaining({ errorCount: 0, completedQuestions: 1 }),
    ]);
    expect(gaveUp.state.currentBatch?.dirtyCardIds).toContain('card-1');
    expect(gaveUp.state.delayedRetries).toHaveLength(1);
  });

  it('can accept a rejected answer from the state before the rejection', () => {
    const cards = practiceCards(2);
    const before = createSession(cards);
    const question = before.currentQuestion!;
    const mistaken = question.optionCardIds.find((id) => id !== question.cardId)!;
    const rejected = answerLearnChoice(before, cards, mistaken, stableDependencies);
    const corrected = acceptRejectedLearnAnswer(before, cards, stableDependencies);

    expect(rejected.state.currentQuestion?.incorrectAttempts).toBe(1);
    expect(corrected.feedback).toBe('correct');
    expect(corrected.state.completedQuestionCount).toBe(1);
    expect(corrected.state.currentBatch?.dirtyCardIds).toEqual([]);
  });

  it('serializes all resumable state and restarts the active question timer on resume', () => {
    const cards = practiceCards(3);
    const state = createSession(cards, {
      random: () => 0.5,
      now: () => 1_000,
    });
    const serialized = JSON.stringify(state);
    const restored = resumeLearnSession(JSON.parse(serialized), cards, {
      random: () => 0.5,
      now: () => 9_000,
    });

    expect(restored.currentBatch).toEqual(state.currentBatch);
    expect(restored.remainingNewCardIds).toEqual(state.remainingNewCardIds);
    expect(restored.delayedRetries).toEqual(state.delayedRetries);
    expect(restored.currentQuestion?.startedAtMs).toBe(9_000);
  });
});

function createSession(
  cards: readonly PracticeCard[],
  dependencies: LearningEngineDependencies = stableDependencies,
) {
  return createLearnSession(
    { id: 'session', lessonId: 'lesson', cards },
    dependencies,
  );
}

function answerCorrectly(
  state: LearnSessionState,
  cards: readonly PracticeCard[],
  dependencies: LearningEngineDependencies = stableDependencies,
) {
  const question = state.currentQuestion;

  if (!question) {
    throw new Error('Expected an active question.');
  }

  if (question.exerciseType === 'meaning-to-typing') {
    const card = cards.find((candidate) => candidate.id === question.cardId);
    return answerLearnTyping(state, cards, card?.target ?? '', dependencies);
  }

  return answerLearnChoice(state, cards, question.cardId, dependencies);
}
