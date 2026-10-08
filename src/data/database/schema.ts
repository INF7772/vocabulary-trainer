export const DATABASE_NAME = "vocabulary-trainer";
export const DATABASE_SCHEMA_VERSION = 9;

export const schemaV1 = {
  cards:
    "&id,&[targetLanguage+normalizedTarget],targetLanguage,createdAt,updatedAt",
  lessons: "&id,targetLanguage,createdAt,updatedAt",
  lessonMemberships:
    "&[lessonId+cardId],lessonId,cardId,[lessonId+position],addedAt",
  lessonProgress: "&[lessonId+cardId],lessonId,cardId,learned,updatedAt",
  cardStatistics: "&cardId,updatedAt",
  settings: "&id,interfaceLanguage,updatedAt",
} as const;

export const schemaV2 = {
  ...schemaV1,
  learnSessions: "&id,lessonId,updatedAt",
} as const;

export const schemaV3 = { ...schemaV2 } as const;

export const schemaV4 = { ...schemaV3 } as const;

export const schemaV5 = {
  ...schemaV4,
  generatedTtsAudio: "&cacheKey,cardId,providerId,updatedAt",
} as const;

export const schemaV6 = {
  ...schemaV5,
  fileSystemHandles: "&id,updatedAt",
} as const;

export const schemaV7 = { ...schemaV6 } as const;

export const schemaV8 = {
  ...schemaV7,
  cardStudyMarkers: "&cardId,markedAt,updatedAt",
} as const;

export const schemaV9 = {
  ...schemaV8,
  srsCards: "&cardId,dueAt,introducedAt,updatedAt",
  srsReviewLogs: "&id,cardId,reviewedAt",
} as const;
