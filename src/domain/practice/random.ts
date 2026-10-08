export type RandomSource = () => number;

export const systemRandom: RandomSource = Math.random;

export function randomInteger(
  minimum: number,
  maximum: number,
  random: RandomSource = systemRandom,
): number {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) {
    throw new Error('Random integer bounds must be integers.');
  }

  if (maximum < minimum) {
    throw new Error('Random integer maximum must not be smaller than minimum.');
  }

  const randomValue = random();

  if (!Number.isFinite(randomValue)) {
    throw new Error('Random source must return a finite number.');
  }

  const sample = Math.min(Math.max(randomValue, 0), 1 - Number.EPSILON);
  return minimum + Math.floor(sample * (maximum - minimum + 1));
}

export function shuffle<T>(
  values: readonly T[],
  random: RandomSource = systemRandom,
): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(0, index, random);
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex] as T,
      shuffled[index] as T,
    ];
  }

  return shuffled;
}
