import type { LearningStage } from '../models';
import {
  choiceOptionValueKey,
  createChoiceOptionCardIds,
  type ExerciseType,
  type PracticeCard,
  randomInteger,
  type RandomSource,
  shuffle,
  systemRandom,
} from '../practice';
import {
  correctCompletionDelta,
  errorDelta,
  giveUpCompletionDelta,
  multipleChoiceErrorDeltas,
  type StatisticsDelta,
  typingErrorDeltas,
} from '../statistics-engine';
import {
  findMistakenCardByTypingAnswer,
  isPracticeCardTypingMatch,
} from '../typing';
import { MAX_LEARN_BATCH_SIZE, takeNextBatch } from './batch';
import {
  type CreateLearnSessionInput,
  type DelayedRetryState,
  LEARN_SESSION_STATE_VERSION,
  type LearnQuestionState,
  type LearnSessionState,
  type LearnTransition,
} from './types';

export type MillisecondClock = () => number;

export interface LearningEngineDependencies {
  random?: RandomSource;
  now?: MillisecondClock;
}

const systemClock: MillisecondClock = Date.now;

export function createLearnSession(
  input: CreateLearnSessionInput,
  dependencies: LearningEngineDependencies = {},
): LearnSessionState {
  const catalog = createCatalog(input.cards);
  const difficultCardIds = [...(input.difficultCardIds ?? [])];
  const difficultSet = new Set(difficultCardIds);
  const newCardIds = input.newCardIds
    ? [...input.newCardIds]
    : input.cards
        .map((card) => card.id)
        .filter((cardId) => !difficultSet.has(cardId));

  assertUniqueCardIds(newCardIds, 'new Cards');
  assertUniqueCardIds(difficultCardIds, 'difficult Cards');
  assertDisjoint(newCardIds, difficultCardIds);
  assertCardsExist([...newCardIds, ...difficultCardIds], catalog);

  const state: LearnSessionState = {
    version: LEARN_SESSION_STATE_VERSION,
    id: input.id,
    lessonId: input.lessonId,
    status: 'active',
    remainingNewCardIds: newCardIds,
    difficultCardIds,
    learnedCardIds: [],
    participatedCardIds: [],
    currentBatch: null,
    currentQuestion: null,
    delayedRetries: [],
    completedQuestionCount: 0,
    nextQuestionSequence: 1,
  };

  createNextBatch(state, dependencies.random ?? systemRandom);
  prepareNextQuestion(state, catalog, dependencies, []);
  return state;
}

export function resumeLearnSession(
  persistedState: LearnSessionState,
  cards: readonly PracticeCard[],
  dependencies: LearningEngineDependencies = {},
): LearnSessionState {
  const state = cloneState(persistedState);
  const catalog = createCatalog(cards);
  normalizeSavedLearnQuestions(
    state,
    catalog,
    dependencies.random ?? systemRandom,
  );
  validateSessionState(state, catalog);

  if (state.status === 'active' && state.currentQuestion) {
    state.currentQuestion.startedAtMs = now(dependencies);
  }

  return state;
}

export function answerLearnChoice(
  currentState: LearnSessionState,
  cards: readonly PracticeCard[],
  selectedCardId: string,
  dependencies: LearningEngineDependencies = {},
): LearnTransition {
  const state = cloneState(currentState);
  const catalog = createCatalog(cards);
  validateSessionState(state, catalog);
  const question = requireCurrentQuestion(state);

  if (question.exerciseType === 'meaning-to-typing') {
    throw new Error('The current Learn question requires a typed answer.');
  }

  if (!question.optionCardIds.includes(selectedCardId)) {
    throw new Error('The selected Card is not a visible answer option.');
  }

  if (selectedCardId !== question.cardId) {
    return recordIncorrectAnswer(
      state,
      question,
      multipleChoiceErrorDeltas(question.cardId, selectedCardId),
      dependencies,
    );
  }

  return completeCorrectAnswer(state, question, catalog, dependencies);
}

