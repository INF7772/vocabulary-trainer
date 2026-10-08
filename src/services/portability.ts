import JSZip from "jszip";

import {
  DATABASE_SCHEMA_VERSION,
  database,
  type VocabularyTrainerDatabase,
} from "../data/database";
import { CardRepository, LessonRepository } from "../data/repositories";
import { withSettingsDefaults } from "../data/repositories/settings-repository";
import type {
  ApplicationSettings,
  Card,
  CardStudyMarker,
  CustomAudio,
  GeneratedTtsAudio,
  GlobalCardStatistics,
  LearnSessionState,
  Lesson,
  LessonMembership,
  LessonProgress,
  StoredImage,
  SrsCardState,
  SrsReviewLog,
} from "../domain";
import { createDueSrsState } from "../domain";

export const PORTABLE_FORMAT_VERSION = 1;
const MAX_ARCHIVE_FILES = 20_000;
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 500 * 1024 * 1024;

export type PortabilityErrorCode =
  | "corrupted"
  | "unsupported-version"
  | "invalid-data"
  | "lesson-not-found"
  | "storage-failed";

export class PortabilityError extends Error {
  constructor(
    public readonly code: PortabilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PortabilityError";
  }
}

interface PortableImage extends Omit<StoredImage, "blob"> {
  assetPath: string;
}

interface PortableAudio extends Omit<CustomAudio, "blob"> {
  assetPath: string;
}

interface PortableCard extends Omit<Card, "image" | "customAudio"> {
  image: PortableImage | null;
  customAudio?: PortableAudio;
}

interface PortableGeneratedTtsAudio extends Omit<GeneratedTtsAudio, "blob"> {
  assetPath: string;
}

interface LessonPackageManifest {
  kind: "vocabulary-trainer-lesson";
  formatVersion: number;
  exportedAt: string;
  lesson: Lesson;
  cardOrder: string[];
  cards: PortableCard[];
  generatedTtsAudio: PortableGeneratedTtsAudio[];
}

interface FullBackupManifest {
  kind: "vocabulary-trainer-backup";
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  cards: PortableCard[];
  lessons: Lesson[];
  memberships: LessonMembership[];
  progress: LessonProgress[];
  statistics: GlobalCardStatistics[];
  studyMarkers: CardStudyMarker[];
  srsCards: SrsCardState[];
  srsReviewLogs: SrsReviewLog[];
  settings: ApplicationSettings[];
  learnSessions: Array<{
    id: string;
    lessonId: string;
    state: LearnSessionState;
    createdAt: string;
    updatedAt: string;
  }>;
  generatedTtsAudio: PortableGeneratedTtsAudio[];
}

export interface LessonImportResult {
  lesson: Lesson;
  cardCount: number;
  reusedCardCount: number;
}

export interface RestoreResult {
  lessonCount: number;
  cardCount: number;
}

