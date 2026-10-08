import {
  correctCompletionDelta,
  type StatisticsDelta,
  unknownCompletionDelta,
} from "./statistics-engine";
import { type RandomSource, shuffle, systemRandom } from "./practice";

export interface HandwritingPracticeState {
  cardIds: string[];
  currentIndex: number;
  correctCount: number;
  incorrectCount: number;
  decision: boolean | null;
  startedAtMs: number;
  status: "active" | "completed";
}

export interface HandwritingPracticeDependencies {
  now?: () => number;
  random?: RandomSource;
}

export interface HandwritingPracticeTransition {
  state: HandwritingPracticeState;
  statisticsDelta: StatisticsDelta;
}

export function createHandwritingPractice(
  cardIds: readonly string[],
  dependencies: HandwritingPracticeDependencies = {},
): HandwritingPracticeState {
  if (cardIds.length === 0) {
    throw new Error("Handwriting practice requires at least one Card.");
  }
  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error("Handwriting practice Card ids must be unique.");
  }
  return {
    cardIds: shuffle(cardIds, dependencies.random ?? systemRandom),
    currentIndex: 0,
    correctCount: 0,
    incorrectCount: 0,
    decision: null,
    startedAtMs: readNow(dependencies),
    status: "active",
  };
}

export function answerHandwritingPractice(
  state: HandwritingPracticeState,
  correct: boolean,
  dependencies: HandwritingPracticeDependencies = {},
): HandwritingPracticeTransition {
  const cardId = currentHandwritingCardId(state);
  if (state.decision !== null) {
    throw new Error("The current handwriting Card was already answered.");
  }
  const responseTimeMs = Math.max(0, readNow(dependencies) - state.startedAtMs);
  return {
    state: {
      ...state,
      correctCount: state.correctCount + (correct ? 1 : 0),
      incorrectCount: state.incorrectCount + (correct ? 0 : 1),
      decision: correct,
    },
    statisticsDelta: correct
      ? correctCompletionDelta(cardId, responseTimeMs)
      : unknownCompletionDelta(cardId, responseTimeMs),
  };
}

export function advanceHandwritingPractice(
  state: HandwritingPracticeState,
  dependencies: HandwritingPracticeDependencies = {},
): HandwritingPracticeState {
  currentHandwritingCardId(state);
  if (state.decision === null) {
    throw new Error("Choose a handwriting result before continuing.");
  }
  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.cardIds.length) {
    return { ...state, status: "completed" };
  }
  return {
    ...state,
    currentIndex: nextIndex,
    decision: null,
    startedAtMs: readNow(dependencies),
  };
}

export function currentHandwritingCardId(
  state: HandwritingPracticeState,
): string {
  if (state.status !== "active") {
    throw new Error("Handwriting practice is already complete.");
  }
  const cardId = state.cardIds[state.currentIndex];
  if (!cardId) throw new Error("Handwriting practice has no current Card.");
  return cardId;
}

function readNow(dependencies: HandwritingPracticeDependencies): number {
  const value = (dependencies.now ?? Date.now)();
  if (!Number.isFinite(value)) {
    throw new Error("Handwriting practice clock must be finite.");
  }
  return value;
}