export function answerLearnTyping(
  currentState: LearnSessionState,
  cards: readonly PracticeCard[],
  answer: string,
  dependencies: LearningEngineDependencies = {},
): LearnTransition {
  const state = cloneState(currentState);
  const catalog = createCatalog(cards);
  validateSessionState(state, catalog);
  const question = requireCurrentQuestion(state);

  if (question.exerciseType !== 'meaning-to-typing') {
    throw new Error('The current Learn question does not accept typed answers.');
  }

  const expected = requirePracticeCard(catalog, question.cardId);

  if (!isPracticeCardTypingMatch(answer, expected)) {
    const mistaken = findMistakenCardByTypingAnswer(
      answer,
      expected.id,
      cards,
    );
    return recordIncorrectAnswer(
      state,
      question,
      typingErrorDeltas(expected.id, mistaken?.id),
      dependencies,
    );
  }

  return completeCorrectAnswer(state, question, catalog, dependencies);
}

export function giveUpLearnQuestion(
  currentState: LearnSessionState,
  cards: readonly PracticeCard[],
  dependencies: LearningEngineDependencies = {},
): LearnTransition {
  const state = cloneState(currentState);
  const catalog = createCatalog(cards);
  validateSessionState(state, catalog);
  const question = requireCurrentQuestion(state);

  const newlyLearnedCardIds: string[] = [];
  const responseTimeMs = elapsedSince(question.startedAtMs, dependencies);
  const statisticsDeltas = [
    ...(question.incorrectAttempts === 0 ? [errorDelta(question.cardId)] : []),
    giveUpCompletionDelta(question.cardId, responseTimeMs),
  ];

  if (question.incorrectAttempts === 0) {
    question.incorrectAttempts = 1;
    markExpectedCardDirty(state, question.cardId);
    scheduleDelayedRetry(state, question, dependencies.random ?? systemRandom);
  }

  finishQuestion(state, question.cardId);
  prepareNextQuestion(state, catalog, dependencies, newlyLearnedCardIds);

  return {
    state,
    feedback: 'gave-up',
    answeredCardId: question.cardId,
    revealAnswer: true,
    giveUpAvailable: false,
    playAudioCardId: question.cardId,
    statisticsDeltas,
    newlyLearnedCardIds,
  };
}

export function acceptRejectedLearnAnswer(
  stateBeforeRejectedAnswer: LearnSessionState,
  cards: readonly PracticeCard[],
  dependencies: LearningEngineDependencies = {},
): LearnTransition {
  const state = cloneState(stateBeforeRejectedAnswer);
  const catalog = createCatalog(cards);
  validateSessionState(state, catalog);
  const question = requireCurrentQuestion(state);
  return completeCorrectAnswer(state, question, catalog, dependencies);
}

function completeCorrectAnswer(
  state: LearnSessionState,
  question: LearnQuestionState,
  catalog: Map<string, PracticeCard>,
  dependencies: LearningEngineDependencies,
): LearnTransition {
  const newlyLearnedCardIds: string[] = [];
  const statisticsDeltas = [
    correctCompletionDelta(
      question.cardId,
      elapsedSince(question.startedAtMs, dependencies),
    ),
  ];

  finishQuestion(state, question.cardId);
  prepareNextQuestion(state, catalog, dependencies, newlyLearnedCardIds);

  return {
    state,
    feedback: 'correct',
    answeredCardId: question.cardId,
    revealAnswer: false,
    giveUpAvailable: false,
    playAudioCardId: question.cardId,
    statisticsDeltas,
    newlyLearnedCardIds,
  };
}