export async function exportLessonPackage(
  lessonId: string,
  db: VocabularyTrainerDatabase = database,
): Promise<Blob> {
  const lesson = await db.lessons.get(lessonId);
  if (!lesson)
    throw new PortabilityError("lesson-not-found", "Lesson not found.");

  const memberships = (
    await db.lessonMemberships.where("lessonId").equals(lessonId).toArray()
  ).sort((left, right) => left.position - right.position);
  const records = await db.cards.bulkGet(
    memberships.map((item) => item.cardId),
  );
  const cards = records.filter((card): card is NonNullable<typeof card> =>
    Boolean(card),
  );
  if (cards.length !== memberships.length) {
    throw new PortabilityError(
      "invalid-data",
      "Lesson contains a missing Card.",
    );
  }

  const zip = new JSZip();
  const portableCards = await Promise.all(
    cards.map((card) => addCardAssets(zip, card, "assets/cards")),
  );
  const cardIds = new Set(cards.map((card) => card.id));
  const generatedTtsAudio = (await db.generatedTtsAudio.toArray()).filter(
    (record) => cardIds.has(record.cardId),
  );
  const portableGeneratedTtsAudio = await Promise.all(
    generatedTtsAudio.map((record, index) =>
      addGeneratedTtsAudioAsset(zip, record, index),
    ),
  );
  const manifest: LessonPackageManifest = {
    kind: "vocabulary-trainer-lesson",
    formatVersion: PORTABLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    lesson: structuredClone(lesson),
    cardOrder: memberships.map((item) => item.cardId),
    cards: portableCards,
    generatedTtsAudio: portableGeneratedTtsAudio,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({
    type: "blob",
    compression: "STORE",
  });
}

export async function importLessonPackage(
  source: Blob,
  db: VocabularyTrainerDatabase = database,
): Promise<LessonImportResult> {
  const { zip, manifest } = await readArchive(source);
  if (manifest.kind !== "vocabulary-trainer-lesson") {
    throw new PortabilityError("corrupted", "This is not a Lesson export.");
  }
  assertFormatVersion(manifest.formatVersion);
  const data = validateLessonManifest(manifest);
  const hydratedCards = await hydrateCards(zip, data.cards);
  const hydratedGeneratedTtsAudio = await hydrateGeneratedTtsAudio(
    zip,
    data.generatedTtsAudio,
  );
  const cards = new CardRepository(db);
  const lessons = new LessonRepository(db);
  let reusedCardCount = 0;
  const importedCardIds = new Map<string, string>();

  try {
    const lesson = await db.transaction(
      "rw",
      [
        db.cards,
        db.lessons,
        db.lessonMemberships,
        db.lessonProgress,
        db.generatedTtsAudio,
      ],
      async () => {
        const createdLesson = await lessons.create({
          name: data.lesson.name,
          contentType: data.lesson.contentType,
          targetLanguage: data.lesson.targetLanguage,
          translationLanguages: data.lesson.translationLanguages,
          activeTranslationLanguage: data.lesson.activeTranslationLanguage,
          visibleTranslationLanguages:
            data.lesson.visibleTranslationLanguages ?? [
              data.lesson.activeTranslationLanguage,
            ],
          useImages: data.lesson.useImages,
          tts: data.lesson.tts,
        });
        const cardsByOldId = new Map(
          hydratedCards.map((card) => [card.id, card]),
        );

        for (const [position, oldCardId] of data.cardOrder.entries()) {
          const imported = cardsByOldId.get(oldCardId);
          if (!imported)
            throw new PortabilityError(
              "invalid-data",
              "Lesson Card order is invalid.",
            );
          const result = await cards.createOrReuse({
            target: imported.target,
            pronunciationText: imported.pronunciationText,
            targetLanguage: imported.targetLanguage,
            translations: imported.translations,
            image: imported.image,
            imageMetadata: imported.imageMetadata,
            customAudio: imported.customAudio,
          });
          if (!result.created) {
            reusedCardCount += 1;
            await cards.update(result.card.id, {
              translations: {
                ...imported.translations,
                ...result.card.translations,
              },
              pronunciationText:
                result.card.pronunciationText ?? imported.pronunciationText,
              image: result.card.image ?? imported.image,
              imageMetadata: result.card.image
                ? result.card.imageMetadata
                : imported.imageMetadata,
              customAudio: result.card.customAudio ?? imported.customAudio,
            });
          }
          await lessons.addCard(createdLesson.id, result.card.id, position);
          importedCardIds.set(oldCardId, result.card.id);
        }

        const now = new Date().toISOString();
        for (const generated of hydratedGeneratedTtsAudio) {
          const cardId = importedCardIds.get(generated.cardId);
          if (!cardId) continue;
          await db.generatedTtsAudio.put({
            ...generated,
            cardId,
            cacheKey: JSON.stringify([
              cardId,
              generated.providerId,
              generated.voiceId,
              generated.sourceText.normalize("NFC"),
              generated.locale.toLowerCase(),
            ]),
            createdAt: now,
            updatedAt: now,
          });
        }

        return createdLesson;
      },
    );
    return { lesson, cardCount: hydratedCards.length, reusedCardCount };
  } catch (error) {
    if (error instanceof PortabilityError) throw error;
    throw new PortabilityError(
      "storage-failed",
      "The Lesson could not be saved.",
    );
  }
}

export async function exportFullBackup(
  db: VocabularyTrainerDatabase = database,
): Promise<Blob> {
  const [
    cards,
    lessons,
    memberships,
    progress,
    statistics,
    studyMarkers,
    settings,
    learnSessions,
    generatedTtsAudio,
    srsCards,
    srsReviewLogs,
  ] = await db.transaction("r", db.tables, async () =>
    Promise.all([
      db.cards.toArray(),
      db.lessons.toArray(),
      db.lessonMemberships.toArray(),
      db.lessonProgress.toArray(),
      db.cardStatistics.toArray(),
      db.cardStudyMarkers.toArray(),
      db.settings.toArray(),
      db.learnSessions.toArray(),
      db.generatedTtsAudio.toArray(),
      db.srsCards.toArray(),
      db.srsReviewLogs.toArray(),
    ]),
  );
  const zip = new JSZip();
  const portableCards = await Promise.all(
    cards.map((card) => addCardAssets(zip, card, "assets/cards")),
  );
  const portableGeneratedTtsAudio = await Promise.all(
    generatedTtsAudio.map((record, index) =>
      addGeneratedTtsAudioAsset(zip, record, index),
    ),
  );
  const manifest: FullBackupManifest = {
    kind: "vocabulary-trainer-backup",
    formatVersion: PORTABLE_FORMAT_VERSION,
    schemaVersion: DATABASE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    cards: portableCards,
    lessons: structuredClone(lessons),
    memberships: structuredClone(memberships),
    progress: structuredClone(progress),
    statistics: structuredClone(statistics),
    studyMarkers: structuredClone(studyMarkers),
    settings: structuredClone(settings),
    learnSessions: structuredClone(learnSessions),
    generatedTtsAudio: portableGeneratedTtsAudio,
    srsCards: structuredClone(srsCards),
    srsReviewLogs: structuredClone(srsReviewLogs),
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({
    type: "blob",
    compression: "STORE",
  });
}

export async function restoreFullBackup(
  source: Blob,
  db: VocabularyTrainerDatabase = database,
): Promise<RestoreResult> {
  const { zip, manifest } = await readArchive(source);
  if (manifest.kind !== "vocabulary-trainer-backup") {
    throw new PortabilityError("corrupted", "This is not a full backup.");
  }
  assertFormatVersion(manifest.formatVersion);
  if (
    !isInteger(manifest.schemaVersion) ||
    manifest.schemaVersion < 1 ||
    manifest.schemaVersion > DATABASE_SCHEMA_VERSION
  ) {
    throw new PortabilityError(
      "unsupported-version",
      "The backup uses a newer database version.",
    );
  }
  const data = validateBackupManifest(manifest);
  const cards = await hydrateCards(zip, data.cards);
  const generatedTtsAudio = await hydrateGeneratedTtsAudio(
    zip,
    data.generatedTtsAudio,
  );
  const restoredAssetBytes =
    cards.reduce(
      (total, card) =>
        total + (card.image?.blob.size ?? 0) + (card.customAudio?.blob.size ?? 0),
      0,
    ) +
    generatedTtsAudio.reduce((total, record) => total + record.blob.size, 0);
  if (restoredAssetBytes > MAX_TOTAL_ASSET_BYTES)
    invalid("Archive assets are too large.");
  validateBackupRelationships(data, cards);
  const restoredSrsCards =
    data.srsCards.length > 0
      ? data.srsCards
      : [
          ...new Map(
            data.progress
              .filter((item) => item.learned)
              .map((item) => [
                item.cardId,
                createDueSrsState(
                  item.cardId,
                  new Date(),
                  new Date(item.updatedAt),
                ),
              ]),
          ).values(),
        ];

  try {
    const portableTables = db.tables.filter(
      (table) => table.name !== "fileSystemHandles",
    );
    await db.transaction("rw", portableTables, async () => {
      await Promise.all(portableTables.map((table) => table.clear()));
      await db.cards.bulkPut(
        cards.map((card) => ({
          ...card,
          normalizedTarget: card.target.normalize("NFC"),
        })),
      );
      await db.lessons.bulkPut(
        data.lessons.map((lesson) => ({
          ...lesson,
          useImages: lesson.useImages ?? true,
          visibleTranslationLanguages: lesson.visibleTranslationLanguages ?? [
            lesson.activeTranslationLanguage,
          ],
        })),
      );
      await db.lessonMemberships.bulkPut(data.memberships);
      await db.lessonProgress.bulkPut(data.progress);
      await db.cardStatistics.bulkPut(data.statistics);
      await db.cardStudyMarkers.bulkPut(data.studyMarkers);
      await db.settings.bulkPut(data.settings.map(withSettingsDefaults));
      await db.learnSessions.bulkPut(data.learnSessions);
      await db.generatedTtsAudio.bulkPut(generatedTtsAudio);
      await db.srsCards.bulkPut(restoredSrsCards);
      await db.srsReviewLogs.bulkPut(data.srsReviewLogs);
    });
  } catch {
    throw new PortabilityError(
      "storage-failed",
      "The backup could not be restored. Existing data was kept.",
    );
  }

  return { lessonCount: data.lessons.length, cardCount: cards.length };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function safeFilename(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "-");
  return normalized.replace(/^-+|-+$/gu, "").slice(0, 80) || "lesson";
}

async function addCardAssets(
  zip: JSZip,
  card: Card,
  root: string,
): Promise<PortableCard> {
  const image = card.image
    ? { ...withoutBlob(card.image), assetPath: `${root}/${card.id}/image` }
    : null;
  const customAudio = card.customAudio
    ? {
        ...withoutBlob(card.customAudio),
        assetPath: `${root}/${card.id}/audio`,
      }
    : undefined;
  if (card.image)
    zip.file(image!.assetPath, await readBlobBytes(card.image.blob));
  if (card.customAudio)
    zip.file(
      customAudio!.assetPath,
      await readBlobBytes(card.customAudio.blob),
    );
  return {
    id: card.id,
    target: card.target,
    pronunciationText: card.pronunciationText,
    targetLanguage: card.targetLanguage,
    translations: structuredClone(card.translations),
    image,
    imageMetadata: card.imageMetadata
      ? structuredClone(card.imageMetadata)
      : undefined,
    customAudio,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

async function addGeneratedTtsAudioAsset(
  zip: JSZip,
  record: GeneratedTtsAudio,
  index: number,
): Promise<PortableGeneratedTtsAudio> {
  const assetPath = `assets/generated-tts/${index}`;
  zip.file(assetPath, await readBlobBytes(record.blob));
  return { ...withoutBlob(record), assetPath };
}

function withoutBlob<T extends { blob: Blob }>(value: T): Omit<T, "blob"> {
  const { blob: _blob, ...rest } = value;
  void _blob;
  return rest;
}

async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read binary asset."));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

async function readArchive(
  source: Blob,
): Promise<{ zip: JSZip; manifest: Record<string, unknown> }> {
  try {
    const zip = await JSZip.loadAsync(await readBlobBytes(source));
    if (Object.keys(zip.files).length > MAX_ARCHIVE_FILES) {
      throw new PortabilityError(
        "invalid-data",
        "The archive contains too many files.",
      );
    }
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile)
      throw new PortabilityError("corrupted", "Archive manifest is missing.");
    const text = await manifestFile.async("string");
    if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) {
      throw new PortabilityError(
        "invalid-data",
        "Archive manifest is too large.",
      );
    }
    const manifest: unknown = JSON.parse(text);
    if (!isObject(manifest))
      throw new PortabilityError("corrupted", "Archive manifest is invalid.");
    return { zip, manifest };
  } catch (error) {
    if (error instanceof PortabilityError) throw error;
    throw new PortabilityError(
      "corrupted",
      "The archive is corrupted or incomplete.",
    );
  }
}

function validateLessonManifest(
  value: Record<string, unknown>,
): LessonPackageManifest {
  value.generatedTtsAudio ??= [];
  assertLesson(value.lesson);
  if (!Array.isArray(value.cards) || !Array.isArray(value.cardOrder))
    invalid("Lesson cards are invalid.");
  const cards = value.cards.map(assertPortableCard);
  const cardOrder = value.cardOrder.map((id) => readString(id, "Card id"));
  if (!Array.isArray(value.generatedTtsAudio))
    invalid("Lesson generated audio is invalid.");
  const generatedTtsAudio = value.generatedTtsAudio.map(
    assertPortableGeneratedTtsAudio,
  );
  assertUnique(
    cards.map((card) => card.id),
    "Card ids",
  );
  assertUnique(cardOrder, "Card order");
  if (
    cardOrder.length !== cards.length ||
    cardOrder.some((id) => !cards.some((card) => card.id === id))
  ) {
    invalid("Lesson Card order does not match its Cards.");
  }
  const cardIds = new Set(cards.map((card) => card.id));
  assertUnique(
    generatedTtsAudio.map((record) => record.cacheKey),
    "generated TTS audio",
  );
  if (generatedTtsAudio.some((record) => !cardIds.has(record.cardId)))
    invalid("Lesson contains orphan generated TTS audio.");
  return value as unknown as LessonPackageManifest;
}

function validateBackupManifest(
  value: Record<string, unknown>,
): FullBackupManifest {
  value.generatedTtsAudio ??= [];
  value.studyMarkers ??= [];
  value.srsCards ??= [];
  value.srsReviewLogs ??= [];
  const arrayFields = [
    "cards",
    "lessons",
    "memberships",
    "progress",
    "statistics",
    "studyMarkers",
    "srsCards",
    "srsReviewLogs",
    "settings",
    "learnSessions",
    "generatedTtsAudio",
  ] as const;
  for (const field of arrayFields)
    if (!Array.isArray(value[field]))
      invalid(`Backup field ${field} is invalid.`);
  const data = value as unknown as FullBackupManifest;
  data.cards = data.cards.map(assertPortableCard);
  data.lessons.forEach(assertLesson);
  data.memberships.forEach(assertMembership);
  data.progress.forEach(assertProgress);
  data.statistics.forEach(assertStatistics);
  data.studyMarkers.forEach(assertStudyMarker);
  data.srsCards.forEach(assertSrsCard);
  data.srsReviewLogs.forEach(assertSrsReviewLog);
  data.settings.forEach(assertSettings);
  data.learnSessions.forEach(assertLearnSessionRecord);
  data.generatedTtsAudio = data.generatedTtsAudio.map(
    assertPortableGeneratedTtsAudio,
  );
  assertUnique(
    data.cards.map((card) => card.id),
    "Card ids",
  );
  assertUnique(
    data.lessons.map((lesson) => lesson.id),
    "Lesson ids",
  );
  assertUnique(
    data.memberships.map((item) => `${item.lessonId}\0${item.cardId}`),
    "memberships",
  );
  assertUnique(
    data.progress.map((item) => `${item.lessonId}\0${item.cardId}`),
    "progress",
  );
  assertUnique(
    data.statistics.map((item) => item.cardId),
    "statistics",
  );
  assertUnique(
    data.studyMarkers.map((item) => item.cardId),
    "study markers",
  );
  assertUnique(
    data.srsCards.map((item) => item.cardId),
    "SRS Cards",
  );
  assertUnique(
    data.srsReviewLogs.map((item) => item.id),
    "SRS review logs",
  );
  assertUnique(
    data.learnSessions.map((item) => item.id),
    "Learn sessions",
  );
  assertUnique(
    data.generatedTtsAudio.map((item) => item.cacheKey),
    "generated TTS audio",
  );
  if (data.settings.length > 1)
    invalid("Backup contains multiple settings records.");
  return data;
}

function validateBackupRelationships(
  data: FullBackupManifest,
  cards: Card[],
): void {
  const cardIds = new Set(cards.map((card) => card.id));
  const lessonIds = new Set(data.lessons.map((lesson) => lesson.id));
  const membershipKeys = new Set(
    data.memberships.map((item) => `${item.lessonId}\0${item.cardId}`),
  );
  const targetKeys = new Set<string>();
  for (const card of cards) {
    const key = `${card.targetLanguage}\0${card.target.normalize("NFC")}`;
    if (targetKeys.has(key)) invalid("Backup contains duplicate Cards.");
    targetKeys.add(key);
  }
  for (const item of data.memberships) {
    if (!lessonIds.has(item.lessonId) || !cardIds.has(item.cardId))
      invalid("Backup contains an orphan membership.");
  }
  for (const item of data.progress) {
    if (!membershipKeys.has(`${item.lessonId}\0${item.cardId}`))
      invalid("Backup contains orphan progress.");
  }
  for (const item of data.statistics)
    if (!cardIds.has(item.cardId))
      invalid("Backup contains orphan statistics.");
  for (const item of data.studyMarkers)
    if (!cardIds.has(item.cardId))
      invalid("Backup contains an orphan study marker.");
  for (const item of data.srsCards)
    if (!cardIds.has(item.cardId))
      invalid("Backup contains an orphan SRS Card.");
  for (const item of data.srsReviewLogs)
    if (!cardIds.has(item.cardId))
      invalid("Backup contains an orphan SRS review log.");
  for (const item of data.generatedTtsAudio)
    if (!cardIds.has(item.cardId))
      invalid("Backup contains orphan generated TTS audio.");
  for (const item of data.learnSessions) {
    if (!lessonIds.has(item.lessonId))
      invalid("Backup contains an orphan Learn session.");
    const allowedCards = new Set(
      data.memberships
        .filter((member) => member.lessonId === item.lessonId)
        .map((member) => member.cardId),
    );
    const state = item.state;
    const referencedCardIds = [
      ...state.remainingNewCardIds,
      ...state.difficultCardIds,
      ...state.learnedCardIds,
      ...state.participatedCardIds,
      ...(state.currentBatch?.cardIds ?? []),
      ...(state.currentBatch?.stageCardOrder ?? []),
      ...(state.currentBatch?.dirtyCardIds ?? []),
      ...(state.currentQuestion
        ? [state.currentQuestion.cardId, ...state.currentQuestion.optionCardIds]
        : []),
      ...state.delayedRetries.map((retry) => retry.cardId),
    ];
    if (referencedCardIds.some((cardId) => !allowedCards.has(cardId)))
      invalid("Learn session references a Card outside its Lesson.");
  }
}

async function hydrateCards(
  zip: JSZip,
  portableCards: PortableCard[],
): Promise<Card[]> {
  let totalBytes = 0;
  const hydrated: Card[] = [];
  for (const portable of portableCards) {
    const image = portable.image ? await readImage(zip, portable.image) : null;
    const customAudio = portable.customAudio
      ? await readAudio(zip, portable.customAudio)
      : undefined;
    totalBytes += (image?.blob.size ?? 0) + (customAudio?.blob.size ?? 0);
    if (totalBytes > MAX_TOTAL_ASSET_BYTES)
      invalid("Archive assets are too large.");
    hydrated.push({ ...portable, image, customAudio });
  }
  return hydrated;
}

async function hydrateGeneratedTtsAudio(
  zip: JSZip,
  records: PortableGeneratedTtsAudio[],
): Promise<GeneratedTtsAudio[]> {
  const hydrated: GeneratedTtsAudio[] = [];
  for (const record of records) {
    const blob = await readAsset(zip, record.assetPath, record.mimeType);
    const { assetPath: _assetPath, ...metadata } = record;
    void _assetPath;
    hydrated.push({ ...metadata, blob });
  }
  return hydrated;
}

async function readImage(
  zip: JSZip,
  value: PortableImage,
): Promise<StoredImage> {
  const blob = await readAsset(zip, value.assetPath, value.mimeType);
  return {
    blob,
    mimeType: value.mimeType,
    width: value.width,
    height: value.height,
    alt: value.alt,
  };
}

async function readAudio(
  zip: JSZip,
  value: PortableAudio,
): Promise<CustomAudio> {
  const blob = await readAsset(zip, value.assetPath, value.mimeType);
  return { blob, mimeType: value.mimeType, durationMs: value.durationMs };
}

async function readAsset(
  zip: JSZip,
  path: string,
  mimeType: string,
): Promise<Blob> {
  if (
    !/^assets\/[\p{Letter}\p{Number}._/-]+$/u.test(path) ||
    path.includes("..")
  )
    invalid("Archive asset path is invalid.");
  const file = zip.file(path);
  if (!file) invalid(`Archive asset is missing: ${path}`);
  const bytes = await file.async("uint8array");
  if (bytes.byteLength > MAX_ASSET_BYTES)
    invalid("An archive asset is too large.");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mimeType });
}

