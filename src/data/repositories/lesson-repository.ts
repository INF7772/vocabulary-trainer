import type {
  Card,
  Lesson,
  LessonContentType,
  LessonMembership,
  LessonProgress,
  LessonTtsSettings,
} from "../../domain";
import type { VocabularyTrainerDatabase } from "../database";
import type { CardRecord } from "../database/records";
import { EntityNotFoundError, InvalidEntityError } from "./errors";
import {
  type Clock,
  type IdFactory,
  requireNonEmpty,
  systemClock,
  systemIdFactory,
  toCard,
} from "./shared";

export interface CreateLessonInput {
  name: string;
  contentType?: LessonContentType;
  targetLanguage: string;
  translationLanguages: string[];
  activeTranslationLanguage: string;
  visibleTranslationLanguages?: string[];
  useImages?: boolean;
  tts?: Partial<LessonTtsSettings>;
}

export type UpdateLessonInput = Partial<
  Omit<Lesson, "id" | "createdAt" | "updatedAt">
>;

export interface DeleteLessonOptions {
  deleteOrphanCards?: boolean;
}

export class LessonRepository {
  constructor(
    private readonly db: VocabularyTrainerDatabase,
    private readonly clock: Clock = systemClock,
    private readonly idFactory: IdFactory = systemIdFactory,
  ) {}

  async create(input: CreateLessonInput): Promise<Lesson> {
    const now = this.clock();
    const lesson: Lesson = {
      ...input,
      contentType: input.contentType ?? "vocabulary",
      id: this.idFactory(),
      translationLanguages: [...new Set(input.translationLanguages)],
      visibleTranslationLanguages: [
        ...new Set([
          input.activeTranslationLanguage,
          ...(input.visibleTranslationLanguages ?? [
            input.activeTranslationLanguage,
          ]),
        ]),
      ],
      useImages: input.useImages ?? true,
      tts: {
        targetLocale: input.tts?.targetLocale ?? input.targetLanguage,
        voiceUri: input.tts?.voiceUri,
        speechRate: input.tts?.speechRate ?? 1,
        fallbackProviderId: input.tts?.fallbackProviderId,
      },
      createdAt: now,
      updatedAt: now,
    };

    validateLesson(lesson);
    await this.db.lessons.add(lesson);
    return lesson;
  }

  async get(id: string): Promise<Lesson | undefined> {
    return this.db.lessons.get(id);
  }

  async getRequired(id: string): Promise<Lesson> {
    const lesson = await this.get(id);

    if (!lesson) {
      throw new EntityNotFoundError("Lesson", id);
    }

    return lesson;
  }

  async list(): Promise<Lesson[]> {
    return this.db.lessons.orderBy("createdAt").toArray();
  }

  async update(id: string, input: UpdateLessonInput): Promise<Lesson> {
    const current = await this.getRequired(id);
    const updated: Lesson = {
      ...current,
      ...input,
      id,
      translationLanguages: input.translationLanguages
        ? [...new Set(input.translationLanguages)]
        : current.translationLanguages,
      visibleTranslationLanguages: input.visibleTranslationLanguages
        ? [
            ...new Set([
              input.activeTranslationLanguage ??
                current.activeTranslationLanguage,
              ...input.visibleTranslationLanguages,
            ]),
          ]
        : input.activeTranslationLanguage
          ? [
              ...new Set([
                input.activeTranslationLanguage,
                ...current.visibleTranslationLanguages,
              ]),
            ]
          : current.visibleTranslationLanguages,
      tts: input.tts ? { ...current.tts, ...input.tts } : current.tts,
      createdAt: current.createdAt,
      updatedAt: this.clock(),
    };

    validateLesson(updated);
    await this.db.lessons.put(updated);
    return updated;
  }

  async addCard(
    lessonId: string,
    cardId: string,
    position?: number,
  ): Promise<LessonMembership> {
    return this.db.transaction(
      "rw",
      [
        this.db.lessons,
        this.db.cards,
        this.db.lessonMemberships,
        this.db.lessonProgress,
      ],
      async () => {
        await this.assertLessonAndCardExist(lessonId, cardId);

        const existing = await this.db.lessonMemberships.get([
          lessonId,
          cardId,
        ]);

        if (existing) {
          return existing;
        }

        const memberships = await this.db.lessonMemberships
          .where("lessonId")
          .equals(lessonId)
          .toArray();
        const nextPosition =
          memberships.reduce(
            (maximum, membership) => Math.max(maximum, membership.position),
            -1,
          ) + 1;
        const now = this.clock();
        const membership: LessonMembership = {
          lessonId,
          cardId,
          position: position ?? nextPosition,
          addedAt: now,
        };

        await this.db.lessonMemberships.add(membership);
        await this.db.lessonProgress.add({
          lessonId,
          cardId,
          learned: false,
          updatedAt: now,
        });

        return membership;
      },
    );
  }

  async removeCard(lessonId: string, cardId: string): Promise<void> {
    await this.db.transaction(
      "rw",
      [this.db.lessonMemberships, this.db.lessonProgress],
      async () => {
        await this.db.lessonMemberships.delete([lessonId, cardId]);
        await this.db.lessonProgress.delete([lessonId, cardId]);
      },
    );
  }