function recordIncorrectAnswer(
  state: LearnSessionState,
  question: LearnQuestionState,
  statisticsDeltas: StatisticsDelta[],
  dependencies: LearningEngineDependencies,
): LearnTransition {
  question.incorrectAttempts += 1;
  markExpectedCardDirty(state, question.cardId);
  scheduleDelayedRetry(state, question, dependencies.random ?? systemRandom);

  return {
    state,
    feedback: 'incorrect',
    answeredCardId: question.cardId,
    revealAnswer: false,
    giveUpAvailable: question.incorrectAttempts >= 2,
    statisticsDeltas,
    newlyLearnedCardIds: [],
  };
}

function finishQuestion(state: LearnSessionState, cardId: string): void {
  state.completedQuestionCount += 1;
  state.lastCompletedCardId = cardId;
  state.currentQuestion = null;
}

function prepareNextQuestion(
  state: LearnSessionState,
  catalog: Map<string, PracticeCard>,
  dependencies: LearningEngineDependencies,
  newlyLearnedCardIds: string[],
): void {
  const random = dependencies.random ?? systemRandom;

  while (state.status === 'active' && !state.currentQuestion) {
    const dueRetry = takeDueRetry(
      state,
      state.lastCompletedCardId,
      !hasAlternativeCard(state, state.lastCompletedCardId),
    );

    if (dueRetry) {
      state.currentQuestion = createRetryQuestion(
        state,
        dueRetry,
        catalog,
        dependencies,
      );
      return;
    }

    const batch = state.currentBatch;

    if (!batch) {
      state.status = 'completed';
      return;
    }

    if (batch.nextPrimaryIndex < batch.stageCardOrder.length) {
      moveDifferentCardToCurrentPosition(
        batch.stageCardOrder,
        batch.nextPrimaryIndex,
        state.lastCompletedCardId,
      );
      const cardId = batch.stageCardOrder[batch.nextPrimaryIndex] as string;
      batch.nextPrimaryIndex += 1;
      state.currentQuestion = createPrimaryQuestion(
        state,
        cardId,
        batch.stage,
        catalog,
        dependencies,
      );
      return;
    }

    if (batch.stage < 3) {
      batch.stage = (batch.stage + 1) as LearningStage;
      batch.stageCardOrder = shuffle(batch.cardIds, random);
      moveDifferentCardToCurrentPosition(
        batch.stageCardOrder,
        0,
        state.lastCompletedCardId,
      );
      batch.nextPrimaryIndex = 0;
      continue;
    }

    if (batch.dirtyCardIds.length === 0) {
      const pendingForCleanBatch = takeEarliestRetryForCards(
        state,
        batch.cardIds,
      );

      if (pendingForCleanBatch) {
        state.currentQuestion = createRetryQuestion(
          state,
          pendingForCleanBatch,
          catalog,
          dependencies,
        );
        return;
      }
    }

    finalizeBatch(state, newlyLearnedCardIds);
    createNextBatch(state, random);
  }
}

function createNextBatch(
  state: LearnSessionState,
  random: RandomSource,
): void {
  const plan = takeNextBatch(
    state.difficultCardIds,
    state.remainingNewCardIds,
    MAX_LEARN_BATCH_SIZE,
  );

  if (plan.cardIds.length === 0) {
    state.currentBatch = null;
    state.status = 'completed';
    return;
  }

  state.remainingNewCardIds = plan.remainingNewCardIds;
  state.participatedCardIds = unique([
    ...state.participatedCardIds,
    ...plan.cardIds,
  ]);
  state.currentBatch = {
    number: (state.currentBatch?.number ?? 0) + 1,
    cardIds: plan.cardIds,
    stage: 1,
    stageCardOrder: shuffle(plan.cardIds, random),
    nextPrimaryIndex: 0,
    dirtyCardIds: [],
  };
  moveDifferentCardToCurrentPosition(
    state.currentBatch.stageCardOrder,
    0,
    state.lastCompletedCardId,
  );
}

