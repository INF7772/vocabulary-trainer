import type { PracticeCard } from './practice/types';

export function normalizeTypingValue(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

export function isExactTypingMatch(answer: string, target: string): boolean {
  return normalizeTypingValue(answer) === normalizeTypingValue(target);
}

export function isPracticeCardTypingMatch(
  answer: string,
  card: PracticeCard,
): boolean {
  return [card.target, ...(card.acceptedTypingAnswers ?? [])].some((value) =>
    isExactTypingMatch(answer, value),
  );
}

export function findMistakenCardByExactTarget(
  answer: string,
  expectedCardId: string,
  cards: readonly PracticeCard[],
): PracticeCard | undefined {
  return cards.find(
    (card) =>
      card.id !== expectedCardId && isExactTypingMatch(answer, card.target),
  );
}

export function findMistakenCardByTypingAnswer(
  answer: string,
  expectedCardId: string,
  cards: readonly PracticeCard[],
): PracticeCard | undefined {
  return cards.find(
    (card) =>
      card.id !== expectedCardId && isPracticeCardTypingMatch(answer, card),
  );
}
