import type { ChoiceExerciseType, PracticeCard } from './types';
import { type RandomSource, shuffle, systemRandom } from './random';

export interface ChoiceOptionsInput {
  expectedCardId: string;
  candidates: readonly PracticeCard[];
  exerciseType: ChoiceExerciseType;
  maximumOptions?: number;
  random?: RandomSource;
}

export function createChoiceOptionCardIds({
  expectedCardId,
  candidates,
  exerciseType,
  maximumOptions = 4,
  random = systemRandom,
}: ChoiceOptionsInput): string[] {
  if (!Number.isInteger(maximumOptions) || maximumOptions < 1) {
    throw new Error('maximumOptions must be a positive integer.');
  }

  const expected = candidates.find((card) => card.id === expectedCardId);

  if (!expected) {
    throw new Error(`Expected practice Card "${expectedCardId}" was not found.`);
  }

  const selected: PracticeCard[] = [expected];
  const visibleValues = new Set([choiceOptionValueKey(expected, exerciseType)]);
  const distractors = shuffle(
    candidates.filter((card) => card.id !== expectedCardId),
    random,
  );

  for (const distractor of distractors) {
    const visibleValue = choiceOptionValueKey(distractor, exerciseType);

    if (visibleValues.has(visibleValue)) {
      continue;
    }

    selected.push(distractor);
    visibleValues.add(visibleValue);

    if (selected.length === maximumOptions) {
      break;
    }
  }

  return shuffle(
    selected.map((card) => card.id),
    random,
  );
}

export function choiceOptionValueKey(
  card: PracticeCard,
  exerciseType: ChoiceExerciseType,
): string {
  const value =
    exerciseType === 'meaning-to-word'
      ? card.target
      : (card.meaningOptionKey ?? card.meaning);
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}