function finalizeBatch(
  state: LearnSessionState,
  newlyLearnedCardIds: string[],
): void {
  const batch = state.currentBatch;

  if (!batch) {
    return;
  }

  const dirty = new Set(batch.dirtyCardIds);
  const clean = batch.cardIds.filter((cardId) => !dirty.has(cardId));
  const waitingDifficult = state.difficultCardIds.filter(
    (cardId) => !batch.cardIds.includes(cardId),
  );

  state.difficultCardIds = unique([
    ...batch.dirtyCardIds,
    ...waitingDifficult,
  ]);
  state.learnedCardIds = unique([...state.learnedCardIds, ...clean]);
  newlyLearnedCardIds.push(...clean);
  state.currentBatch = {
    ...batch,
    number: batch.number,
  };
  state.currentQuestion = null;
}

function createPrimaryQuestion(
  state: LearnSessionState,
  cardId: string,
  stage: LearningStage,
  catalog: Map<string, PracticeCard>,
  dependencies: LearningEngineDependencies,
): LearnQuestionState {
  return createQuestion(
    state,
    cardId,
    stageToExerciseType(stage, requirePracticeCard(catalog, cardId)),
    stage,
    'primary',
    catalog,
    dependencies,
  );
}

function createRetryQuestion(
  state: LearnSessionState,
  retry: DelayedRetryState,
  catalog: Map<string, PracticeCard>,
  dependencies: LearningEngineDependencies,
): LearnQuestionState {
  return createQuestion(
    state,
    retry.cardId,
    retry.exerciseType,
    retry.stage,
    'delayed-retry',
    catalog,
    dependencies,
  );
}

function createQuestion(
  state: LearnSessionState,
  cardId: string,
  exerciseType: ExerciseType,
  stage: LearningStage,
  source: LearnQuestionState['source'],
  catalog: Map<string, PracticeCard>,
  dependencies: LearningEngineDependencies,
): LearnQuestionState {
  const expectedCard = requirePracticeCard(catalog, cardId);
  const sequence = state.nextQuestionSequence;
  state.nextQuestionSequence += 1;
  const optionCardIds =
    exerciseType === 'meaning-to-typing'
      ? []
      : createChoiceOptionCardIds({
          expectedCardId: cardId,
          candidates: choiceCandidatesForCard(state, expectedCard, catalog),
          exerciseType,
          random: dependencies.random ?? systemRandom,
        });

  return {
    sequence,
    cardId,
    exerciseType,
    stage,
    source,
    optionCardIds,
    incorrectAttempts: 0,
    startedAtMs: now(dependencies),
  };
}

function normalizeSavedLearnQuestions(
  state: LearnSessionState,
  catalog: Map<string, PracticeCard>,
  random: RandomSource,
): void {
  const question = state.currentQuestion;
  if (question) {
    const expectedCard = requirePracticeCard(catalog, question.cardId);
    let exerciseTypeChanged = false;
    if (
      question.exerciseType === 'meaning-to-typing' &&
      expectedCard.isKanaStudy &&
      !expectedCard.requiresHandwriting
    ) {
      question.exerciseType = 'meaning-to-word';
      exerciseTypeChanged = true;
    } else if (
      question.exerciseType === 'meaning-to-word' &&
      expectedCard.ambiguousMeaning
    ) {
      question.exerciseType = 'word-to-meaning';
      exerciseTypeChanged = true;
    }

    if (question.exerciseType !== 'meaning-to-typing') {
      const choiceExerciseType = question.exerciseType;
      const visibleValues = question.optionCardIds.map((cardId) =>
        choiceOptionValueKey(
          requirePracticeCard(catalog, cardId),
          choiceExerciseType,
        ),
      );
      const hasDuplicateVisibleOptions =
        new Set(visibleValues).size !== visibleValues.length;
      if (
        exerciseTypeChanged ||
        hasDuplicateVisibleOptions ||
        !question.optionCardIds.includes(question.cardId)
      ) {
        question.optionCardIds = createChoiceOptionCardIds({
          expectedCardId: question.cardId,
          candidates: choiceCandidatesForCard(state, expectedCard, catalog),
          exerciseType: choiceExerciseType,
          random,
        });
      }
    }
  }

  for (const retry of state.delayedRetries) {
    const expectedCard = requirePracticeCard(catalog, retry.cardId);
    if (
      retry.exerciseType === 'meaning-to-typing' &&
      expectedCard.isKanaStudy &&
      !expectedCard.requiresHandwriting
    ) {
      retry.exerciseType = 'meaning-to-word';
    } else if (
      retry.exerciseType === 'meaning-to-word' &&
      expectedCard.ambiguousMeaning
    ) {
      retry.exerciseType = 'word-to-meaning';
    }
  }
}

