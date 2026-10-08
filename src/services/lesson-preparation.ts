import { lessonsRepository } from "../data";
import type { Card, Lesson } from "../domain";
import {
  prepareGeneratedAudioForCards,
  type GeneratedAudioPreparationResult,
  type GeneratedAudioProgress,
} from "./audio";
import {
  buildLessonLibraryRevision,
  syncLessonToLibrary,
  type LessonLibrarySyncResult,
} from "./lesson-library";
import {
  importLessonPackage,
  type LessonImportResult,
} from "./portability";

interface LessonPreparationDependencies {
  prepareAudio: typeof prepareGeneratedAudioForCards;
  syncLesson: typeof syncLessonToLibrary;
}

interface LessonImportDependencies extends LessonPreparationDependencies {
  importLesson: typeof importLessonPackage;
  listCards: (lessonId: string) => Promise<Card[]>;
}

export interface LessonPreparationResult {
  audio: GeneratedAudioPreparationResult;
  library: LessonLibrarySyncResult;
}

export interface PreparedLessonImportResult extends LessonImportResult {
  audio: GeneratedAudioPreparationResult;
  library: LessonLibrarySyncResult;
}

const defaultPreparationDependencies: LessonPreparationDependencies = {
  prepareAudio: prepareGeneratedAudioForCards,
  syncLesson: syncLessonToLibrary,
};

const defaultImportDependencies: LessonImportDependencies = {
  ...defaultPreparationDependencies,
  importLesson: importLessonPackage,
  listCards: (lessonId) => lessonsRepository.listCards(lessonId),
};

export async function prepareLessonForOfflineUse(
  lesson: Lesson,
  cards: readonly Card[],
  onProgress?: (progress: GeneratedAudioProgress) => void,
  dependencies: LessonPreparationDependencies = defaultPreparationDependencies,
): Promise<LessonPreparationResult> {
  const audio = await dependencies.prepareAudio(cards, lesson, onProgress);
  const library = await dependencies.syncLesson(
    lesson.id,
    buildLessonLibraryRevision(lesson, cards),
  );
  return { audio, library };
}

export async function importLessonForOfflineUse(
  source: Blob,
  onProgress?: (progress: GeneratedAudioProgress) => void,
  dependencies: LessonImportDependencies = defaultImportDependencies,
): Promise<PreparedLessonImportResult> {
  const imported = await dependencies.importLesson(source);
  const cards = await dependencies.listCards(imported.lesson.id);
  const prepared = await prepareLessonForOfflineUse(
    imported.lesson,
    cards,
    onProgress,
    dependencies,
  );
  return { ...imported, ...prepared };
}