function assertPortableCard(value: unknown): PortableCard {
  if (!isObject(value)) invalid("Card is invalid.");
  readString(value.id, "Card id");
  readNonEmpty(value.target, "Card target");
  readNonEmpty(value.targetLanguage, "Card language");
  if (!isObject(value.translations)) invalid("Card translations are invalid.");
  for (const [language, translation] of Object.entries(value.translations)) {
    readNonEmpty(language, "Translation language");
    readString(translation, "Translation");
  }
  if (value.pronunciationText !== undefined)
    readString(value.pronunciationText, "Pronunciation");
  if (value.image !== null) assertPortableImage(value.image);
  if (value.customAudio !== undefined) assertPortableAudio(value.customAudio);
  if (value.imageMetadata !== undefined && !isObject(value.imageMetadata))
    invalid("Image metadata is invalid.");
  readTimestamp(value.createdAt, "Card creation date");
  readTimestamp(value.updatedAt, "Card update date");
  return value as unknown as PortableCard;
}

function assertPortableGeneratedTtsAudio(
  value: unknown,
): PortableGeneratedTtsAudio {
  if (!isObject(value)) invalid("Generated TTS audio is invalid.");
  readNonEmpty(value.cacheKey, "Generated TTS cache key");
  readNonEmpty(value.cardId, "Generated TTS Card id");
  readNonEmpty(value.providerId, "Generated TTS provider");
  readNonEmpty(value.voiceId, "Generated TTS voice");
  readNonEmpty(value.sourceText, "Generated TTS source text");
  readNonEmpty(value.locale, "Generated TTS locale");
  readNonEmpty(value.mimeType, "Generated TTS MIME type");
  readNonEmpty(value.assetPath, "Generated TTS asset path");
  readTimestamp(value.createdAt, "Generated TTS creation date");
  readTimestamp(value.updatedAt, "Generated TTS update date");
  return value as unknown as PortableGeneratedTtsAudio;
}

