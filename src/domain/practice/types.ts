import type { EntityId } from '../models';

export type ChoiceExerciseType = 'meaning-to-word' | 'word-to-meaning';
export type ExerciseType = ChoiceExerciseType | 'meaning-to-typing';

export interface PracticeCard {
  id: EntityId;
  target: string;
  meaning: string;
  /** Kana study Cards use glyph choices instead of requiring a Japanese IME. */
  isKanaStudy?: boolean;
  /** Symbol Lessons replace target typing with a handwriting canvas. */
  requiresHandwriting?: boolean;
  /** True when the visible reading can refer to more than one written sign. */
  ambiguousMeaning?: boolean;
  /** Every written sign accepted for the visible prompt. */
  acceptedDrawingTargets?: string[];
  /** Additional exact values accepted by typing exercises, such as Japanese romaji. */
  acceptedTypingAnswers?: string[];
  /** Stable key for the rendered image + translation combination, when available. */
  meaningOptionKey?: string;
}

export interface ChoiceQuestion {
  cardId: EntityId;
  exerciseType: ChoiceExerciseType;
  optionCardIds: EntityId[];
  startedAtMs: number;
}
