import type { LearningStage } from '../models';
import type { ExerciseType, PracticeCard } from '../practice';
import type { StatisticsDelta } from '../statistics-engine';

export const LEARN_SESSION_STATE_VERSION = 1;

export type LearnSessionStatus = 'active' | 'completed';
export type LearnQuestionSource = 'primary' | 'delayed-retry';

export interface LearnQuestionState {
  sequence: number;
  cardId: string;
  exerciseType: ExerciseType;
  stage: LearningStage;
  source: LearnQuestionSource;
  optionCardIds: string[];
  incorrectAttempts: number;
  startedAtMs: number;
}

export interface DelayedRetryState {
  id: string;
  cardId: string;
  exerciseType: ExerciseType;
  stage: LearningStage;
  sourceBatchNumber: number;
  dueAfterCompletedQuestions: number;
  createdAtQuestionSequence: number;
}

export interface LearnBatchState {
  number: number;
  cardIds: string[];
  stage: LearningStage;
  stageCardOrder: string[];
  nextPrimaryIndex: number;
  dirtyCardIds: string[];
}

export interface LearnSessionState {
  version: typeof LEARN_SESSION_STATE_VERSION;
  id: string;
  lessonId: string;
  status: LearnSessionStatus;
  remainingNewCardIds: string[];
  difficultCardIds: string[];
  learnedCardIds: string[];
  participatedCardIds: string[];
  currentBatch: LearnBatchState | null;
  currentQuestion: LearnQuestionState | null;
  delayedRetries: DelayedRetryState[];
  completedQuestionCount: number;
  nextQuestionSequence: number;
  lastCompletedCardId?: string;
}

export interface CreateLearnSessionInput {
  id: string;
  lessonId: string;
  cards: readonly PracticeCard[];
  newCardIds?: readonly string[];
  difficultCardIds?: readonly string[];
}

export type LearnFeedback = 'incorrect' | 'correct' | 'gave-up';

export interface LearnTransition {
  state: LearnSessionState;
  feedback: LearnFeedback;
  answeredCardId: string;
  revealAnswer: boolean;
  giveUpAvailable: boolean;
  playAudioCardId?: string;
  statisticsDeltas: StatisticsDelta[];
  newlyLearnedCardIds: string[];
}