function assertPortableImage(value: unknown): asserts value is PortableImage {
  if (!isObject(value)) invalid("Image metadata is invalid.");
  readNonEmpty(value.assetPath, "Image asset path");
  readNonEmpty(value.mimeType, "Image MIME type");
  if (value.width !== undefined)
    readPositiveInteger(value.width, "Image width");
  if (value.height !== undefined)
    readPositiveInteger(value.height, "Image height");
  if (value.alt !== undefined) readString(value.alt, "Image alternative text");
}

function assertPortableAudio(value: unknown): asserts value is PortableAudio {
  if (!isObject(value)) invalid("Audio metadata is invalid.");
  readNonEmpty(value.assetPath, "Audio asset path");
  readNonEmpty(value.mimeType, "Audio MIME type");
  if (value.durationMs !== undefined)
    readNonNegativeNumber(value.durationMs, "Audio duration");
}

function assertLesson(value: unknown): asserts value is Lesson {
  if (!isObject(value)) invalid("Lesson is invalid.");
  readNonEmpty(value.id, "Lesson id");
  readNonEmpty(value.name, "Lesson name");
  readNonEmpty(value.targetLanguage, "Lesson language");
  if (
    value.contentType !== undefined &&
    !["vocabulary", "symbols", "phrases"].includes(
      readNonEmpty(value.contentType, "Lesson content type"),
    )
  ) {
    invalid("Lesson content type is invalid.");
  }
  if (
    !Array.isArray(value.translationLanguages) ||
    value.translationLanguages.length === 0
  )
    invalid("Lesson translation languages are invalid.");
  value.translationLanguages.forEach((item) =>
    readNonEmpty(item, "Translation language"),
  );
  const active = readNonEmpty(
    value.activeTranslationLanguage,
    "Active translation",
  );
  if (!value.translationLanguages.includes(active))
    invalid("Active translation is not part of the Lesson.");
  if (value.visibleTranslationLanguages !== undefined) {
    assertStringArray(
      value.visibleTranslationLanguages,
      "Visible translation languages",
    );
    const lessonTranslationLanguages = value.translationLanguages as string[];
    if (
      !value.visibleTranslationLanguages.includes(active) ||
      value.visibleTranslationLanguages.some(
        (language) => !lessonTranslationLanguages.includes(language),
      )
    )
      invalid("Visible translation languages are invalid.");
  }
  if (!isObject(value.tts)) invalid("Lesson speech settings are invalid.");
  readNonEmpty(value.tts.targetLocale, "Speech locale");
  readPositiveNumber(value.tts.speechRate, "Speech rate");
  if (value.tts.voiceUri !== undefined)
    readString(value.tts.voiceUri, "Speech voice");
  if (value.tts.fallbackProviderId !== undefined)
    readString(value.tts.fallbackProviderId, "Speech fallback provider");
  if (value.useImages !== undefined && typeof value.useImages !== "boolean")
    invalid("Lesson image preference is invalid.");
  if (value.kind !== undefined && value.kind !== "user")
    invalid("Lesson kind is invalid.");
  readTimestamp(value.createdAt, "Lesson creation date");
  readTimestamp(value.updatedAt, "Lesson update date");
}

