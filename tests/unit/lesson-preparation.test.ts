import { describe, expect, it, vi } from "vitest";

import type { Card, Lesson } from "../../src/domain";
import {
  importLessonForOfflineUse,
  prepareLessonForOfflineUse,
} from "../../src/services/lesson-preparation";

const now = "2026-09-25T12:00:00.000Z";
const lesson: Lesson = {
  id: "lesson-imported",
  name: "Imported",
  targetLanguage: "ja",
  translationLanguages: ["en"],
  activeTranslationLanguage: "en",
  visibleTranslationLanguages: ["en"],
  useImages: true,
  tts: {
    targetLocale: "ja-JP",
    speechRate: 1,
    fallbackProviderId: "kokoro-jp",
  },
  createdAt: now,
  updatedAt: now,
};
const cards: Card[] = [
  {
    id: "card-imported",
    target: "水",
    targetLanguage: "ja",
    translations: { en: "water" },
    image: null,
    createdAt: now,
    updatedAt: now,
  },
];

describe("offline Lesson preparation", () => {
  it("writes the Lesson file only after all generated audio is prepared", async () => {
    const calls: string[] = [];
    const progress = vi.fn();
    const prepareAudio = vi.fn(async () => {
      calls.push("audio");
      return {
        total: 1,
        created: 1,
        reused: 0,
        failedCardIds: [],
        failureMessages: [],
      };
    });
    const syncLesson = vi.fn(async () => {
      calls.push("file");
      return { status: "saved" as const, directoryName: "lessons" };
    });

    const result = await prepareLessonForOfflineUse(
      lesson,
      cards,
      progress,
      { prepareAudio, syncLesson },
    );

    expect(calls).toEqual(["audio", "file"]);
    expect(prepareAudio).toHaveBeenCalledWith(cards, lesson, progress);
    expect(syncLesson).toHaveBeenCalledWith(
      lesson.id,
      `${lesson.updatedAt}|${cards[0]!.id}:${cards[0]!.updatedAt}`,
    );
    expect(result.audio.created).toBe(1);
  });

  it("fills missing imported audio before saving and returning the Lesson", async () => {
    const calls: string[] = [];
    const importLesson = vi.fn(async () => {
      calls.push("import");
      return { lesson, cardCount: 1, reusedCardCount: 0 };
    });
    const listCards = vi.fn(async () => {
      calls.push("cards");
      return cards;
    });
    const prepareAudio = vi.fn(async () => {
      calls.push("audio");
      return {
        total: 1,
        created: 1,
        reused: 0,
        failedCardIds: [],
        failureMessages: [],
      };
    });
    const syncLesson = vi.fn(async () => {
      calls.push("file");
      return { status: "saved" as const, directoryName: "lessons" };
    });

    const result = await importLessonForOfflineUse(
      new Blob(["lesson"]),
      undefined,
      { importLesson, listCards, prepareAudio, syncLesson },
    );

    expect(calls).toEqual(["import", "cards", "audio", "file"]);
    expect(result).toMatchObject({
      lesson,
      cardCount: 1,
      audio: { created: 1 },
      library: { status: "saved" },
    });
  });
});