function choiceCandidatesForCard(
  state: LearnSessionState,
  expectedCard: PracticeCard,
  catalog: Map<string, PracticeCard>,
): PracticeCard[] {
  return expectedCard.isKanaStudy
    ? [...catalog.values()].filter((card) => card.isKanaStudy)
    : state.participatedCardIds.map((id) => requirePracticeCard(catalog, id));
}

function scheduleDelayedRetry(
  state: LearnSessionState,
  question: LearnQuestionState,
  random: RandomSource,
): void {
  if (
    state.delayedRetries.some(
      (retry) =>
        retry.cardId === question.cardId &&
        retry.exerciseType === question.exerciseType &&
        retry.createdAtQuestionSequence === question.sequence,
    )
  ) {
    return;
  }
  const delay = randomInteger(5, 10, random);
  const retryNumberForQuestion =
    state.delayedRetries.filter(
      (retry) => retry.createdAtQuestionSequence === question.sequence,
    ).length + 1;

  state.delayedRetries.push({
    id: `${question.sequence}:${question.incorrectAttempts}:${retryNumberForQuestion}`,
    cardId: question.cardId,
    exerciseType: question.exerciseType,
    stage: question.stage,
    sourceBatchNumber: state.currentBatch?.number ?? 0,
    dueAfterCompletedQuestions:
      state.completedQuestionCount + delay + 1,
    createdAtQuestionSequence: question.sequence,
  });
}

function takeDueRetry(
  state: LearnSessionState,
  avoidCardId?: string,
  allowAvoided = true,
): DelayedRetryState | undefined {
  let index = state.delayedRetries.findIndex(
    (retry) =>
      retry.dueAfterCompletedQuestions <= state.completedQuestionCount &&
      retry.cardId !== avoidCardId,
  );

  if (index < 0 && allowAvoided) {
    index = state.delayedRetries.findIndex(
      (retry) =>
        retry.dueAfterCompletedQuestions <= state.completedQuestionCount,
    );
  }

  return takeRetryAt(state, index);
}

function hasAlternativeCard(
  state: LearnSessionState,
  cardId?: string,
): boolean {
  if (!cardId) return false;
  return Boolean(
    state.currentBatch?.cardIds.some((candidate) => candidate !== cardId) ||
      state.remainingNewCardIds.some((candidate) => candidate !== cardId) ||
      state.difficultCardIds.some((candidate) => candidate !== cardId),
  );
}

function moveDifferentCardToCurrentPosition(
  order: string[],
  position: number,
  avoidCardId?: string,
): void {
  if (!avoidCardId || order[position] !== avoidCardId) return;
  const replacement = order.findIndex(
    (cardId, index) => index > position && cardId !== avoidCardId,
  );
  if (replacement < 0) return;
  [order[position], order[replacement]] = [
    order[replacement] as string,
    order[position] as string,
  ];
}

function takeEarliestRetryForCards(
  state: LearnSessionState,
  cardIds: readonly string[],
): DelayedRetryState | undefined {
  const allowed = new Set(cardIds);
  let selectedIndex = -1;

  for (let index = 0; index < state.delayedRetries.length; index += 1) {
    const retry = state.delayedRetries[index] as DelayedRetryState;

    if (!allowed.has(retry.cardId)) {
      continue;
    }

    if (
      selectedIndex === -1 ||
      retry.dueAfterCompletedQuestions <
        (state.delayedRetries[selectedIndex] as DelayedRetryState)
          .dueAfterCompletedQuestions
    ) {
      selectedIndex = index;
    }
  }

  return takeRetryAt(state, selectedIndex);
}