function assertMembership(value: unknown): asserts value is LessonMembership {
  if (!isObject(value)) invalid("Membership is invalid.");
  readNonEmpty(value.lessonId, "Membership Lesson");
  readNonEmpty(value.cardId, "Membership Card");
  readNonNegativeInteger(value.position, "Membership position");
  readTimestamp(value.addedAt, "Membership date");
}

function assertProgress(value: unknown): asserts value is LessonProgress {
  if (!isObject(value)) invalid("Progress is invalid.");
  readNonEmpty(value.lessonId, "Progress Lesson");
  readNonEmpty(value.cardId, "Progress Card");
  if (typeof value.learned !== "boolean") invalid("Learned state is invalid.");
  if (value.learningState !== undefined && !isObject(value.learningState))
    invalid("Learning state is invalid.");
  if (isObject(value.learningState)) {
    readStage(value.learningState.stage, "Learning stage");
    if (typeof value.learningState.dirtyInCurrentBatch !== "boolean")
      invalid("Learning dirty state is invalid.");
  }
  readTimestamp(value.updatedAt, "Progress date");
}

function assertStatistics(
  value: unknown,
): asserts value is GlobalCardStatistics {
  if (!isObject(value)) invalid("Statistics are invalid.");
  readNonEmpty(value.cardId, "Statistics Card");
  readNonNegativeInteger(value.correctCount, "Correct count");
  readNonNegativeInteger(value.errorCount, "Error count");
  readNonNegativeInteger(value.totalCompletedQuestions, "Completed questions");
  readNonNegativeNumber(value.totalResponseTimeMs, "Response time");
  if (value.averageResponseTimeMs !== null)
    readNonNegativeNumber(value.averageResponseTimeMs, "Average response time");
  if (value.lastErrorAt !== undefined)
    readTimestamp(value.lastErrorAt, "Last error date");
  readTimestamp(value.updatedAt, "Statistics date");
}