  async updateMembershipPosition(
    lessonId: string,
    cardId: string,
    position: number,
  ): Promise<LessonMembership> {
    if (!Number.isInteger(position) || position < 0) {
      throw new InvalidEntityError(
        "Lesson membership position must be a non-negative integer.",
      );
    }

    const membership = await this.db.lessonMemberships.get([lessonId, cardId]);

    if (!membership) {
      throw new EntityNotFoundError(
        "LessonMembership",
        `${lessonId}:${cardId}`,
      );
    }

    const updated = { ...membership, position };
    await this.db.lessonMemberships.put(updated);
    return updated;
  }

  async listMemberships(lessonId: string): Promise<LessonMembership[]> {
    const memberships = await this.db.lessonMemberships
      .where("lessonId")
      .equals(lessonId)
      .toArray();

    return memberships.sort((left, right) => left.position - right.position);
  }

  async listCards(lessonId: string): Promise<Card[]> {
    const memberships = await this.listMemberships(lessonId);
    const records = await this.db.cards.bulkGet(
      memberships.map((membership) => membership.cardId),
    );

    return records.filter(isCardRecord).map(toCard);
  }

  async getProgress(
    lessonId: string,
    cardId: string,
  ): Promise<LessonProgress | undefined> {
    return this.db.lessonProgress.get([lessonId, cardId]);
  }

  async listProgress(lessonId: string): Promise<LessonProgress[]> {
    return this.db.lessonProgress.where("lessonId").equals(lessonId).toArray();
  }

  async saveProgress(
    progress: Omit<LessonProgress, "updatedAt">,
  ): Promise<LessonProgress> {
    return this.db.transaction(
      "rw",
      [this.db.lessonMemberships, this.db.lessonProgress],
      async () => {
        const membership = await this.db.lessonMemberships.get([
          progress.lessonId,
          progress.cardId,
        ]);

        if (!membership) {
          throw new InvalidEntityError(
            "Lesson progress requires an existing lesson membership.",
          );
        }

        const saved: LessonProgress = {
          ...progress,
          updatedAt: this.clock(),
        };
        await this.db.lessonProgress.put(saved);
        return saved;
      },
    );
  }

  async delete(
    lessonId: string,
    options: DeleteLessonOptions = {},
  ): Promise<void> {
    await this.db.transaction(
      "rw",
      [
        this.db.lessons,
        this.db.cards,
        this.db.lessonMemberships,
        this.db.lessonProgress,
        this.db.cardStatistics,
        this.db.learnSessions,
        this.db.generatedTtsAudio,
        this.db.cardStudyMarkers,
      ],
      async () => {
        const memberships = await this.db.lessonMemberships
          .where("lessonId")
          .equals(lessonId)
          .toArray();

        await this.db.lessonMemberships
          .where("lessonId")
          .equals(lessonId)
          .delete();
        await this.db.lessonProgress
          .where("lessonId")
          .equals(lessonId)
          .delete();
        await this.db.lessons.delete(lessonId);
        await this.db.learnSessions.where("lessonId").equals(lessonId).delete();

        if (!options.deleteOrphanCards) {
          return;
        }

        for (const { cardId } of memberships) {
          const remainingMemberships = await this.db.lessonMemberships
            .where("cardId")
            .equals(cardId)
            .count();

          if (remainingMemberships === 0) {
            await this.db.cardStatistics.delete(cardId);
            await this.db.cardStudyMarkers.delete(cardId);
            await this.db.generatedTtsAudio
              .where("cardId")
              .equals(cardId)
              .delete();
            await this.db.cards.delete(cardId);
          }
        }
      },
    );
  }

  private async assertLessonAndCardExist(
    lessonId: string,
    cardId: string,
  ): Promise<void> {
    const [lesson, card] = await Promise.all([
      this.db.lessons.get(lessonId),
      this.db.cards.get(cardId),
    ]);

    if (!lesson) {
      throw new EntityNotFoundError("Lesson", lessonId);
    }

    if (!card) {
      throw new EntityNotFoundError("Card", cardId);
    }
  }
}

function validateLesson(lesson: Lesson): void {
  requireNonEmpty(lesson.name, "Lesson name");
  requireNonEmpty(lesson.targetLanguage, "Lesson target language");

  if (
    lesson.contentType &&
    !(["vocabulary", "symbols", "phrases"] as const).includes(
      lesson.contentType,
    )
  ) {
    throw new InvalidEntityError("Lesson content type is invalid.");
  }

  if (lesson.translationLanguages.length === 0) {
    throw new InvalidEntityError(
      "A lesson must have at least one translation language.",
    );
  }

  if (!lesson.translationLanguages.includes(lesson.activeTranslationLanguage)) {
    throw new InvalidEntityError(
      "The active translation language must belong to the lesson.",
    );
  }

  if (
    lesson.visibleTranslationLanguages.length === 0 ||
    !lesson.visibleTranslationLanguages.includes(
      lesson.activeTranslationLanguage,
    ) ||
    lesson.visibleTranslationLanguages.some(
      (language) => !lesson.translationLanguages.includes(language),
    )
  ) {
    throw new InvalidEntityError(
      "Visible translation languages must belong to the lesson and include the active translation.",
    );
  }

  if (!Number.isFinite(lesson.tts.speechRate) || lesson.tts.speechRate <= 0) {
    throw new InvalidEntityError("TTS speech rate must be greater than zero.");
  }
}

function isCardRecord(record: CardRecord | undefined): record is CardRecord {
  return record !== undefined;
}
