import {
  type PracticeCard,
  type RandomSource,
  shuffle,
  systemRandom,
} from './practice';
import {
  correctCompletionDelta,
  multipleChoiceErrorDeltas,
  type StatisticsDelta,
  unknownCompletionDelta,
} from './statistics-engine';

export type ChaosSide = 'word' | 'meaning';
export type ChaosRoundStatus = 'active' | 'completed';

export interface ChaosSelection {
  side: ChaosSide;
  cardId: string;
  selectedAtMs: number;
}

export interface ChaosRoundState {
  cardIds: string[];
  wordCardIds: string[];
  meaningCardIds: string[];
  completedCardIds: string[];
  completedWordCardIds: string[];
  completedMeaningCardIds: string[];
  selection: ChaosSelection | null;
  status: ChaosRoundStatus;
  startedAtMs: number;
  completedAtMs: number | null;
}

export interface ChaosDependencies {
  random?: RandomSource;
  now?: () => number;
}

export type ChaosInteraction =
  | 'selected'
  | 'selection-replaced'
  | 'correct-match'
  | 'incorrect-match'
  | 'manual-correct'
  | 'gave-up'
  | 'ignored';

export interface ChaosTransition {
  state: ChaosRoundState;
  interaction: ChaosInteraction;
  statisticsDeltas: StatisticsDelta[];
  playAudioCardId?: string;
  matchedCardId?: string;
  pairResponseTimeMs?: number;
  attemptedWordCardId?: string;
  attemptedMeaningCardId?: string;
  revealedCardId?: string;
}

export function createChaosRound(
  cards: readonly PracticeCard[],
  maximumPairs = 10,
  dependencies: ChaosDependencies = {},
): ChaosRoundState {
  validateRoundSize(maximumPairs);

  if (cards.length === 0) {
    throw new Error('Chaos requires at least one Card.');
  }

  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error('Chaos Card ids must be unique.');
  }

  const random = dependencies.random ?? systemRandom;
  const selectedCardIds = shuffle(
    cards.map((card) => card.id),
    random,
  ).slice(0, maximumPairs);

  return {
    cardIds: selectedCardIds,
    wordCardIds: shuffle(selectedCardIds, random),
    meaningCardIds: shuffle(selectedCardIds, random),
    completedCardIds: [],
    completedWordCardIds: [],
    completedMeaningCardIds: [],
    selection: null,
    status: 'active',
    startedAtMs: readNow(dependencies),
    completedAtMs: null,
  };
}

export function createChaosRoundPlan(
  cards: readonly PracticeCard[],
  maximumPairs = 10,
  random: RandomSource = systemRandom,
): string[][] {
  validateRoundSize(maximumPairs);

  if (cards.length === 0) {
    return [];
  }

  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error('Chaos Card ids must be unique.');
  }

  const shuffledCardIds = shuffle(
    cards.map((card) => card.id),
    random,
  );
  const rounds: string[][] = [];

  for (let index = 0; index < shuffledCardIds.length; index += maximumPairs) {
    rounds.push(shuffledCardIds.slice(index, index + maximumPairs));
  }

  return rounds;
}

export function selectChaosItem(
  currentState: ChaosRoundState,
  side: ChaosSide,
  cardId: string,
  dependencies: ChaosDependencies = {},
): ChaosTransition {
  const state = structuredClone(currentState);
  const playAudioCardId = side === 'word' ? cardId : undefined;

  if (!state.cardIds.includes(cardId)) {
    throw new Error('The selected Card does not belong to this Chaos round.');
  }

  if (
    state.status !== 'active' ||
    (side === 'word'
      ? state.completedWordCardIds.includes(cardId)
      : state.completedMeaningCardIds.includes(cardId))
  ) {
    return {
      state,
      interaction: 'ignored',
      statisticsDeltas: [],
      playAudioCardId,
    };
  }

  const selectedAtMs = readNow(dependencies);

  if (!state.selection) {
    state.selection = { side, cardId, selectedAtMs };
    return {
      state,
      interaction: 'selected',
      statisticsDeltas: [],
      playAudioCardId,
    };
  }

  if (state.selection.side === side) {
    state.selection = { side, cardId, selectedAtMs };
    return {
      state,
      interaction: 'selection-replaced',
      statisticsDeltas: [],
      playAudioCardId,
    };
  }

  const firstSelection = state.selection;
  const wordCardId = side === 'word' ? cardId : firstSelection.cardId;
  const meaningCardId = side === 'meaning' ? cardId : firstSelection.cardId;
  state.selection = null;

  if (wordCardId !== meaningCardId) {
    return {
      state,
      interaction: 'incorrect-match',
      statisticsDeltas: multipleChoiceErrorDeltas(
        wordCardId,
        meaningCardId,
      ),
      playAudioCardId,
      attemptedWordCardId: wordCardId,
      attemptedMeaningCardId: meaningCardId,
    };
  }

  const pairResponseTimeMs = Math.max(
    0,
    selectedAtMs - firstSelection.selectedAtMs,
  );
  state.completedCardIds.push(wordCardId);
  state.completedWordCardIds.push(wordCardId);
  state.completedMeaningCardIds.push(wordCardId);
  updateChaosCompletion(state, selectedAtMs);

  return {
    state,
    interaction: 'correct-match',
    statisticsDeltas: [
      correctCompletionDelta(wordCardId, pairResponseTimeMs),
    ],
    playAudioCardId,
    matchedCardId: wordCardId,
    pairResponseTimeMs,
  };
}