function assertStudyMarker(value: unknown): asserts value is CardStudyMarker {
  if (!isObject(value)) invalid("Study marker is invalid.");
  readNonEmpty(value.cardId, "Study marker Card");
  readTimestamp(value.markedAt, "Study marker date");
  readTimestamp(value.updatedAt, "Study marker update date");
}

function assertSrsCard(value: unknown): asserts value is SrsCardState {
  if (!isObject(value)) invalid("SRS Card is invalid.");
  readNonEmpty(value.cardId, "SRS Card id");
  readTimestamp(value.dueAt, "SRS due date");
  readNonNegativeNumber(value.stability, "SRS stability");
  readNonNegativeNumber(value.difficulty, "SRS difficulty");
  readNonNegativeNumber(value.elapsedDays, "SRS elapsed days");
  readNonNegativeNumber(value.scheduledDays, "SRS scheduled days");
  readNonNegativeNumber(value.learningSteps, "SRS learning steps");
  readNonNegativeInteger(value.reps, "SRS repetitions");
  readNonNegativeInteger(value.lapses, "SRS lapses");
  if (!["New", "Learning", "Review", "Relearning"].includes(String(value.state)))
    invalid("SRS state is invalid.");
  if (value.lastReviewAt !== undefined)
    readTimestamp(value.lastReviewAt, "SRS last review date");
  readTimestamp(value.introducedAt, "SRS introduction date");
  readTimestamp(value.updatedAt, "SRS update date");
}

