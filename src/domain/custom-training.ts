import {
  createChoiceOptionCardIds,
  type PracticeCard,
  type RandomSource,
  shuffle,
  systemRandom,
} from "./practice";
import {
  correctCompletionDelta,
  multipleChoiceErrorDeltas,
  type StatisticsDelta,
  typingErrorDeltas,
  unknownCompletionDelta,
} from "./statistics-engine";
import {
  findMistakenCardByTypingAnswer,
  isPracticeCardTypingMatch,
} from "./typing";

export type TrainingExerciseType =
  | "meaning-choice"
  | "word-choice"
  | "audio-choice"
  | "audio-typing"
  | "meaning-typing";
export type TrainingStatus = "active" | "completed" | "stopped";

export interface TrainingQuestionPlan {
  cardId: string;
  exerciseType: TrainingExerciseType;
}

export interface TrainingQuestion extends TrainingQuestionPlan {
  sequence: number;
  optionCardIds: string[];
  incorrectAttempts: number;
  startedAtMs: number;
}

export interface TrainingState {
  exerciseTypes: TrainingExerciseType[];
  status: TrainingStatus;
  completedQuestionCount: number;
  totalQuestionCount: number;
  remainingQuestions: TrainingQuestionPlan[];
  nextQuestionSequence: number;
  currentQuestion: TrainingQuestion | null;
}

export interface TrainingDependencies {
  random?: RandomSource;
  now?: () => number;
  randomizeDeck?: boolean;
  choiceCandidates?: readonly PracticeCard[];
}

export interface TrainingTransition {
  state: TrainingState;
  feedback: "incorrect" | "correct" | "gave-up";
  answeredCardId: string;
  playAudioCardId?: string;
  statisticsDeltas: StatisticsDelta[];
}

export function isChoiceTrainingExercise(type: TrainingExerciseType): boolean {
  return type.endsWith("-choice");
}

export function isAudioPromptTrainingExercise(type: TrainingExerciseType): boolean {
  return type.startsWith("audio-");
}

export function createTrainingSession(
  cards: readonly PracticeCard[],
  exerciseTypes: readonly TrainingExerciseType[],
  dependencies: TrainingDependencies = {},
): TrainingState {
  validateCards(cards);
  validateExerciseTypes(exerciseTypes);
  const uniqueTypes = [...new Set(exerciseTypes)];
  const random = dependencies.random ?? systemRandom;
  const remainingQuestions = createQuestionPlan(
    cards,
    uniqueTypes,
    dependencies.randomizeDeck ?? true,
    random,
  );
  const state: TrainingState = {
    exerciseTypes: uniqueTypes,
    status: "active",
    completedQuestionCount: 0,
    totalQuestionCount: remainingQuestions.length,
    remainingQuestions,
    nextQuestionSequence: 1,
    currentQuestion: null,
  };
  prepareQuestion(state, cards, dependencies);
  return state;
}

export function answerTrainingChoice(
  currentState: TrainingState,
  cards: readonly PracticeCard[],
  selectedCardId: string,
  dependencies: TrainingDependencies = {},
): TrainingTransition {
  const state = structuredClone(currentState);
  const question = requireQuestion(state);
  if (!isChoiceTrainingExercise(question.exerciseType)) {
    throw new Error("The active training question does not accept a choice.");
  }
  if (!question.optionCardIds.includes(selectedCardId)) {
    throw new Error("The selected Card is not a visible answer option.");
  }
  if (selectedCardId !== question.cardId) {
    question.incorrectAttempts += 1;
    return {
      state,
      feedback: "incorrect",
      answeredCardId: question.cardId,
      statisticsDeltas: multipleChoiceErrorDeltas(question.cardId, selectedCardId),
    };
  }
  return completeQuestion(state, cards, question, "correct", dependencies);
}

export function answerTrainingTyping(
  currentState: TrainingState,
  cards: readonly PracticeCard[],
  answer: string,
  dependencies: TrainingDependencies = {},
): TrainingTransition {
  const state = structuredClone(currentState);
  const question = requireQuestion(state);
  if (isChoiceTrainingExercise(question.exerciseType)) {
    throw new Error("The active training question requires a choice.");
  }
  const expected = cards.find((card) => card.id === question.cardId);
  if (!expected) throw new Error("The expected training Card was not found.");
  if (!isPracticeCardTypingMatch(answer, expected)) {
    question.incorrectAttempts += 1;
    const mistaken = findMistakenCardByTypingAnswer(answer, expected.id, cards);
    return {
      state,
      feedback: "incorrect",
      answeredCardId: question.cardId,
      statisticsDeltas: typingErrorDeltas(question.cardId, mistaken?.id),
    };
  }
  return completeQuestion(state, cards, question, "correct", dependencies);
}

export function acceptRejectedTrainingAnswer(
  stateBeforeRejectedAnswer: TrainingState,
  cards: readonly PracticeCard[],
  dependencies: TrainingDependencies = {},
): TrainingTransition {
  const state = structuredClone(stateBeforeRejectedAnswer);
  const question = requireQuestion(state);
  return completeQuestion(state, cards, question, "correct", dependencies);
}

