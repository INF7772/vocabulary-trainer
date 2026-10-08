import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";

import type { ReviewRating, SrsCardState, SrsState } from "./models";

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36_500,
  enable_fuzz: false,
  // The existing Learn engine already owns same-session learning steps.
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
});

const ratingToFsrs: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const stateToFsrs: Record<SrsState, State> = {
  New: State.New,
  Learning: State.Learning,
  Review: State.Review,
  Relearning: State.Relearning,
};

const fsrsToState: Record<State, SrsState> = {
  [State.New]: "New",
  [State.Learning]: "Learning",
  [State.Review]: "Review",
  [State.Relearning]: "Relearning",
};

export interface SrsPreview {
  rating: ReviewRating;
  dueAt: string;
  intervalMs: number;
}

export function createDueSrsState(
  cardId: string,
  now: Date,
  introducedAt = now,
): SrsCardState {
  return fromFsrsCard(cardId, createEmptyCard(now), introducedAt, now);
}

export function graduateToSrs(cardId: string, now: Date): SrsCardState {
  const result = scheduler.next(createEmptyCard(now), now, Rating.Good);
  return fromFsrsCard(cardId, result.card, now, now);
}

export function scheduleSrsReview(
  current: SrsCardState,
  rating: ReviewRating,
  now: Date,
): SrsCardState {
  const result = scheduler.next(toFsrsCard(current), now, ratingToFsrs[rating]);
  return fromFsrsCard(
    current.cardId,
    result.card,
    new Date(current.introducedAt),
    now,
  );
}

export function previewSrsReview(
  current: SrsCardState,
  now: Date,
): SrsPreview[] {
  const previews = scheduler.repeat(toFsrsCard(current), now);
  return (Object.keys(ratingToFsrs) as ReviewRating[]).map((rating) => {
    const due = previews[ratingToFsrs[rating]].card.due;
    return {
      rating,
      dueAt: due.toISOString(),
      intervalMs: Math.max(0, due.getTime() - now.getTime()),
    };
  });
}

export function getSrsRetrievability(
  current: SrsCardState,
  now: Date,
): number {
  return scheduler.get_retrievability(toFsrsCard(current), now, false);
}

function toFsrsCard(state: SrsCardState): FsrsCard {
  return {
    due: new Date(state.dueAt),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: stateToFsrs[state.state],
    last_review: state.lastReviewAt
      ? new Date(state.lastReviewAt)
      : undefined,
  };
}

function fromFsrsCard(
  cardId: string,
  card: FsrsCard,
  introducedAt: Date,
  updatedAt: Date,
): SrsCardState {
  return {
    cardId,
    dueAt: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: fsrsToState[card.state],
    lastReviewAt: card.last_review?.toISOString(),
    introducedAt: introducedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
