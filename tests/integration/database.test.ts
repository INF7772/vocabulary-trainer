import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";

import {
  schemaV1,
  schemaV3,
  VocabularyTrainerDatabase,
} from "../../src/data/database";
import {
  CardRepository,
  GeneratedTtsAudioRepository,
  LearnSessionRepository,
  LessonRepository,
  SettingsRepository,
  StatisticsRepository,
} from "../../src/data/repositories";
import {
  answerLearnChoice,
  answerLearnTyping,
  correctCompletionDelta,
  createLearnSession,
  errorDelta,
  multipleChoiceErrorDeltas,
} from "../../src/domain";

describe("database repositories", () => {
  let databaseName: string;
  let db: VocabularyTrainerDatabase;
  let cards: CardRepository;
  let lessons: LessonRepository;
  let statistics: StatisticsRepository;
  let learnSessions: LearnSessionRepository;
  let generatedAudio: GeneratedTtsAudioRepository;

  beforeEach(async () => {
    databaseName = `vocabulary-trainer-test-${crypto.randomUUID()}`;
    db = new VocabularyTrainerDatabase(databaseName);
    await db.open();
    cards = new CardRepository(db);
    lessons = new LessonRepository(db);
    statistics = new StatisticsRepository(db);
    learnSessions = new LearnSessionRepository(db);
    generatedAudio = new GeneratedTtsAudioRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("reuses one global Card in multiple Lessons", async () => {
    const card = await createCard(cards, "本");
    const firstLesson = await createLesson(lessons, "Lesson one");
    const secondLesson = await createLesson(lessons, "Lesson two");

    await lessons.addCard(firstLesson.id, card.id);
    await lessons.addCard(secondLesson.id, card.id);

    expect(await db.cards.count()).toBe(1);
    expect((await lessons.listCards(firstLesson.id))[0]?.id).toBe(card.id);
    expect((await lessons.listCards(secondLesson.id))[0]?.id).toBe(card.id);
  });

  it("does not accidentally duplicate a Card for the same normalized target", async () => {
    const first = await cards.createOrReuse({
      target: "café",
      targetLanguage: "fr",
      translations: { en: "coffee" },
      image: null,
    });
    const second = await cards.createOrReuse({
      target: "cafe\u0301",
      targetLanguage: "fr",
      translations: { en: "coffee" },
      image: null,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.card.id).toBe(first.card.id);
    expect(await db.cards.count()).toBe(1);
  });

  it("deletes Lesson-owned rows without deleting a Card used by another Lesson", async () => {
    const card = await createCard(cards, "人");
    const firstLesson = await createLesson(lessons, "First");
    const secondLesson = await createLesson(lessons, "Second");

    await lessons.addCard(firstLesson.id, card.id);
    await lessons.addCard(secondLesson.id, card.id);
    await generatedAudio.save({
      cacheKey: "shared-generated-audio",
      cardId: card.id,
      providerId: "kokoro-jp",
      voiceId: "jf_alpha",
      sourceText: card.target,
      locale: "ja-JP",
      blob: new Blob(["audio"], { type: "audio/wav" }),
      mimeType: "audio/wav",
    });
    await lessons.saveProgress({
      lessonId: firstLesson.id,
      cardId: card.id,
      learned: true,
    });

    await lessons.delete(firstLesson.id, { deleteOrphanCards: true });

    expect(await lessons.get(firstLesson.id)).toBeUndefined();
    expect(await lessons.getProgress(firstLesson.id, card.id)).toBeUndefined();
    expect(await cards.get(card.id)).toBeDefined();
    expect(await generatedAudio.get("shared-generated-audio")).toBeDefined();
    expect((await lessons.listCards(secondLesson.id))[0]?.id).toBe(card.id);
  });

  it("keeps orphaned Cards by default when a Lesson is deleted", async () => {
    const card = await createCard(cards, "水");
    const lesson = await createLesson(lessons, "Water");
    await lessons.addCard(lesson.id, card.id);

    await lessons.delete(lesson.id);

    expect(await cards.get(card.id)).toBeDefined();
    expect(await db.lessonMemberships.count()).toBe(0);
    expect(await db.lessonProgress.count()).toBe(0);
  });

  it("persists global Card statistics, including the calculated average", async () => {
    const card = await createCard(cards, "今日");
    await statistics.save({
      cardId: card.id,
      correctCount: 3,
      errorCount: 1,
      totalCompletedQuestions: 3,
      totalResponseTimeMs: 6_000,
    });

    db.close();
    db = new VocabularyTrainerDatabase(databaseName);
    await db.open();
    statistics = new StatisticsRepository(db);

    await expect(statistics.get(card.id)).resolves.toMatchObject({
      cardId: card.id,
      correctCount: 3,
      errorCount: 1,
      totalCompletedQuestions: 3,
      totalResponseTimeMs: 6_000,
      averageResponseTimeMs: 2_000,
    });
  });

  it("keeps LessonProgress independent for each Lesson", async () => {
    const card = await createCard(cards, "私");
    const firstLesson = await createLesson(lessons, "First context");
    const secondLesson = await createLesson(lessons, "Second context");
    await lessons.addCard(firstLesson.id, card.id);
    await lessons.addCard(secondLesson.id, card.id);

    await lessons.saveProgress({
      lessonId: firstLesson.id,
      cardId: card.id,
      learned: true,
      learningState: { stage: 3, dirtyInCurrentBatch: false },
    });

    expect((await lessons.getProgress(firstLesson.id, card.id))?.learned).toBe(
      true,
    );
    expect((await lessons.getProgress(secondLesson.id, card.id))?.learned).toBe(
      false,
    );
  });

  it("persists application settings separately from Lesson languages", async () => {
    const settings = new SettingsRepository(db);
    await settings.update({ interfaceLanguage: "de", theme: "dark" });
    await createLesson(lessons, "Japanese through Russian");

    await expect(settings.get()).resolves.toMatchObject({
      id: "application",
      interfaceLanguage: "de",
      theme: "dark",
    });
    expect((await lessons.list())[0]?.activeTranslationLanguage).toBe("en");
  });

  it("uses dark mode and hides Japanese readings on a fresh install", async () => {
    await expect(new SettingsRepository(db).get()).resolves.toMatchObject({
      theme: "dark",
      showJapaneseReadings: false,
    });
  });

  it("persists generated TTS audio and removes it with its Card", async () => {
    const card = await createCard(cards, "音");
    await generatedAudio.save({
      cacheKey: "generated-audio",
      cardId: card.id,
      providerId: "kokoro-jp",
      voiceId: "jf_alpha",
      sourceText: card.target,
      locale: "ja-JP",
      blob: new Blob(["audio"], { type: "audio/wav" }),
      mimeType: "audio/wav",
    });

    db.close();
    db = new VocabularyTrainerDatabase(databaseName);
    await db.open();
    cards = new CardRepository(db);
    generatedAudio = new GeneratedTtsAudioRepository(db);

    await expect(generatedAudio.get("generated-audio")).resolves.toMatchObject({
      cardId: card.id,
      sourceText: card.target,
    });
    await cards.delete(card.id);
    await expect(
      generatedAudio.get("generated-audio"),
    ).resolves.toBeUndefined();
  });

  it("invalidates generated TTS audio when pronunciation content changes", async () => {
    const card = await createCard(cards, "音");
    await generatedAudio.save({
      cacheKey: "outdated-generated-audio",
      cardId: card.id,
      providerId: "kokoro-jp",
      voiceId: "jf_alpha",
      sourceText: card.target,
      locale: "ja-JP",
      blob: new Blob(["audio"], { type: "audio/wav" }),
      mimeType: "audio/wav",
    });

    await cards.update(card.id, { pronunciationText: "おと" });

    await expect(
      generatedAudio.get("outdated-generated-audio"),
    ).resolves.toBeUndefined();
  });

  it("supports update and delete operations without crossing entity boundaries", async () => {
    const card = await createCard(cards, "古い");
    const lesson = await createLesson(lessons, "Original name");
    await lessons.addCard(lesson.id, card.id);

    const updatedCard = await cards.update(card.id, {
      target: "新しい",
      translations: { en: "new" },
    });
    const updatedLesson = await lessons.update(lesson.id, {
      name: "Updated name",
    });
    const updatedMembership = await lessons.updateMembershipPosition(
      lesson.id,
      card.id,
      4,
    );

    expect(updatedCard.target).toBe("新しい");
    expect(updatedLesson.name).toBe("Updated name");
    expect(updatedMembership.position).toBe(4);

    await lessons.removeCard(lesson.id, card.id);
    await cards.delete(card.id);

    expect(await cards.get(card.id)).toBeUndefined();
    expect(await lessons.get(lesson.id)).toBeDefined();
  });

  it("applies statistics deltas atomically for expected and mistaken Cards", async () => {
    const expected = await createCard(cards, "本");
    const mistaken = await createCard(cards, "人");

    await statistics.applyDeltas([
      ...multipleChoiceErrorDeltas(expected.id, mistaken.id),
      correctCompletionDelta(expected.id, 2_400),
    ]);

    await expect(statistics.get(expected.id)).resolves.toMatchObject({
      correctCount: 1,
      errorCount: 1,
      totalCompletedQuestions: 1,
      totalResponseTimeMs: 2_400,
      averageResponseTimeMs: 2_400,
    });
    await expect(statistics.get(mistaken.id)).resolves.toMatchObject({
      correctCount: 0,
      errorCount: 1,
      totalCompletedQuestions: 0,
      averageResponseTimeMs: null,
    });
  });

  it("keeps Learn and Automate statistics cumulative until an explicit reset", async () => {
    const card = await createCard(cards, "Haus");
    const lesson = await createLesson(lessons, "Cumulative statistics");
    await lessons.addCard(lesson.id, card.id);
    const practice = [{ id: card.id, target: card.target, meaning: "house" }];
    const state = createLearnSession(
      { id: "cumulative-session", lessonId: lesson.id, cards: practice },
      { random: () => 0.5, now: () => 1_000 },
    );
    await learnSessions.commitTransition(
      answerLearnChoice(state, practice, card.id, {
        random: () => 0.5,
        now: () => 2_500,
      }),
    );

    await statistics.applyDeltas([
      errorDelta(card.id),
      correctCompletionDelta(card.id, 900),
    ]);

    await expect(statistics.get(card.id)).resolves.toMatchObject({
      correctCount: 2,
      errorCount: 1,
      totalCompletedQuestions: 2,
      totalResponseTimeMs: 2_400,
      averageResponseTimeMs: 1_200,
    });

    await lessons.saveProgress({
      lessonId: lesson.id,
      cardId: card.id,
      learned: true,
    });
    await statistics.reset([card.id]);

    await expect(statistics.get(card.id)).resolves.toBeUndefined();
    await expect(lessons.getProgress(lesson.id, card.id)).resolves.toMatchObject({
      learned: true,
    });
  });

  it("persists and restores a serializable Learn session", async () => {
    const card = await createCard(cards, "水");
    const lesson = await createLesson(lessons, "Persistent lesson");
    await lessons.addCard(lesson.id, card.id);
    const state = createLearnSession(
      {
        id: "learn-session-1",
        lessonId: lesson.id,
        cards: [{ id: card.id, target: card.target, meaning: "water" }],
      },
      { random: () => 0.5, now: () => 1_000 },
    );

    await learnSessions.save(state);
    db.close();
    db = new VocabularyTrainerDatabase(databaseName);
    await db.open();
    learnSessions = new LearnSessionRepository(db);

    await expect(learnSessions.getLatestForLesson(lesson.id)).resolves.toEqual(
      state,
    );
  });

  it("removes a persisted Learn session when its Lesson is deleted", async () => {
    const card = await createCard(cards, "空");
    const lesson = await createLesson(lessons, "Temporary lesson");
    await lessons.addCard(lesson.id, card.id);
    const state = createLearnSession(
      {
        id: "learn-session-delete",
        lessonId: lesson.id,
        cards: [{ id: card.id, target: card.target, meaning: "sky" }],
      },
      { random: () => 0.5, now: () => 1_000 },
    );
    await learnSessions.save(state);

    await lessons.delete(lesson.id);

    await expect(learnSessions.get(state.id)).resolves.toBeUndefined();
    await expect(cards.get(card.id)).resolves.toBeDefined();
  });

  it("commits Learn session, statistics, and LessonProgress atomically", async () => {
    const card = await createCard(cards, "山");
    const lesson = await createLesson(lessons, "Mountain lesson");
    await lessons.addCard(lesson.id, card.id);
    const practice = [
      { id: card.id, target: card.target, meaning: "mountain" },
    ];
    const dependencies = { random: () => 0.5, now: () => 1_000 };
    let state = createLearnSession(
      {
        id: "learn-session-commit",
        lessonId: lesson.id,
        cards: practice,
      },
      dependencies,
    );

    let transition = answerLearnChoice(state, practice, card.id, dependencies);
    await learnSessions.commitTransition(transition);
    state = transition.state;
    transition = answerLearnChoice(state, practice, card.id, dependencies);
    await learnSessions.commitTransition(transition);
    state = transition.state;
    transition = answerLearnTyping(state, practice, card.target, dependencies);
    await learnSessions.commitTransition(transition);

    await expect(statistics.get(card.id)).resolves.toMatchObject({
      correctCount: 3,
      errorCount: 0,
      totalCompletedQuestions: 3,
    });
    await expect(
      lessons.getProgress(lesson.id, card.id),
    ).resolves.toMatchObject({ learned: true });
    await expect(learnSessions.get(state.id)).resolves.toMatchObject({
      status: "completed",
      learnedCardIds: [card.id],
    });
  });

  it("restarts a learned Lesson with clean LessonProgress and all Cards queued", async () => {
    const first = await createCard(cards, "赤");
    const second = await createCard(cards, "青");
    const lesson = await createLesson(lessons, "Colours");
    await lessons.addCard(lesson.id, first.id);
    await lessons.addCard(lesson.id, second.id);
    await lessons.saveProgress({
      lessonId: lesson.id,
      cardId: first.id,
      learned: true,
    });
    await lessons.saveProgress({
      lessonId: lesson.id,
      cardId: second.id,
      learned: true,
    });
    const oldSession = createLearnSession({
      id: "old-session",
      lessonId: lesson.id,
      cards: [
        { id: first.id, target: first.target, meaning: "red" },
        { id: second.id, target: second.target, meaning: "blue" },
      ],
      newCardIds: [],
    });
    await learnSessions.save(oldSession);
    const restarted = createLearnSession(
      {
        id: "restarted-session",
        lessonId: lesson.id,
        cards: [
          { id: first.id, target: first.target, meaning: "red" },
          { id: second.id, target: second.target, meaning: "blue" },
        ],
      },
      { random: () => 0.5, now: () => 1_000 },
    );

    await learnSessions.restartLesson(restarted);

    expect(await learnSessions.get("old-session")).toBeUndefined();
    await expect(
      learnSessions.get("restarted-session"),
    ).resolves.toMatchObject({ status: "active" });
    expect(
      (await lessons.listProgress(lesson.id)).every(
        (item) => item.learned === false && item.learningState === undefined,
      ),
    ).toBe(true);
    expect(restarted.currentBatch?.cardIds).toHaveLength(2);
    expect(restarted.currentQuestion).not.toBeNull();
  });

  it("upgrades a schema version 1 database without losing existing data", async () => {
    const legacyName = `vocabulary-trainer-v1-${crypto.randomUUID()}`;
    const legacy = new Dexie(legacyName);
    legacy.version(1).stores(schemaV1);
    await legacy.open();
    await legacy.table("settings").put({
      id: "application",
      interfaceLanguage: "es",
      theme: "dark",
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    });
    legacy.close();

    const upgraded = new VocabularyTrainerDatabase(legacyName);
    await upgraded.open();

    await expect(upgraded.settings.get("application")).resolves.toMatchObject({
      interfaceLanguage: "es",
      theme: "dark",
      defaultTargetLanguage: null,
      translationLanguages: ["en"],
      defaultActiveTranslationLanguage: "en",
      defaultVisibleTranslationLanguages: ["en"],
      useImages: true,
      showJapaneseReadings: false,
      audioPreferences: {},
    });
    await expect(upgraded.learnSessions.count()).resolves.toBe(0);
    await expect(upgraded.generatedTtsAudio.count()).resolves.toBe(0);
    await upgraded.delete();
  });

  it("migrates version 3 Lessons and Settings to one visible translation", async () => {
    const legacyName = `vocabulary-trainer-v3-${crypto.randomUUID()}`;
    const legacy = new Dexie(legacyName);
    legacy.version(3).stores(schemaV3);
    await legacy.open();
    await legacy.table("settings").put({
      id: "application",
      interfaceLanguage: "en",
      theme: "system",
      defaultTargetLanguage: "de",
      translationLanguages: ["ru", "en"],
      defaultActiveTranslationLanguage: "ru",
      useImages: false,
      audioPreferences: {},
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    });
    await legacy.table("lessons").put({
      id: "legacy-lesson",
      name: "Legacy",
      targetLanguage: "de",
      translationLanguages: ["ru", "en"],
      activeTranslationLanguage: "ru",
      useImages: false,
      tts: { targetLocale: "de-DE", speechRate: 1 },
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    });
    legacy.close();

    const upgraded = new VocabularyTrainerDatabase(legacyName);
    await upgraded.open();

    await expect(upgraded.settings.get("application")).resolves.toMatchObject({
      theme: "system",
      defaultVisibleTranslationLanguages: ["ru"],
      showJapaneseReadings: false,
    });
    await expect(upgraded.lessons.get("legacy-lesson")).resolves.toMatchObject({
      visibleTranslationLanguages: ["ru"],
    });
    await upgraded.delete();
  });

  it("persists language, image, and audio defaults independently of interface language", async () => {
    const settings = new SettingsRepository(
      db,
      () => "2026-09-24T12:00:00.000Z",
    );
    await settings.update({
      interfaceLanguage: "ru",
      defaultTargetLanguage: "de",
      translationLanguages: ["en", "fr"],
      defaultActiveTranslationLanguage: "fr",
      defaultVisibleTranslationLanguages: ["fr", "en"],
      useImages: false,
      audioPreferences: {
        de: { targetLocale: "de-DE", voiceUri: "de-voice", speechRate: 0.9 },
      },
    });

    db.close();
    db = new VocabularyTrainerDatabase(databaseName);
    await db.open();
    const restored = await new SettingsRepository(db).get();

    expect(restored).toMatchObject({
      interfaceLanguage: "ru",
      defaultTargetLanguage: "de",
      translationLanguages: ["en", "fr"],
      defaultActiveTranslationLanguage: "fr",
      defaultVisibleTranslationLanguages: ["fr", "en"],
      useImages: false,
      audioPreferences: {
        de: { targetLocale: "de-DE", voiceUri: "de-voice", speechRate: 0.9 },
      },
    });
  });
});

function createCard(cards: CardRepository, target: string) {
  return cards.create({
    target,
    targetLanguage: "ja",
    translations: { en: `translation for ${target}` },
    image: null,
  });
}

function createLesson(lessons: LessonRepository, name: string) {
  return lessons.create({
    name,
    targetLanguage: "ja",
    translationLanguages: ["en"],
    activeTranslationLanguage: "en",
    tts: { targetLocale: "ja-JP" },
  });
}
