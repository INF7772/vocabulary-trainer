import Dexie, { type EntityTable } from "dexie";

import type {
  ApplicationSettings,
  CardStudyMarker,
  GlobalCardStatistics,
  Lesson,
  LessonMembership,
  LessonProgress,
  GeneratedTtsAudio,
  LocalFileSystemHandleRecord,
  SrsCardState,
  SrsReviewLog,
} from "../../domain";
import type { CardRecord, LearnSessionRecord } from "./records";
import {
  DATABASE_NAME,
  DATABASE_SCHEMA_VERSION,
  schemaV1,
  schemaV2,
  schemaV3,
  schemaV4,
  schemaV5,
  schemaV6,
  schemaV7,
  schemaV8,
  schemaV9,
} from "./schema";

export class VocabularyTrainerDatabase extends Dexie {
  cards!: EntityTable<CardRecord, "id">;
  lessons!: EntityTable<Lesson, "id">;
  lessonMemberships!: Dexie.Table<LessonMembership, [string, string]>;
  lessonProgress!: Dexie.Table<LessonProgress, [string, string]>;
  cardStatistics!: EntityTable<GlobalCardStatistics, "cardId">;
  settings!: EntityTable<ApplicationSettings, "id">;
  learnSessions!: EntityTable<LearnSessionRecord, "id">;
  generatedTtsAudio!: EntityTable<GeneratedTtsAudio, "cacheKey">;
  fileSystemHandles!: EntityTable<LocalFileSystemHandleRecord, "id">;
  cardStudyMarkers!: EntityTable<CardStudyMarker, "cardId">;
  srsCards!: EntityTable<SrsCardState, "cardId">;
  srsReviewLogs!: EntityTable<SrsReviewLog, "id">;

  constructor(name = DATABASE_NAME) {
    super(name);

    this.version(1).stores(schemaV1);
    this.version(2).stores(schemaV2);
    this.version(3)
      .stores(schemaV3)
      .upgrade(async (transaction) => {
        await transaction
          .table<ApplicationSettings>("settings")
          .toCollection()
          .modify((settings) => {
            settings.defaultTargetLanguage ??= null;
            settings.translationLanguages ??= ["en"];
            settings.defaultActiveTranslationLanguage ??=
              settings.translationLanguages[0] ?? "en";
            settings.useImages ??= true;
            settings.audioPreferences ??= {};
          });
        await transaction
          .table<Lesson>("lessons")
          .toCollection()
          .modify((lesson) => {
            lesson.useImages ??= true;
          });
      });
    this.version(4)
      .stores(schemaV4)
      .upgrade(async (transaction) => {
        await transaction
          .table<ApplicationSettings>("settings")
          .toCollection()
          .modify((settings) => {
            settings.defaultVisibleTranslationLanguages ??= [
              settings.defaultActiveTranslationLanguage ?? "en",
            ];
          });
        await transaction
          .table<Lesson>("lessons")
          .toCollection()
          .modify((lesson) => {
            lesson.visibleTranslationLanguages ??= [
              lesson.activeTranslationLanguage,
            ];
          });
      });
    this.version(5).stores(schemaV5);
    this.version(6).stores(schemaV6);
    this.version(7)
      .stores(schemaV7)
      .upgrade(async (transaction) => {
        await transaction
          .table<ApplicationSettings>("settings")
          .toCollection()
          .modify((settings) => {
            settings.showJapaneseReadings ??= false;
          });
      });
    this.version(8).stores(schemaV8);
    this.version(DATABASE_SCHEMA_VERSION)
      .stores(schemaV9)
      .upgrade(async (transaction) => {
        await transaction
          .table<ApplicationSettings>("settings")
          .toCollection()
          .modify((settings) => {
            settings.maximumNewCardsPerDay ??= 10;
          });
        const learnedProgress = await transaction
          .table<LessonProgress>("lessonProgress")
          .toArray();
        const now = new Date().toISOString();
        const firstLearnedAt = new Map<string, string>();
        for (const progress of learnedProgress.filter((item) => item.learned)) {
          if (!firstLearnedAt.has(progress.cardId)) {
            firstLearnedAt.set(progress.cardId, progress.updatedAt);
          }
        }
        await transaction.table<SrsCardState>("srsCards").bulkPut(
          [...firstLearnedAt].map(([cardId, introducedAt]) => ({
            cardId,
            dueAt: now,
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            learningSteps: 0,
            reps: 0,
            lapses: 0,
            state: "New",
            introducedAt,
            updatedAt: now,
          })),
        );
      });
  }
}

export const database = new VocabularyTrainerDatabase();
