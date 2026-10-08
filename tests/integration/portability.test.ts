import JSZip from 'jszip';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DATABASE_SCHEMA_VERSION, VocabularyTrainerDatabase } from '../../src/data/database';
import {
  CardRepository,
  CardStudyMarkerRepository,
  GeneratedTtsAudioRepository,
  LessonRepository,
  SettingsRepository,
  StatisticsRepository,
} from '../../src/data/repositories';
import {
  exportFullBackup,
  exportLessonPackage,
  importLessonPackage,
  PORTABLE_FORMAT_VERSION,
  PortabilityError,
  restoreFullBackup,
} from '../../src/services/portability';

describe('portable Lesson packages and full backups', () => {
  const databases: VocabularyTrainerDatabase[] = [];
  let source: VocabularyTrainerDatabase;

  beforeEach(async () => {
    source = await makeDatabase();
  });

  afterEach(async () => {
    await Promise.all(databases.map((database) => database.delete()));
    databases.length = 0;
  });

  it('exports Lesson content and binary assets without personal statistics', async () => {
    const cards = new CardRepository(source);
    const lessons = new LessonRepository(source);
    const statistics = new StatisticsRepository(source);
    const card = await cards.create({
      target: '水',
      pronunciationText: 'みず',
      targetLanguage: 'ja',
      translations: { en: 'water', de: 'Wasser' },
      image: {
        blob: makeBlob(['image-bytes'], 'image/webp'),
        mimeType: 'image/webp',
        width: 640,
        height: 480,
        alt: 'Water',
      },
      imageMetadata: {
        sourceUrl: 'https://images.example.test/water.jpg',
        author: 'Example author',
        license: 'CC BY 4.0',
      },
      customAudio: {
        blob: makeBlob(['audio-bytes'], 'audio/webm'),
        mimeType: 'audio/webm',
        durationMs: 1_250,
      },
    });
    const lesson = await createLesson(lessons, 'Portable lesson');
    await lessons.addCard(lesson.id, card.id);
    await lessons.saveProgress({ lessonId: lesson.id, cardId: card.id, learned: true });
    await statistics.save({
      cardId: card.id,
      correctCount: 4,
      errorCount: 2,
      totalCompletedQuestions: 4,
      totalResponseTimeMs: 8_000,
    });
    await new GeneratedTtsAudioRepository(source).save({
      cacheKey: 'local-generated-audio',
      cardId: card.id,
      providerId: 'kokoro-jp',
      voiceId: 'jf_alpha',
      sourceText: card.pronunciationText!,
      locale: 'ja-JP',
      blob: makeBlob(['generated-audio'], 'audio/wav'),
      mimeType: 'audio/wav',
    });

    const archive = await exportLessonPackage(lesson.id, source);
    const zip = await JSZip.loadAsync(archive);
    const manifestText = await zip.file('manifest.json')!.async('string');
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty('statistics');
    expect(manifest).not.toHaveProperty('progress');
    expect(manifest).toHaveProperty('generatedTtsAudio');
    expect(Object.keys(zip.files)).toContain('assets/generated-tts/0');
    expect(Object.keys(zip.files)).toContain(`assets/cards/${card.id}/image`);
    expect(Object.keys(zip.files)).toContain(`assets/cards/${card.id}/audio`);
    await expect(zip.file(`assets/cards/${card.id}/image`)!.async('string')).resolves.toBe('image-bytes');
    await expect(zip.file(`assets/cards/${card.id}/audio`)!.async('string')).resolves.toBe('audio-bytes');
    await expect(zip.file('assets/generated-tts/0')!.async('string')).resolves.toBe('generated-audio');

    const destination = await makeDatabase();
    const result = await importLessonPackage(archive, destination);
    expect(result.lesson.visibleTranslationLanguages).toEqual(['en', 'de']);
    const importedCards = await new LessonRepository(destination).listCards(result.lesson.id);
    const imported = importedCards[0]!;
    expect(imported).toMatchObject({
      target: '水',
      pronunciationText: 'みず',
      translations: { en: 'water', de: 'Wasser' },
      imageMetadata: { author: 'Example author', license: 'CC BY 4.0' },
    });
    expect(imported.image).toMatchObject({ mimeType: 'image/webp', width: 640, height: 480 });
    expect(imported.customAudio).toMatchObject({ mimeType: 'audio/webm', durationMs: 1_250 });
    await expect(destination.cardStatistics.count()).resolves.toBe(0);
    await expect(destination.lessonProgress.get([result.lesson.id, imported.id])).resolves.toMatchObject({ learned: false });
    const importedGenerated = await new GeneratedTtsAudioRepository(destination).list();
    expect(importedGenerated).toHaveLength(1);
    expect(importedGenerated[0]).toMatchObject({
      cardId: imported.id,
      providerId: 'kokoro-jp',
      sourceText: 'みず',
    });
  });

  it('round-trips all full-backup data and media', async () => {
    const cards = new CardRepository(source);
    const lessons = new LessonRepository(source);
    const card = await cards.create({
      target: '空',
      targetLanguage: 'ja',
      translations: { en: 'sky' },
      image: { blob: makeBlob(['sky'], 'image/png'), mimeType: 'image/png', width: 20, height: 10 },
      customAudio: { blob: makeBlob(['sound'], 'audio/ogg'), mimeType: 'audio/ogg' },
    });
    const lesson = await createLesson(lessons, 'Backup lesson');
    await lessons.addCard(lesson.id, card.id);
    await lessons.saveProgress({
      lessonId: lesson.id,
      cardId: card.id,
      learned: true,
      learningState: { stage: 3, dirtyInCurrentBatch: false },
    });
    await new StatisticsRepository(source).save({
      cardId: card.id,
      correctCount: 3,
      errorCount: 1,
      totalCompletedQuestions: 3,
      totalResponseTimeMs: 4_500,
    });
    await new CardStudyMarkerRepository(source).setMarked(card.id, true);
    await new GeneratedTtsAudioRepository(source).save({
      cacheKey: 'backup-generated-audio',
      cardId: card.id,
      providerId: 'kokoro-jp',
      voiceId: 'jf_alpha',
      sourceText: card.target,
      locale: 'ja-JP',
      blob: makeBlob(['generated-sound'], 'audio/wav'),
      mimeType: 'audio/wav',
    });
    await new SettingsRepository(source).update({ interfaceLanguage: 'de', theme: 'dark' });

    const archive = await exportFullBackup(source);
    const backupZip = await JSZip.loadAsync(await archive.arrayBuffer());
    await expect(backupZip.file(`assets/cards/${card.id}/image`)!.async('string')).resolves.toBe('sky');
    await expect(backupZip.file(`assets/cards/${card.id}/audio`)!.async('string')).resolves.toBe('sound');
    await expect(backupZip.file('assets/generated-tts/0')!.async('string')).resolves.toBe('generated-sound');
    const destination = await makeDatabase();
    const oldCard = await new CardRepository(destination).create({
      target: 'obsolete', targetLanguage: 'en', translations: { en: 'obsolete' }, image: null,
    });
    const result = await restoreFullBackup(archive, destination);

    expect(result).toEqual({ lessonCount: 1, cardCount: 1 });
    await expect(destination.cards.get(oldCard.id)).resolves.toBeUndefined();
    await expect(destination.lessons.get(lesson.id)).resolves.toMatchObject({ name: 'Backup lesson' });
    await expect(destination.lessonMemberships.get([lesson.id, card.id])).resolves.toBeDefined();
    await expect(destination.lessonProgress.get([lesson.id, card.id])).resolves.toMatchObject({ learned: true });
    await expect(destination.cardStatistics.get(card.id)).resolves.toMatchObject({ correctCount: 3, errorCount: 1 });
    await expect(destination.cardStudyMarkers.get(card.id)).resolves.toMatchObject({ cardId: card.id });
    await expect(destination.settings.get('application')).resolves.toMatchObject({ interfaceLanguage: 'de', theme: 'dark' });
    const restored = await new CardRepository(destination).getRequired(card.id);
    expect(restored.image).toMatchObject({ mimeType: 'image/png', width: 20, height: 10 });
    expect(restored.customAudio).toMatchObject({ mimeType: 'audio/ogg' });
    const restoredGenerated = await new GeneratedTtsAudioRepository(destination).list();
    expect(restoredGenerated).toHaveLength(1);
    expect(restoredGenerated[0]).toMatchObject({
      cacheKey: 'backup-generated-audio',
      cardId: card.id,
      mimeType: 'audio/wav',
    });
    expect(restoredGenerated[0]!.blob).toBeDefined();
  });

  it('rejects corrupted archives without changing existing data', async () => {
    const cards = new CardRepository(source);
    const existing = await cards.create({
      target: 'safe', targetLanguage: 'en', translations: { en: 'safe' }, image: null,
    });

    await expect(restoreFullBackup(makeBlob(['not a zip']), source)).rejects.toMatchObject<Partial<PortabilityError>>({ code: 'corrupted' });
    await expect(cards.get(existing.id)).resolves.toBeDefined();
  });

  it('rejects a newer format or database schema before restore', async () => {
    const newerFormat = await archiveManifest({ kind: 'vocabulary-trainer-backup', formatVersion: PORTABLE_FORMAT_VERSION + 1 });
    await expect(restoreFullBackup(newerFormat, source)).rejects.toMatchObject<Partial<PortabilityError>>({ code: 'unsupported-version' });

    const newerSchema = await archiveManifest({
      kind: 'vocabulary-trainer-backup',
      formatVersion: PORTABLE_FORMAT_VERSION,
      schemaVersion: DATABASE_SCHEMA_VERSION + 1,
    });
    await expect(restoreFullBackup(newerSchema, source)).rejects.toMatchObject<Partial<PortabilityError>>({ code: 'unsupported-version' });
  });

  async function makeDatabase() {
    const database = new VocabularyTrainerDatabase(`portability-${crypto.randomUUID()}`);
    databases.push(database);
    await database.open();
    return database;
  }
});

async function createLesson(repository: LessonRepository, name: string) {
  return repository.create({
    name,
    targetLanguage: 'ja',
    translationLanguages: ['en', 'de'],
    activeTranslationLanguage: 'en',
    visibleTranslationLanguages: ['en', 'de'],
    tts: { targetLocale: 'ja-JP', speechRate: 1 },
  });
}

async function archiveManifest(manifest: Record<string, unknown>): Promise<Blob> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'blob' });
}

function makeBlob(parts: string[], type = ''): Blob {
  return new NodeBlob(parts, { type }) as unknown as Blob;
}