export function giveUpTrainingQuestion(
  currentState: TrainingState,
  cards: readonly PracticeCard[],
  dependencies: TrainingDependencies = {},
): TrainingTransition {
  const state = structuredClone(currentState);
  const question = requireQuestion(state);
  return completeQuestion(state, cards, question, "gave-up", dependencies);
}

export function stopTraining(state: TrainingState): TrainingState {
  const stopped = structuredClone(state);
  if (stopped.status === "active") {
    stopped.status = "stopped";
    stopped.currentQuestion = null;
  }
  return stopped;
}

export function resumeTraining(
  state: TrainingState,
  dependencies: TrainingDependencies = {},
): TrainingState {
  const resumed = structuredClone(state);
  if (resumed.status === "active" && resumed.currentQuestion) {
    resumed.currentQuestion.startedAtMs = readNow(dependencies);
  }
  return resumed;
}

function createQuestionPlan(
  cards: readonly PracticeCard[],
  exerciseTypes: readonly TrainingExerciseType[],
  randomize: boolean,
  random: RandomSource,
): TrainingQuestionPlan[] {
  const result: TrainingQuestionPlan[] = [];
  let lastCardId: string | undefined;
  for (const exerciseType of exerciseTypes) {
    const orderedCards = randomize ? shuffle(cards, random) : [...cards];
    if (orderedCards.length > 1 && orderedCards[0]?.id === lastCardId) {
      const alternative = orderedCards.findIndex((card) => card.id !== lastCardId);
      [orderedCards[0], orderedCards[alternative]] = [
        orderedCards[alternative] as PracticeCard,
        orderedCards[0] as PracticeCard,
      ];
    }
    for (const card of orderedCards) {
      result.push({
        cardId: card.id,
        exerciseType: kanaSafeExerciseType(card, exerciseType),
      });
      lastCardId = card.id;
    }
  }
  return result;
}

function kanaSafeExerciseType(
  card: PracticeCard,
  exerciseType: TrainingExerciseType,
): TrainingExerciseType {
  if (!card.isKanaStudy) return exerciseType;
  if (
    card.ambiguousMeaning &&
    ["meaning-choice", "audio-choice"].includes(exerciseType)
  ) {
    return "word-choice";
  }
  if (card.requiresHandwriting) return exerciseType;
  if (exerciseType === "meaning-typing") return "meaning-choice";
  if (exerciseType === "audio-typing") return "audio-choice";
  return exerciseType;
}

function completeQuestion(
  state: TrainingState,
  cards: readonly PracticeCard[],
  question: TrainingQuestion,
  feedback: "correct" | "gave-up",
  dependencies: TrainingDependencies,
): TrainingTransition {
  const responseTimeMs = Math.max(
    0,
    readNow(dependencies) - question.startedAtMs,
  );
  const statisticsDeltas = [
    feedback === "correct"
      ? correctCompletionDelta(question.cardId, responseTimeMs)
      : unknownCompletionDelta(question.cardId, responseTimeMs),
  ];
  state.completedQuestionCount += 1;
  state.currentQuestion = null;
  prepareQuestion(state, cards, dependencies);
  return {
    state,
    feedback,
    answeredCardId: question.cardId,
    playAudioCardId: question.cardId,
    statisticsDeltas,
  };
}

function prepareQuestion(
  state: TrainingState,
  cards: readonly PracticeCard[],
  dependencies: TrainingDependencies,
): void {
  const plan = state.remainingQuestions.shift();
  if (!plan) {
    state.status = "completed";
    state.currentQuestion = null;
    return;
  }
  const random = dependencies.random ?? systemRandom;
  const choiceCandidates = dependencies.choiceCandidates ?? cards;
  const optionExerciseType = plan.exerciseType === "meaning-choice"
    ? "meaning-to-word"
    : "word-to-meaning";
  state.currentQuestion = {
    ...plan,
    sequence: state.nextQuestionSequence++,
    optionCardIds: isChoiceTrainingExercise(plan.exerciseType)
      ? createChoiceOptionCardIds({
          expectedCardId: plan.cardId,
          candidates: choiceCandidates,
          exerciseType: optionExerciseType,
          random,
        })
      : [],
    incorrectAttempts: 0,
    startedAtMs: readNow(dependencies),
  };
}

function requireQuestion(state: TrainingState): TrainingQuestion {
  if (state.status !== "active" || !state.currentQuestion) {
    throw new Error("There is no active training question.");
  }
  return state.currentQuestion;
}

function validateCards(cards: readonly PracticeCard[]): void {
  if (cards.length === 0) throw new Error("Training requires at least one Card.");
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error("Training Card ids must be unique.");
  }
}

function validateExerciseTypes(exerciseTypes: readonly TrainingExerciseType[]): void {
  const supported: TrainingExerciseType[] = [
    "meaning-choice",
    "word-choice",
    "audio-choice",
    "audio-typing",
    "meaning-typing",
  ];
  if (exerciseTypes.length === 0 || exerciseTypes.some((type) => !supported.includes(type))) {
    throw new Error("Training requires at least one supported exercise type.");
  }
}

function readNow(dependencies: TrainingDependencies): number {
  const value = (dependencies.now ?? Date.now)();
  if (!Number.isFinite(value)) throw new Error("Training clock must be finite.");
  return value;
}
