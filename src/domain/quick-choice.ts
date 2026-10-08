import {
  createChoiceOptionCardIds,
  type ChoiceExerciseType,
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

export type QuickChoiceMode =
  | 'mixed'
  | 'meaning-to-word'
  | 'word-to-meaning';
export type QuickChoiceLength = 10 | 20 | 50 | 'endless';
export type QuickChoiceStatus = 'active' | 'completed' | 'stopped';

export interface QuickChoiceQuestionState {
  sequence: number;
  cardId: string;
  exerciseType: ChoiceExerciseType;
  optionCardIds: string[];
  incorrectAttempts: number;
  startedAtMs: number;
}

export interface QuickChoiceState {
  mode: QuickChoiceMode;
  length: QuickChoiceLength;
  status: QuickChoiceStatus;
  completedQuestionCount: number;
  remainingDeckCardIds: string[];
  nextQuestionSequence: number;
  currentQuestion: QuickChoiceQuestionState | null;
  lastCompletedCardId?: string;
}

export interface QuickChoiceDependencies {
  random?: RandomSource;
  now?: () => number;
}

export interface QuickChoiceTransition {
  state: QuickChoiceState;
  feedback: 'incorrect' | 'correct' | 'gave-up';
  answeredCardId: string;
  playAudioCardId?: string;
  statisticsDeltas: StatisticsDelta[];
}

export function createQuickChoiceSession(
  cards: readonly PracticeCard[],
  mode: QuickChoiceMode,
  length: QuickChoiceLength,
  dependencies: QuickChoiceDependencies = {},
): QuickChoiceState {
  validateCards(cards);
  validateLength(length);

  const state: QuickChoiceState = {
    mode,
    length,
    status: 'active',
    completedQuestionCount: 0,
    remainingDeckCardIds: [],
    nextQuestionSequence: 1,
    currentQuestion: null,
  };

  prepareQuickChoiceQuestion(state, cards, dependencies);
  return state;
}

export function answerQuickChoice(
  currentState: QuickChoiceState,
  cards: readonly PracticeCard[],
  selectedCardId: string,
  dependencies: QuickChoiceDependencies = {},
): QuickChoiceTransition {
  validateCards(cards);
  const state = structuredClone(currentState);
  const question = state.currentQuestion;

  if (state.status !== 'active' || !question) {
    throw new Error('There is no active Quick Choice question.');
  }

  if (!question.optionCardIds.includes(selectedCardId)) {
    throw new Error('The selected Card is not a visible answer option.');
  }

  if (selectedCardId !== question.cardId) {
    question.incorrectAttempts += 1;
    return {
      state,
      feedback: 'incorrect',
      answeredCardId: question.cardId,
      statisticsDeltas: multipleChoiceErrorDeltas(
        question.cardId,
        selectedCardId,
      ),
    };
  }

  return completeQuickChoiceQuestion(state, cards, question, 'correct', dependencies);
}

export function acceptRejectedQuickChoiceAnswer(
  stateBeforeRejectedAnswer: QuickChoiceState,
  cards: readonly PracticeCard[],
  dependencies: QuickChoiceDependencies = {},
): QuickChoiceTransition {
  validateCards(cards);
  const state = structuredClone(stateBeforeRejectedAnswer);
  const question = requireQuickChoiceQuestion(state);
  return completeQuickChoiceQuestion(state, cards, question, 'correct', dependencies);
}

export function giveUpQuickChoiceQuestion(
  currentState: QuickChoiceState,
  cards: readonly PracticeCard[],
  dependencies: QuickChoiceDependencies = {},
): QuickChoiceTransition {
  validateCards(cards);
  const state = structuredClone(currentState);
  const question = requireQuickChoiceQuestion(state);
  return completeQuickChoiceQuestion(state, cards, question, 'gave-up', dependencies);
}

function completeQuickChoiceQuestion(
  state: QuickChoiceState,
  cards: readonly PracticeCard[],
  question: QuickChoiceQuestionState,
  feedback: 'correct' | 'gave-up',
  dependencies: QuickChoiceDependencies,
): QuickChoiceTransition {
  const responseTimeMs = Math.max(0, readNow(dependencies) - question.startedAtMs);
  const statisticsDeltas = [
    feedback === 'correct'
      ? correctCompletionDelta(question.cardId, responseTimeMs)
      : unknownCompletionDelta(question.cardId, responseTimeMs),
  ];
  state.completedQuestionCount += 1;
  state.lastCompletedCardId = question.cardId;
  state.currentQuestion = null;
  prepareQuickChoiceQuestion(state, cards, dependencies);

  return {
    state,
    feedback,
    answeredCardId: question.cardId,
    playAudioCardId: question.cardId,
    statisticsDeltas,
  };
}

function requireQuickChoiceQuestion(
  state: QuickChoiceState,
): QuickChoiceQuestionState {
  if (state.status !== 'active' || !state.currentQuestion) {
    throw new Error('There is no active Quick Choice question.');
  }
  return state.currentQuestion;
}

export function stopQuickChoice(
  currentState: QuickChoiceState,
): QuickChoiceState {
  const state = structuredClone(currentState);

  if (state.status === 'active') {
    state.status = 'stopped';
    state.currentQuestion = null;
  }

  return state;
}

export function resumeQuickChoiceSession(
  currentState: QuickChoiceState,
  dependencies: QuickChoiceDependencies = {},
): QuickChoiceState {
  const state = structuredClone(currentState);
  if (state.status === 'active' && state.currentQuestion) {
    state.currentQuestion.startedAtMs = readNow(dependencies);
  }
  return state;
}

function prepareQuickChoiceQuestion(
  state: QuickChoiceState,
  cards: readonly PracticeCard[],
  dependencies: QuickChoiceDependencies,
): void {
  if (
    state.length !== 'endless' &&
    state.completedQuestionCount >= state.length
  ) {
    state.status = 'completed';
    state.currentQuestion = null;
    return;
  }

  const random = dependencies.random ?? systemRandom;

  if (state.remainingDeckCardIds.length === 0) {
    state.remainingDeckCardIds = shuffle(
      cards.map((card) => card.id),
      random,
    );
    if (
      state.remainingDeckCardIds.length > 1 &&
      state.remainingDeckCardIds[0] === state.lastCompletedCardId
    ) {
      const replacement = state.remainingDeckCardIds.findIndex(
        (cardId) => cardId !== state.lastCompletedCardId,
      );
      [state.remainingDeckCardIds[0], state.remainingDeckCardIds[replacement]] = [
        state.remainingDeckCardIds[replacement] as string,
        state.remainingDeckCardIds[0] as string,
      ];
    }
  }

  const cardId = state.remainingDeckCardIds.shift();

  if (!cardId) {
    throw new Error('Quick Choice could not select a Card.');
  }

  const expectedCard = cards.find((card) => card.id === cardId);
  if (!expectedCard) throw new Error('Quick Choice Card was not found.');
  const requestedExerciseType = resolveExerciseType(state.mode, random);
  const exerciseType =
    expectedCard.ambiguousMeaning && requestedExerciseType === 'meaning-to-word'
      ? 'word-to-meaning'
      : requestedExerciseType;
  const sequence = state.nextQuestionSequence;
  state.nextQuestionSequence += 1;
  state.currentQuestion = {
    sequence,
    cardId,
    exerciseType,
    optionCardIds: createChoiceOptionCardIds({
      expectedCardId: cardId,
      candidates: cards,
      exerciseType,
      random,
    }),
    incorrectAttempts: 0,
    startedAtMs: readNow(dependencies),
  };
}

function resolveExerciseType(
  mode: QuickChoiceMode,
  random: RandomSource,
): ChoiceExerciseType {
  if (mode !== 'mixed') {
    return mode;
  }

  return random() < 0.5 ? 'meaning-to-word' : 'word-to-meaning';
}

function validateCards(cards: readonly PracticeCard[]): void {
  if (cards.length === 0) {
    throw new Error('Quick Choice requires at least one Card.');
  }

  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error('Quick Choice Card ids must be unique.');
  }
}

function validateLength(length: QuickChoiceLength): void {
  if (![10, 20, 50, 'endless'].includes(length)) {
    throw new Error('Unsupported Quick Choice length.');
  }
}

function readNow(dependencies: QuickChoiceDependencies): number {
  const value = (dependencies.now ?? Date.now)();

  if (!Number.isFinite(value)) {
    throw new Error('Quick Choice clock must return a finite number.');
  }

  return value;
}
