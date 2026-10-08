import type { PracticeCard } from '../../src/domain';

export function practiceCards(count: number): PracticeCard[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `card-${index + 1}`,
    target: `target ${index + 1}`,
    meaning: `meaning ${index + 1}`,
  }));
}
