import type {
  Card,
  GlobalCardStatistics,
  Lesson,
  LessonProgress,
  LessonContentType,
  PracticeCard,
} from "../domain";
import { calculateAccuracy } from "../domain";
import {
  japaneseRomajiReading,
  kanaStudyReading,
} from "./kana-study-reading";

export type CardReadinessIssue = "missing-translation" | "audio-unavailable";

export interface CardReadiness {
  card: Card;
  issues: CardReadinessIssue[];
  missingTranslationLanguages: string[];
}

export function getVisibleTranslationLanguages(lesson: Lesson): string[] {
  const configured = lesson.visibleTranslationLanguages?.length
    ? lesson.visibleTranslationLanguages
    : [lesson.activeTranslationLanguage];
  return [
    ...new Set([lesson.activeTranslationLanguage, ...configured]),
  ].filter((language) => lesson.translationLanguages.includes(language));
}

export function formatVisibleTranslations(
  card: Pick<Card, "translations">,
  lesson: Lesson,
  separator = "\n",
): string {
  const visibleLanguages = getVisibleTranslationLanguages(lesson);
  return visibleLanguages
    .map((language) => {
      const value = card.translations[language] ?? "";
      return visibleLanguages.length > 1
        ? `${language.toUpperCase()}: ${value}`
        : value;
    })
    .join(separator);
}

export function getCardReadiness(
  card: Card,
  lesson: Lesson,
  audioAvailable: boolean,
): CardReadiness {
  const issues: CardReadinessIssue[] = [];
  const missingTranslationLanguages = getVisibleTranslationLanguages(
    lesson,
  ).filter((language) => !card.translations[language]?.trim());

  if (missingTranslationLanguages.length > 0) {
    issues.push("missing-translation");
  }

  if (!card.customAudio && !audioAvailable) {
    issues.push("audio-unavailable");
  }

  return { card, issues, missingTranslationLanguages };
}

export function getLessonReadiness(
  cards: readonly Card[],
  lesson: Lesson,
  audioAvailable: boolean,
): CardReadiness[] {
  return cards
    .map((card) => getCardReadiness(card, lesson, audioAvailable))
    .filter((item) => item.issues.length > 0);
}

export function toPracticeCards(
  cards: readonly Card[],
  lesson: Lesson,
): PracticeCard[] {
  const visibleLanguages = getVisibleTranslationLanguages(lesson);
  const contentType = resolveLessonContentType(lesson, cards);
  const practiceCards = cards.map((card) => {
    const romaji =
      japaneseRomajiReading(
        card.pronunciationText?.trim() ?? "",
        card.targetLanguage,
      ) ?? japaneseRomajiReading(card.target, card.targetLanguage);
    return {
      id: card.id,
      target: card.target,
      meaning: formatVisibleTranslations(card, lesson),
      isKanaStudy: kanaStudyReading(card.target, card.targetLanguage) !== null,
      requiresHandwriting: contentType === "symbols",
      acceptedTypingAnswers: romaji ? [romaji] : undefined,
      meaningOptionKey:
        contentType === "symbols"
          ? formatVisibleTranslations(card, lesson).normalize("NFC")
          : `${card.id}:${visibleLanguages.join("+")}`,
    };
  });
  return markAmbiguousHandwritingMeanings(practiceCards);
}

export function markAmbiguousHandwritingMeanings(
  practiceCards: readonly PracticeCard[],
): PracticeCard[] {
  const targetsByMeaning = new Map<string, string[]>();
  for (const card of practiceCards) {
    if (!card.requiresHandwriting) continue;
    const key = normalizeVisibleAnswer(card.meaning);
    const targets = targetsByMeaning.get(key) ?? [];
    if (!targets.includes(card.target)) targets.push(card.target);
    targetsByMeaning.set(key, targets);
  }
  return practiceCards.map((card) => {
    const targets = targetsByMeaning.get(
      normalizeVisibleAnswer(card.meaning),
    );
    return targets && targets.length > 1
      ? {
          ...card,
          ambiguousMeaning: true,
          acceptedDrawingTargets: targets,
        }
      : card;
  });
}

function normalizeVisibleAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
}

/**
 * Older Kana Lessons predate the explicit type field. Treat a Lesson made
 * entirely from kana glyph Cards as a symbol Lesson without rewriting data.
 */
export function resolveLessonContentType(
  lesson: Lesson,
  cards: readonly Card[],
): LessonContentType {
  if (lesson.contentType) return lesson.contentType;
  if (
    cards.length > 0 &&
    cards.every(
      (card) => kanaStudyReading(card.target, card.targetLanguage) !== null,
    )
  ) {
    return "symbols";
  }
  return "vocabulary";
}

export interface LessonSummary {
  cardCount: number;
  learnedCount: number;
  averageAccuracy: number | null;
  averageResponseTimeMs: number | null;
}

export function summarizeLesson(
  cards: readonly Card[],
  progress: readonly LessonProgress[],
  statistics: readonly GlobalCardStatistics[],
): LessonSummary {
  const progressByCard = new Map(progress.map((item) => [item.cardId, item]));
  const statisticsByCard = new Map(
    statistics.map((item) => [item.cardId, item]),
  );
  const accuracies = cards
    .map((card) => {
      const item = statisticsByCard.get(card.id);
      return item ? calculateAccuracy(item) : null;
    })
    .filter((value): value is number => value !== null);
  const responseTimes = cards
    .map((card) => statisticsByCard.get(card.id)?.averageResponseTimeMs ?? null)
    .filter((value): value is number => value !== null);

  return {
    cardCount: cards.length,
    learnedCount: cards.filter((card) => progressByCard.get(card.id)?.learned)
      .length,
    averageAccuracy:
      accuracies.length === 0
        ? null
        : accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length,
    averageResponseTimeMs:
      responseTimes.length === 0
        ? null
        : responseTimes.reduce((sum, value) => sum + value, 0) /
          responseTimes.length,
  };
}

export function parseNonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function alignTranslationLines(
  targets: readonly string[],
  text: string,
): { values: string[]; valid: boolean } {
  const values = parseNonEmptyLines(text);
  return { values, valid: values.length === targets.length };
}
