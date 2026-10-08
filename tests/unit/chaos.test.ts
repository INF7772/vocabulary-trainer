import { describe, expect, it } from 'vitest';

import {
  acceptChaosMismatch,
  createChaosRound,
  createChaosRoundPlan,
  giveUpChaosPair,
  getChaosRoundElapsedMs,
  selectChaosItem,
} from '../../src/domain';
import { practiceCards } from '../utils/practice-cards';

describe('Chaos engine', () => {
  it('generates randomized rounds capped at ten pairs', () => {
    const state = createChaosRound(practiceCards(14), 10, {
      random: () => 0.3,
      now: () => 100,
    });

    expect(state.cardIds).toHaveLength(10);
    expect(new Set(state.wordCardIds)).toEqual(new Set(state.cardIds));
    expect(new Set(state.meaningCardIds)).toEqual(new Set(state.cardIds));
  });

  it('splits a large Lesson into non-overlapping rounds', () => {
    const cards = practiceCards(23);
    const rounds = createChaosRoundPlan(cards, 10, () => 0.3);

    expect(rounds.map((round) => round.length)).toEqual([10, 10, 3]);
    expect(new Set(rounds.flat())).toEqual(
      new Set(cards.map((card) => card.id)),
    );
  });

  it('records a correct cross-side match and pair timing', () => {
    const cards = practiceCards(2);
    let now = 1_000;
    const dependencies = { random: () => 0.9, now: () => now };
    const initial = createChaosRound(cards, 2, dependencies);
    const cardId = initial.cardIds[0]!;
    const selected = selectChaosItem(initial, 'word', cardId, dependencies);
    now = 2_750;
    const matched = selectChaosItem(
      selected.state,
      'meaning',
      cardId,
      dependencies,
    );

    expect(matched.interaction).toBe('correct-match');
    expect(matched.state.completedCardIds).toEqual([cardId]);
    expect(matched.pairResponseTimeMs).toBe(1_750);
    expect(matched.statisticsDeltas[0]).toMatchObject({
      cardId,
      correctCount: 1,
      completedQuestions: 1,
      responseTimeMs: 1_750,
    });
  });

  it('penalizes both Cards after an incorrect cross-side match', () => {
    const cards = practiceCards(2);
    const dependencies = { random: () => 0.9, now: () => 1_000 };
    const initial = createChaosRound(cards, 2, dependencies);
    const wordCardId = initial.cardIds[0]!;
    const meaningCardId = initial.cardIds[1]!;
    const selected = selectChaosItem(
      initial,
      'word',
      wordCardId,
      dependencies,
    );
    const mismatch = selectChaosItem(
      selected.state,
      'meaning',
      meaningCardId,
      dependencies,
    );

    expect(mismatch.interaction).toBe('incorrect-match');
    expect(mismatch.state.completedCardIds).toEqual([]);
    expect(mismatch.state.selection).toBeNull();
    expect(mismatch.statisticsDeltas.map((delta) => delta.cardId)).toEqual([
      wordCardId,
      meaningCardId,
    ]);
  });

  it('replaces same-side selection without recording an error', () => {
    const cards = practiceCards(2);
    const dependencies = { random: () => 0.9, now: () => 1_000 };
    const initial = createChaosRound(cards, 2, dependencies);
    const firstCardId = initial.cardIds[0]!;
    const secondCardId = initial.cardIds[1]!;
    const selected = selectChaosItem(
      initial,
      'word',
      firstCardId,
      dependencies,
    );
    const switched = selectChaosItem(
      selected.state,
      'word',
      secondCardId,
      dependencies,
    );

    expect(switched.interaction).toBe('selection-replaced');
    expect(switched.state.selection?.cardId).toBe(secondCardId);
    expect(switched.statisticsDeltas).toEqual([]);
    expect(switched.playAudioCardId).toBe(secondCardId);
  });

  it('supports I do not know and manual correction of a rejected pair', () => {
    const cards = practiceCards(2);
    const dependencies = { random: () => 0.9, now: () => 1_000 };
    const initial = createChaosRound(cards, 2, dependencies);
    const wordCardId = initial.cardIds[0]!;
    const meaningCardId = initial.cardIds[1]!;
    const selected = selectChaosItem(initial, 'word', wordCardId, dependencies);
    const mismatch = selectChaosItem(
      selected.state,
      'meaning',
      meaningCardId,
      dependencies,
    );
    const corrected = acceptChaosMismatch(
      mismatch.state,
      wordCardId,
      meaningCardId,
      dependencies,
    );
    const unknown = giveUpChaosPair(initial, dependencies);

    expect(corrected.interaction).toBe('manual-correct');
    expect(corrected.state.completedWordCardIds).toContain(wordCardId);
    expect(corrected.state.completedMeaningCardIds).toContain(meaningCardId);
    expect(unknown.interaction).toBe('gave-up');
    expect(unknown.revealedCardId).toBeTruthy();
    expect(unknown.statisticsDeltas[0]).toMatchObject({
      errorCount: 1,
      completedQuestions: 1,
    });
  });

  it('tracks total round time and completion', () => {
    const cards = practiceCards(1);
    let now = 500;
    const dependencies = { random: () => 0.9, now: () => now };
    const initial = createChaosRound(cards, 1, dependencies);
    const selected = selectChaosItem(
      initial,
      'meaning',
      'card-1',
      dependencies,
    );
    now = 2_000;
    const complete = selectChaosItem(
      selected.state,
      'word',
      'card-1',
      dependencies,
    );

    expect(complete.state.status).toBe('completed');
    expect(getChaosRoundElapsedMs(complete.state, 10_000)).toBe(1_500);
    expect(complete.playAudioCardId).toBe('card-1');
  });
});
