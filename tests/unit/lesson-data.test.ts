import { describe, expect, it } from "vitest";

import type { Card, Lesson } from "../../src/domain";
import {
  alignTranslationLines,
  getCardReadiness,
  getLessonReadiness,
  resolveLessonContentType,
  toPracticeCards,
} from "../../src/services/lesson-data";

describe("translation list paste", () => {
  it("maps one non-empty line to each original word", () => {
    expect(alignTranslationLines(["本", "人", "水"], "книга\n\nчеловек\nвода"))
      .toEqual({ values: ["книга", "человек", "вода"], valid: true });
  });

  it("rejects the import when line counts do not match", () => {
    expect(alignTranslationLines(["Haus", "Wasser"], "дом"))
      .toEqual({ values: ["дом"], valid: false });
  });
});

describe("language-agnostic lesson readiness", () => {
  const lesson: Lesson = {
    id: "german",
    name: "German without pictures",
    targetLanguage: "de",
    translationLanguages: ["en", "fr"],
    activeTranslationLanguage: "en",
    visibleTranslationLanguages: ["en"],
    useImages: false,
    tts: { targetLocale: "de-DE", speechRate: 1 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const card: Card = {
    id: "hallo",
    target: "Hallo",
    pronunciationText: "Hallo",
    targetLanguage: "de",
    translations: { en: "hello", fr: "bonjour" },
    image: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("does not require an image for Learn readiness", () => {
    expect(getCardReadiness(card, lesson, true).issues).toEqual([]);
    expect(getLessonReadiness([card], lesson, true)).toEqual([]);
  });

  it("uses the active translation without Japanese-specific assumptions", () => {
    expect(toPracticeCards([card], lesson)).toEqual([
      expect.objectContaining({ target: "Hallo", meaning: "hello" }),
    ]);
  });

  it("derives a romaji typing answer for Japanese kana vocabulary", () => {
    const japaneseLesson = { ...lesson, targetLanguage: "ja" };
    const japaneseCard = {
      ...card,
      target: "\u3064\u3065\u304f",
      targetLanguage: "ja",
    };

    expect(toPracticeCards([japaneseCard], japaneseLesson)[0]).toMatchObject({
      isKanaStudy: false,
      acceptedTypingAnswers: ["tsuzuku"],
    });
  });

  it("uses handwriting only for symbol Lessons and recognizes legacy kana Lessons", () => {
    const kanaCard = {
      ...card,
      target: "\u3042",
      targetLanguage: "ja",
      translations: { en: "a" },
    };
    const explicitVocabulary = {
      ...lesson,
      contentType: "vocabulary" as const,
      targetLanguage: "ja",
    };
    const symbolLesson = {
      ...lesson,
      contentType: "symbols" as const,
      targetLanguage: "ja",
    };
    const legacyLesson = { ...lesson, targetLanguage: "ja" };

    expect(toPracticeCards([kanaCard], explicitVocabulary)[0]?.requiresHandwriting).toBe(false);
    expect(toPracticeCards([kanaCard], symbolLesson)[0]?.requiresHandwriting).toBe(true);
    expect(resolveLessonContentType(legacyLesson, [kanaCard])).toBe("symbols");
  });

  it("accepts every symbol that shares the same reading in drawing tasks", () => {
    const symbolLesson = {
      ...lesson,
      contentType: "symbols" as const,
      targetLanguage: "ja",
    };
    const cards = [
      {
        ...card,
        id: "ji-1",
        target: "\u3058",
        targetLanguage: "ja",
        translations: { en: "ji" },
      },
      {
        ...card,
        id: "ji-2",
        target: "\u3062",
        targetLanguage: "ja",
        translations: { en: "ji" },
      },
    ];

    expect(toPracticeCards(cards, symbolLesson)).toEqual([
      expect.objectContaining({
        ambiguousMeaning: true,
        acceptedDrawingTargets: ["\u3058", "\u3062"],
      }),
      expect.objectContaining({
        ambiguousMeaning: true,
        acceptedDrawingTargets: ["\u3058", "\u3062"],
      }),
    ]);
  });

  it("combines every visible translation and validates each one", () => {
    const multilingualLesson = {
      ...lesson,
      visibleTranslationLanguages: ["en", "fr"],
    };

    expect(toPracticeCards([card], multilingualLesson)).toEqual([
      expect.objectContaining({
        target: "Hallo",
        meaning: "EN: hello\nFR: bonjour",
      }),
    ]);
    expect(
      getCardReadiness(
        { ...card, translations: { en: "hello" } },
        multilingualLesson,
        true,
      ),
    ).toMatchObject({
      issues: ["missing-translation"],
      missingTranslationLanguages: ["fr"],
    });
  });

  it("still blocks a missing active translation or unavailable audio", () => {
    expect(
      getCardReadiness(
        { ...card, translations: { fr: "bonjour" } },
        lesson,
        true,
      ).issues,
    ).toEqual(["missing-translation"]);
    expect(getCardReadiness(card, lesson, false).issues).toEqual([
      "audio-unavailable",
    ]);
  });
});