export function acceptChaosMismatch(
  currentState: ChaosRoundState,
  wordCardId: string,
  meaningCardId: string,
  dependencies: ChaosDependencies = {},
): ChaosTransition {
  const state = structuredClone(currentState);
  if (state.status !== 'active') {
    throw new Error('There is no active Chaos round.');
  }
  if (!state.cardIds.includes(wordCardId) || !state.cardIds.includes(meaningCardId)) {
    throw new Error('The corrected Chaos items do not belong to this round.');
  }
  const completedAtMs = readNow(dependencies);
  state.selection = null;
  state.completedWordCardIds = unique([...state.completedWordCardIds, wordCardId]);
  state.completedMeaningCardIds = unique([
    ...state.completedMeaningCardIds,
    meaningCardId,
  ]);
  updateChaosCompletion(state, completedAtMs);
  const cardIds = unique([wordCardId, meaningCardId]);
  return {
    state,
    interaction: 'manual-correct',
    statisticsDeltas: cardIds.map((cardId) =>
      correctCompletionDelta(cardId, Math.max(0, completedAtMs - state.startedAtMs)),
    ),
    playAudioCardId: wordCardId,
    attemptedWordCardId: wordCardId,
    attemptedMeaningCardId: meaningCardId,
  };
}

export function giveUpChaosPair(
  currentState: ChaosRoundState,
  dependencies: ChaosDependencies = {},
): ChaosTransition {
  const state = structuredClone(currentState);
  if (state.status !== 'active') {
    throw new Error('There is no active Chaos round.');
  }
  const cardId = state.cardIds.find(
    (candidate) =>
      !state.completedWordCardIds.includes(candidate) ||
      !state.completedMeaningCardIds.includes(candidate),
  );
  if (!cardId) throw new Error('Chaos has no unresolved pair.');
  const completedAtMs = readNow(dependencies);
  state.selection = null;
  state.completedCardIds = unique([...state.completedCardIds, cardId]);
  state.completedWordCardIds = unique([...state.completedWordCardIds, cardId]);
  state.completedMeaningCardIds = unique([
    ...state.completedMeaningCardIds,
    cardId,
  ]);
  updateChaosCompletion(state, completedAtMs);
  return {
    state,
    interaction: 'gave-up',
    statisticsDeltas: [
      unknownCompletionDelta(
        cardId,
        Math.max(0, completedAtMs - state.startedAtMs),
      ),
    ],
    playAudioCardId: cardId,
    revealedCardId: cardId,
  };
}

function updateChaosCompletion(
  state: ChaosRoundState,
  completedAtMs: number,
): void {
  if (
    state.completedWordCardIds.length === state.cardIds.length &&
    state.completedMeaningCardIds.length === state.cardIds.length
  ) {
    state.status = 'completed';
    state.completedAtMs = completedAtMs;
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function getChaosRoundElapsedMs(
  state: ChaosRoundState,
  currentTimeMs: number,
): number {
  const end = state.completedAtMs ?? currentTimeMs;
  return Math.max(0, end - state.startedAtMs);
}

function readNow(dependencies: ChaosDependencies): number {
  const value = (dependencies.now ?? Date.now)();

  if (!Number.isFinite(value)) {
    throw new Error('Chaos clock must return a finite number.');
  }

  return value;
}

function validateRoundSize(maximumPairs: number): void {
  if (!Number.isInteger(maximumPairs) || maximumPairs < 1 || maximumPairs > 10) {
    throw new Error('Chaos round size must be an integer from 1 to 10.');
  }
}