function takeRetryAt(
  state: LearnSessionState,
  index: number,
): DelayedRetryState | undefined {
  if (index < 0) {
    return undefined;
  }

  const [retry] = state.delayedRetries.splice(index, 1);
  return retry;
}

function markExpectedCardDirty(
  state: LearnSessionState,
  cardId: string,
): void {
  const batch = state.currentBatch;

  if (batch?.cardIds.includes(cardId)) {
    batch.dirtyCardIds = unique([...batch.dirtyCardIds, cardId]);
  }
}

function stageToExerciseType(
  stage: LearningStage,
  card: PracticeCard,
): ExerciseType {
  if (stage === 1) {
    return card.ambiguousMeaning ? 'word-to-meaning' : 'meaning-to-word';
  }

  if (stage === 2) {
    return 'word-to-meaning';
  }

  if (card.requiresHandwriting) return 'meaning-to-typing';
  return card.isKanaStudy ? 'meaning-to-word' : 'meaning-to-typing';
}

function requireCurrentQuestion(state: LearnSessionState): LearnQuestionState {
  if (state.status !== 'active' || !state.currentQuestion) {
    throw new Error('There is no active Learn question.');
  }

  return state.currentQuestion;
}

function createCatalog(cards: readonly PracticeCard[]): Map<string, PracticeCard> {
  assertUniqueCardIds(
    cards.map((card) => card.id),
    'practice Cards',
  );
  return new Map(cards.map((card) => [card.id, card]));
}

function requirePracticeCard(
  catalog: Map<string, PracticeCard>,
  cardId: string,
): PracticeCard {
  const card = catalog.get(cardId);

  if (!card) {
    throw new Error(`Practice Card "${cardId}" was not found.`);
  }

  return card;
}

function validateSessionState(
  state: LearnSessionState,
  catalog: Map<string, PracticeCard>,
): void {
  if (state.version !== LEARN_SESSION_STATE_VERSION) {
    throw new Error(`Unsupported Learn session version: ${state.version}.`);
  }

  assertCardsExist(
    unique([
      ...state.remainingNewCardIds,
      ...state.difficultCardIds,
      ...state.learnedCardIds,
      ...state.participatedCardIds,
      ...(state.currentBatch?.cardIds ?? []),
      ...(state.currentQuestion ? [state.currentQuestion.cardId] : []),
      ...state.delayedRetries.map((retry) => retry.cardId),
    ]),
    catalog,
  );
}

function assertCardsExist(
  cardIds: readonly string[],
  catalog: Map<string, PracticeCard>,
): void {
  for (const cardId of cardIds) {
    requirePracticeCard(catalog, cardId);
  }
}

function assertUniqueCardIds(cardIds: readonly string[], label: string): void {
  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error(`Duplicate Card ids are not allowed in ${label}.`);
  }
}

function assertDisjoint(
  newCardIds: readonly string[],
  difficultCardIds: readonly string[],
): void {
  const newCards = new Set(newCardIds);

  if (difficultCardIds.some((cardId) => newCards.has(cardId))) {
    throw new Error('A Card cannot be both new and difficult.');
  }
}

function elapsedSince(
  startedAtMs: number,
  dependencies: LearningEngineDependencies,
): number {
  return Math.max(0, now(dependencies) - startedAtMs);
}

function now(dependencies: LearningEngineDependencies): number {
  const value = (dependencies.now ?? systemClock)();

  if (!Number.isFinite(value)) {
    throw new Error('Learning clock must return a finite number.');
  }

  return value;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function cloneState(state: LearnSessionState): LearnSessionState {
  return structuredClone(state);
}
