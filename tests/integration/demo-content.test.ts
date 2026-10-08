import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VocabularyTrainerDatabase } from "../../src/data/database";
import {
  CardRepository,
  LessonRepository,
} from "../../src/data/repositories";
import {
  DEMO_LESSON_NAME,
  installBuiltInDemoLesson,
} from "../../src/services/demo-content";

describe("built-in demo content", () => {
  let db: VocabularyTrainerDatabase;
  let cards: CardRepository;
  let lessons: LessonRepository;

  beforeEach(async () => {
    db = new VocabularyTrainerDatabase(
      `vocabulary-trainer-demo-${crypto.randomUUID()}`,
    );
    await db.open();
    cards = new CardRepository(db);
    lessons = new LessonRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("installs one reusable eight-card lesson on an empty library", async () => {
    const loadImage = async (filename: string) => ({
      blob: new Blob([filename], { type: "image/webp" }),
      mimeType: "image/webp",
      width: 720,
      height: 720,
      alt: filename,
    });
    const loadAudio = async (filename: string) => ({
      blob: new Blob([filename], { type: "audio/wav" }),
      mimeType: "audio/wav",
    });

    await installBuiltInDemoLesson({ cards, lessons, loadImage, loadAudio });
    await installBuiltInDemoLesson({ cards, lessons, loadImage, loadAudio });

    const storedLessons = await lessons.list();
    expect(storedLessons).toHaveLength(1);
    expect(storedLessons[0]?.name).toBe(DEMO_LESSON_NAME);
    expect(await lessons.listCards(storedLessons[0]!.id)).toHaveLength(8);
    expect(await db.cards.count()).toBe(8);
  });

  it("leaves an existing user library untouched", async () => {
    await lessons.create({
      name: "My lesson",
      targetLanguage: "de",
      translationLanguages: ["en"],
      activeTranslationLanguage: "en",
    });

    await installBuiltInDemoLesson({
      cards,
      lessons,
      loadImage: async () => null,
      loadAudio: async () => ({
        blob: new Blob(["audio"], { type: "audio/wav" }),
        mimeType: "audio/wav",
      }),
    });

    expect((await lessons.list()).map((lesson) => lesson.name)).toEqual([
      "My lesson",
    ]);
  });
});
