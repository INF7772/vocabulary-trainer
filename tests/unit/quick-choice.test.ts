import { describe, expect, it } from 'vitest';

import {
  acceptRejectedQuickChoiceAnswer,
  answerQuickChoice,
  createChoiceOptionCardIds,
  createQuickChoiceSession,
  giveUpQuickChoiceQuestion,
  stopQuickChoice,
} from '../../src/domain';
import { practiceCards } from '../utils/practice-cards';

describe('Quick Choice', () => {
  it('avoids the same Card at consecutive deck boundaries', () => {
    const cards = practiceCards(2);
    const dependencies = { random: () => 0.999, now: () => 100 };
    let state = createQuickChoiceSession(
      cards,
      'meaning-to-word',
      10,
      dependencies,
    );
    const seen: string[] = [];

    for (let index = 0; index < 10; index += 1) {
      seen.push(state.currentQuestion!.cardId);
      state = answerQuickChoice(
        state,
        cards,
        state.currentQuestion!.cardId,
        dependencies,
      ).state;
    }

    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).not.toBe(seen[index - 1]);
    }
  });

  it('supports each exercise mode, including deterministic Mixed selection', () => {
    const cards = practiceCards(4);

    expect(
      createQuickChoiceSession(cards, 'meaning-to-word', 10, {
        random: () => 0.9,
        now: () => 0,
      }).currentQuestion?.exerciseType,
    ).toBe('meaning-to-word');
    expect(
      createQuickChoiceSession(cards, 'word-to-meaning', 10, {
        random: () => 0.9,
        now: () => 0,
      }).currentQuestion?.exerciseType,
    ).toBe('word-to-meaning');
    expect(
      createQuickChoiceSession(cards, 'mixed', 10, {
        random: () => 0.1,
        now: () => 0,
      }).currentQuestion?.exerciseType,
    ).toBe('meaning-to-word');
  });

  it('replaces an ambiguous reverse choice with a solvable direction', () => {
    const cards = practiceCards(2).map((card, index) => ({
      ...card,
      target: ["\u3058", "\u3062"][index]!,
      meaning: 'ji',
      ambiguousMeaning: true,
    }));

    expect(
      createQuickChoiceSession(cards, 'meaning-to-word', 10, {
        random: () => 0,
        now: () => 0,
      }).currentQuestion?.exerciseType,
    ).toBe('word-to-meaning');
  });

  it.each([10, 20, 50] as const)(
    'completes after the configured %i questions',
    (length) => {
      const cards = practiceCards(1);
      const dependencies = { random: () => 0.9, now: () => 100 };
      let state = createQuickChoiceSession(
        cards,
        'meaning-to-word',
        length,
        dependencies,
      );

      for (let index = 0; index < length; index += 1) {
        state = answerQuickChoice(
          state,
          cards,
          state.currentQuestion?.cardId ?? '',
          dependencies,
        ).state;
      }

      expect(state.status).toBe('completed');
      expect(state.completedQuestionCount).toBe(length);
      expect(state.currentQuestion).toBeNull();
    },
  );

  it('keeps Endless active until explicitly stopped', () => {
    const cards = practiceCards(1);
    const dependencies = { random: () => 0.9, now: () => 100 };
    let state = createQuickChoiceSession(
      cards,
      'word-to-meaning',
      'endless',
      dependencies,
    );

    for (let index = 0; index < 60; index += 1) {
      state = answerQuickChoice(
        state,
        cards,
        state.currentQuestion?.cardId ?? '',
        dependencies,
      ).state;
    }

    expect(state.status).toBe('active');
    expect(stopQuickChoice(state).status).toBe('stopped');
  });

  it('produces unique visible options and uses fewer than four when needed', () => {
    const cards = [
      { id: 'a', target: 'one', meaning: 'same' },
      { id: 'b', target: 'two', meaning: 'same' },
      { id: 'c', target: 'three', meaning: 'different' },
    ];

    const options = createChoiceOptionCardIds({
      expectedCardId: 'a',
      candidates: cards,
      exerciseType: 'word-to-meaning',
      random: () => 0.9,
    });

    expect(options).toHaveLength(2);
    expect(options).toContain('a');
    expect(options).toContain('c');
  });

  it('treats visually identical answer text as one option', () => {
    const cards = [
      { id: 'katakana-o', target: '\u30aa', meaning: 'o' },
      { id: 'katakana-wo', target: '\u30f2', meaning: ' O ' },
      { id: 'katakana-a', target: '\u30a2', meaning: 'a' },
    ];

    const options = createChoiceOptionCardIds({
      expectedCardId: 'katakana-o',
      candidates: cards,
      exerciseType: 'word-to-meaning',
      random: () => 0.9,
    });

    expect(options).toHaveLength(2);
    expect(options).toContain('katakana-o');
    expect(options).not.toContain('katakana-wo');
  });

  it('allows the correct option to occupy different randomized positions', () => {
    const cards = practiceCards(4);
    const first = createChoiceOptionCardIds({
      expectedCardId: 'card-1',
      candidates: cards,
      exerciseType: 'meaning-to-word',
      random: () => 0,
    });
    const second = createChoiceOptionCardIds({
      expectedCardId: 'card-1',
      candidates: cards,
      exerciseType: 'meaning-to-word',
      random: () => 0.999,
    });

    expect(first.indexOf('card-1')).not.toBe(second.indexOf('card-1'));
  });

  it('returns dual error penalties and keeps timing until the correct answer', () => {
    const cards = practiceCards(4);
    let currentTime = 1_000;
    const dependencies = {
      random: () => 0.9,
      now: () => currentTime,
    };
    let state = createQuickChoiceSession(
      cards,
      'meaning-to-word',
      10,
      dependencies,
    );
    const question = state.currentQuestion!;
    const mistaken = question.optionCardIds.find(
      (cardId) => cardId !== question.cardId,
    )!;
    currentTime = 2_000;
    const wrong = answerQuickChoice(
      state,
      cards,
      mistaken,
      dependencies,
    );

    expect(wrong.statisticsDeltas.map((delta) => delta.cardId)).toEqual([
      question.cardId,
      mistaken,
    ]);
    expect(wrong.state.currentQuestion?.startedAtMs).toBe(1_000);

    currentTime = 3_500;
    const correct = answerQuickChoice(
      wrong.state,
      cards,
      question.cardId,
      dependencies,
    );
    expect(correct.statisticsDeltas[0]).toMatchObject({
      correctCount: 1,
      completedQuestions: 1,
      responseTimeMs: 2_500,
    });
    state = correct.state;
    expect(state.completedQuestionCount).toBe(1);
  });

  it('supports I do not know and manual correction of a rejected choice', () => {
    const cards = practiceCards(4);
    const dependencies = { random: () => 0.9, now: () => 1_000 };
    const before = createQuickChoiceSession(
      cards,
      'meaning-to-word',
      10,
      dependencies,
    );
    const question = before.currentQuestion!;
    const mistaken = question.optionCardIds.find((id) => id !== question.cardId)!;
    const rejected = answerQuickChoice(before, cards, mistaken, dependencies);
    const corrected = acceptRejectedQuickChoiceAnswer(before, cards, dependencies);
    const unknown = giveUpQuickChoiceQuestion(before, cards, dependencies);

    expect(rejected.feedback).toBe('incorrect');
    expect(corrected.feedback).toBe('correct');
    expect(corrected.state.completedQuestionCount).toBe(1);
    expect(unknown.feedback).toBe('gave-up');
    expect(unknown.statisticsDeltas[0]).toMatchObject({
      errorCount: 1,
      completedQuestions: 1,
    });
  });
});
