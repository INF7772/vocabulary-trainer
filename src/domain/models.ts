export type EntityId = string;
export type Timestamp = string;
export type LanguageCode = string;

export type Translations = Record<LanguageCode, string>;

export interface StoredImage {
  blob: Blob;
  mimeType: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface ImageMetadata {
  sourceUrl?: string;
  author?: string;
  license?: string;
}

export interface CustomAudio {
  blob: Blob;
  mimeType: string;
  durationMs?: number;
}

export interface GeneratedTtsAudio {
  cacheKey: string;
  cardId: EntityId;
  providerId: string;
  voiceId: string;
  sourceText: string;
  locale: string;
  blob: Blob;
  mimeType: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Card {
  id: EntityId;
  itemType?: LearningItemType;
  target: string;
  pronunciationText?: string;
  targetLanguage: LanguageCode;
  translations: Translations;
  image: StoredImage | null;
  imageMetadata?: ImageMetadata;
  customAudio?: CustomAudio;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type LearningItemType = "vocabulary" | "phrase" | "kanji" | "grammar";

export interface LessonTtsSettings {
  targetLocale: string;
  voiceUri?: string;
  speechRate: number;
  fallbackProviderId?: string;
}

export interface Lesson {
  id: EntityId;
  name: string;
  /** Determines the learning interaction used by this Lesson. */
  contentType?: LessonContentType;
  targetLanguage: LanguageCode;
  translationLanguages: LanguageCode[];
  activeTranslationLanguage: LanguageCode;
  visibleTranslationLanguages: LanguageCode[];
  useImages: boolean;
  tts: LessonTtsSettings;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type LessonContentType = "vocabulary" | "symbols" | "phrases";

export interface LessonMembership {
  lessonId: EntityId;
  cardId: EntityId;
  position: number;
  addedAt: Timestamp;
}

export type LearningStage = 1 | 2 | 3;

export interface LessonCardLearningState {
  stage: LearningStage;
  dirtyInCurrentBatch: boolean;
}

export interface LessonProgress {
  lessonId: EntityId;
  cardId: EntityId;
  learned: boolean;
  learningState?: LessonCardLearningState;
  updatedAt: Timestamp;
}

export interface GlobalCardStatistics {
  cardId: EntityId;
  correctCount: number;
  errorCount: number;
  totalCompletedQuestions: number;
  totalResponseTimeMs: number;
  averageResponseTimeMs: number | null;
  lastErrorAt?: Timestamp;
  updatedAt: Timestamp;
}

export interface CardStudyMarker {
  cardId: EntityId;
  markedAt: Timestamp;
  updatedAt: Timestamp;
}

export type SrsState = "New" | "Learning" | "Review" | "Relearning";
export type ReviewRating = "again" | "hard" | "good" | "easy";

/** Global scheduling state. A Card keeps one memory state even when reused. */
export interface SrsCardState {
  cardId: EntityId;
  dueAt: Timestamp;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: SrsState;
  lastReviewAt?: Timestamp;
  introducedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SrsReviewLog {
  id: EntityId;
  cardId: EntityId;
  rating: ReviewRating;
  reviewedAt: Timestamp;
  dueBefore: Timestamp;
  dueAfter: Timestamp;
  stability: number;
  difficulty: number;
}

export type InterfaceLanguage =
  | "de"
  | "en"
  | "es"
  | "fr"
  | "it"
  | "ja"
  | "ko"
  | "ru"
  | "uk"
  | "zh";
export type ThemePreference = "system" | "light" | "dark";

export interface LanguageAudioPreference {
  targetLocale: string;
  voiceUri?: string;
  speechRate: number;
  fallbackProviderId?: string;
}

export interface ApplicationSettings {
  id: "application";
  interfaceLanguage: InterfaceLanguage;
  theme: ThemePreference;
  defaultTargetLanguage: LanguageCode | null;
  translationLanguages: LanguageCode[];
  defaultActiveTranslationLanguage: LanguageCode;
  defaultVisibleTranslationLanguages: LanguageCode[];
  useImages: boolean;
  showJapaneseReadings: boolean;
  maximumNewCardsPerDay: number;
  audioPreferences: Record<LanguageCode, LanguageAudioPreference>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LocalFileSystemHandleRecord {
  id: "lesson-library";
  handle: unknown;
  updatedAt: Timestamp;
}
