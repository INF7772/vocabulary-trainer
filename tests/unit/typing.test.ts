import { describe, expect, it } from 'vitest';

import {
  findMistakenCardByExactTarget,
  isExactTypingMatch,
  isPracticeCardTypingMatch,
  shouldSubmitTypingAnswer,
} from '../../src/domain';
import { practiceCards } from '../utils/practice-cards';

describe('exact typing', () => {
  it('requires an exact value without whitespace or typo tolerance', () => {
    expect(isExactTypingMatch('book', 'book')).toBe(true);
    expect(isExactTypingMatch(' book', 'book')).toBe(false);
    expect(isExactTypingMatch('book ', 'book')).toBe(false);
    expect(isExactTypingMatch('boook', 'book')).toBe(false);
    expect(isExactTypingMatch('boo', 'book')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isExactTypingMatch('BOOK', 'Book')).toBe(true);
  });

  it('uses Unicode canonical normalization', () => {
    expect(isExactTypingMatch('cafe\u0301', 'café')).toBe(true);
  });

  it('does not accept pronunciation text or unrelated values', () => {
    expect(isExactTypingMatch('ほん', '本')).toBe(false);
  });

  it('accepts an explicit romaji answer for Japanese vocabulary', () => {
    const card = {
      ...practiceCards(1)[0]!,
      target: '\u3064\u3065\u304f',
      acceptedTypingAnswers: ['tsuzuku'],
    };

    expect(isPracticeCardTypingMatch('tsuzuku', card)).toBe(true);
    expect(isPracticeCardTypingMatch('\u3064\u3065\u304f', card)).toBe(true);
    expect(isPracticeCardTypingMatch('tsuduku', card)).toBe(false);
  });

  it('recognizes only an exact target of another Lesson Card as mistaken', () => {
    const cards = practiceCards(3);

    expect(findMistakenCardByExactTarget('TARGET 2', 'card-1', cards)?.id).toBe(
      'card-2',
    );
    expect(
      findMistakenCardByExactTarget('target typo', 'card-1', cards),
    ).toBeUndefined();
  });
});

describe('IME-safe submit logic', () => {
  it('does not submit Enter during active composition', () => {
    expect(
      shouldSubmitTypingAnswer({ key: 'Enter', isComposing: true }),
    ).toBe(false);
  });

  it('guards the composition-confirming legacy key code', () => {
    expect(
      shouldSubmitTypingAnswer({
        key: 'Enter',
        isComposing: false,
        keyCode: 229,
      }),
    ).toBe(false);
  });

  it('submits a normal Enter only after composition has ended', () => {
    expect(
      shouldSubmitTypingAnswer({ key: 'Enter', isComposing: false }),
    ).toBe(true);
    expect(
      shouldSubmitTypingAnswer({ key: 'Space', isComposing: false }),
    ).toBe(false);
  });
});