function assertSrsReviewLog(value: unknown): asserts value is SrsReviewLog {
  if (!isObject(value)) invalid("SRS review log is invalid.");
  readNonEmpty(value.id, "SRS review id");
  readNonEmpty(value.cardId, "SRS review Card");
  if (!["again", "hard", "good", "easy"].includes(String(value.rating)))
    invalid("SRS review rating is invalid.");
  readTimestamp(value.reviewedAt, "SRS review date");
  readTimestamp(value.dueBefore, "SRS previous due date");
  readTimestamp(value.dueAfter, "SRS next due date");
  readNonNegativeNumber(value.stability, "SRS review stability");
  readNonNegativeNumber(value.difficulty, "SRS review difficulty");
}

function assertSettings(value: unknown): asserts value is ApplicationSettings {
  if (!isObject(value) || value.id !== "application")
    invalid("Application settings are invalid.");
  if (
    !["de", "en", "es", "fr", "it", "ja", "ko", "ru", "uk", "zh"].includes(
      String(value.interfaceLanguage),
    )
  )
    invalid("Interface language is invalid.");
  if (!["system", "light", "dark"].includes(String(value.theme)))
    invalid("Theme is invalid.");
  if (
    value.defaultTargetLanguage !== undefined &&
    value.defaultTargetLanguage !== null
  )
    readNonEmpty(value.defaultTargetLanguage, "Default target language");
  if (value.translationLanguages !== undefined)
    assertStringArray(value.translationLanguages, "Translation languages");
  const defaultActiveTranslationLanguage =
    value.defaultActiveTranslationLanguage === undefined
      ? undefined
      : readNonEmpty(
          value.defaultActiveTranslationLanguage,
          "Default active translation",
        );
  if (
    Array.isArray(value.translationLanguages) &&
    defaultActiveTranslationLanguage !== undefined &&
    !value.translationLanguages.includes(defaultActiveTranslationLanguage)
  )
    invalid(
      "Default active translation is not part of the translation languages.",
    );
  if (value.defaultVisibleTranslationLanguages !== undefined) {
    assertStringArray(
      value.defaultVisibleTranslationLanguages,
      "Default visible translations",
    );
    if (
      defaultActiveTranslationLanguage !== undefined &&
      !value.defaultVisibleTranslationLanguages.includes(
        defaultActiveTranslationLanguage,
      )
    )
      invalid("Default visible translations must include the active translation.");
    if (
      Array.isArray(value.translationLanguages) &&
      value.defaultVisibleTranslationLanguages.some(
        (language) =>
          !(value.translationLanguages as unknown[]).includes(language),
      )
    )
      invalid(
        "Default visible translations must belong to the translation languages.",
      );
  }
  if (value.useImages !== undefined && typeof value.useImages !== "boolean")
    invalid("Image preference is invalid.");
  if (
    value.showJapaneseReadings !== undefined &&
    typeof value.showJapaneseReadings !== "boolean"
  )
    invalid("Japanese reading preference is invalid.");
  if (value.maximumNewCardsPerDay !== undefined)
    readNonNegativeInteger(value.maximumNewCardsPerDay, "Maximum new Cards");
  if (value.audioPreferences !== undefined) {
    if (!isObject(value.audioPreferences))
      invalid("Audio preferences are invalid.");
    for (const [language, preference] of Object.entries(
      value.audioPreferences,
    )) {
      readNonEmpty(language, "Audio preference language");
      if (!isObject(preference)) invalid("Audio preference is invalid.");
      readNonEmpty(preference.targetLocale, "Audio preference locale");
      readPositiveNumber(preference.speechRate, "Audio preference rate");
      if (preference.voiceUri !== undefined)
        readString(preference.voiceUri, "Audio preference voice");
      if (preference.fallbackProviderId !== undefined)
        readString(preference.fallbackProviderId, "Audio fallback provider");
    }
  }
  readTimestamp(value.createdAt, "Settings creation date");
  readTimestamp(value.updatedAt, "Settings update date");
}

function assertLearnSessionRecord(value: unknown): void {
  if (!isObject(value)) invalid("Learn session is invalid.");
  readNonEmpty(value.id, "Learn session id");
  readNonEmpty(value.lessonId, "Learn session Lesson");
  if (
    !isObject(value.state) ||
    value.state.id !== value.id ||
    value.state.lessonId !== value.lessonId ||
    value.state.version !== 1
  )
    invalid("Learn session state is invalid.");
  if (value.state.status !== "active" && value.state.status !== "completed")
    invalid("Learn session status is invalid.");
  for (const field of [
    "remainingNewCardIds",
    "difficultCardIds",
    "learnedCardIds",
    "participatedCardIds",
  ] as const) {
    assertStringArray(value.state[field], `Learn session ${field}`);
  }
  readNonNegativeInteger(
    value.state.completedQuestionCount,
    "Completed question count",
  );
  readPositiveInteger(
    value.state.nextQuestionSequence,
    "Next question sequence",
  );
  if (!Array.isArray(value.state.delayedRetries))
    invalid("Delayed retries are invalid.");
  value.state.delayedRetries.forEach(assertDelayedRetry);
  if (value.state.currentBatch !== null)
    assertLearnBatch(value.state.currentBatch);
  if (value.state.currentQuestion !== null)
    assertLearnQuestion(value.state.currentQuestion);
  readTimestamp(value.createdAt, "Learn session creation date");
  readTimestamp(value.updatedAt, "Learn session update date");
}

function assertLearnBatch(value: unknown): void {
  if (!isObject(value)) invalid("Learn batch is invalid.");
  readPositiveInteger(value.number, "Batch number");
  assertStringArray(value.cardIds, "Batch Cards");
  assertStringArray(value.stageCardOrder, "Batch Card order");
  assertStringArray(value.dirtyCardIds, "Dirty Cards");
  readStage(value.stage, "Batch stage");
  readNonNegativeInteger(value.nextPrimaryIndex, "Batch question position");
}

function assertLearnQuestion(value: unknown): void {
  if (!isObject(value)) invalid("Learn question is invalid.");
  readPositiveInteger(value.sequence, "Question sequence");
  readNonEmpty(value.cardId, "Question Card");
  readExerciseType(value.exerciseType);
  readStage(value.stage, "Question stage");
  if (value.source !== "primary" && value.source !== "delayed-retry")
    invalid("Question source is invalid.");
  assertStringArray(value.optionCardIds, "Question options");
  readNonNegativeInteger(value.incorrectAttempts, "Incorrect attempts");
  readNonNegativeNumber(value.startedAtMs, "Question start time");
}

function assertDelayedRetry(value: unknown): void {
  if (!isObject(value)) invalid("Delayed retry is invalid.");
  readNonEmpty(value.id, "Retry id");
  readNonEmpty(value.cardId, "Retry Card");
  readExerciseType(value.exerciseType);
  readStage(value.stage, "Retry stage");
  readPositiveInteger(value.sourceBatchNumber, "Retry source batch");
  readNonNegativeInteger(
    value.dueAfterCompletedQuestions,
    "Retry due position",
  );
  readPositiveInteger(
    value.createdAtQuestionSequence,
    "Retry question sequence",
  );
}

function assertStringArray(
  value: unknown,
  label: string,
): asserts value is string[] {
  if (!Array.isArray(value)) invalid(`${label} is invalid.`);
  value.forEach((item) => readNonEmpty(item, label));
  assertUnique(value, label);
}

function readStage(value: unknown, label: string): 1 | 2 | 3 {
  if (value !== 1 && value !== 2 && value !== 3)
    invalid(`${label} is invalid.`);
  return value;
}

function readExerciseType(value: unknown): void {
  if (
    !["meaning-to-word", "word-to-meaning", "meaning-to-typing"].includes(
      String(value),
    )
  )
    invalid("Exercise type is invalid.");
}

function assertFormatVersion(value: unknown): void {
  if (!isInteger(value) || value !== PORTABLE_FORMAT_VERSION) {
    throw new PortabilityError(
      "unsupported-version",
      "The archive format version is not supported.",
    );
  }
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length)
    invalid(`${label} must be unique.`);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} is invalid.`);
  return value;
}

function readNonEmpty(value: unknown, label: string): string {
  const result = readString(value, label);
  if (!result.trim()) invalid(`${label} must not be empty.`);
  return result;
}

function readTimestamp(value: unknown, label: string): string {
  const result = readString(value, label);
  if (!Number.isFinite(Date.parse(result))) invalid(`${label} is invalid.`);
  return result;
}

function readPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    invalid(`${label} is invalid.`);
  return value;
}

function readNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    invalid(`${label} is invalid.`);
  return value;
}

function readPositiveInteger(value: unknown, label: string): number {
  const result = readPositiveNumber(value, label);
  if (!Number.isInteger(result)) invalid(`${label} is invalid.`);
  return result;
}

function readNonNegativeInteger(value: unknown, label: string): number {
  const result = readNonNegativeNumber(value, label);
  if (!Number.isInteger(result)) invalid(`${label} is invalid.`);
  return result;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new PortabilityError("invalid-data", message);
}
