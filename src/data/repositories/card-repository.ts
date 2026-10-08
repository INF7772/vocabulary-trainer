import type { Card } from '../../domain';
import type { VocabularyTrainerDatabase } from '../database';
import {
  CardInUseError,
  DuplicateCardError,
  EntityNotFoundError,
} from './errors';
import {
  type Clock,
  type IdFactory,
  normalizeTarget,
  requireNonEmpty,
  systemClock,
  systemIdFactory,
  toCard,
  toCardRecord,
} from './shared';

export type CreateCardInput = Omit<
  Card,
  'id' | 'createdAt' | 'updatedAt' | 'image'
> & {
  image?: Card['image'];
};

export type UpdateCardInput = Partial<
  Omit<Card, 'id' | 'createdAt' | 'updatedAt'>
>;

export interface CreateCardResult {
  card: Card;
  created: boolean;
}

export interface DeleteCardOptions {
  force?: boolean;
}

export class CardRepository {
  constructor(
    private readonly db: VocabularyTrainerDatabase,
    private readonly clock: Clock = systemClock,
    private readonly idFactory: IdFactory = systemIdFactory,
  ) {}

  async create(input: CreateCardInput): Promise<Card> {
    return (await this.createOrReuse(input)).card;
  }

  async createOrReuse(input: CreateCardInput): Promise<CreateCardResult> {
    requireNonEmpty(input.target, 'Card target');
    requireNonEmpty(input.targetLanguage, 'Card target language');

    return this.db.transaction('rw', this.db.cards, async () => {
      const normalizedTarget = normalizeTarget(input.target);
      const existing = await this.db.cards
        .where('[targetLanguage+normalizedTarget]')
        .equals([input.targetLanguage, normalizedTarget])
        .first();

      if (existing) {
        return { card: toCard(existing), created: false };
      }

      const now = this.clock();
      const card: Card = {
        ...input,
        id: this.idFactory(),
        itemType: input.itemType ?? "vocabulary",
        image: input.image ?? null,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.cards.add(toCardRecord(card));

      return { card, created: true };
    });
  }

  async get(id: string): Promise<Card | undefined> {
    const record = await this.db.cards.get(id);
    return record ? toCard(record) : undefined;
  }

  async getRequired(id: string): Promise<Card> {
    const card = await this.get(id);

    if (!card) {
      throw new EntityNotFoundError('Card', id);
    }

    return card;
  }

  async findByTarget(
    targetLanguage: string,
    target: string,
  ): Promise<Card | undefined> {
    const record = await this.db.cards
      .where('[targetLanguage+normalizedTarget]')
      .equals([targetLanguage, normalizeTarget(target)])
      .first();

    return record ? toCard(record) : undefined;
  }

  async list(): Promise<Card[]> {
    const records = await this.db.cards.orderBy('createdAt').toArray();
    return records.map(toCard);
  }

  async update(id: string, input: UpdateCardInput): Promise<Card> {
    return this.db.transaction(
      'rw',
      [this.db.cards, this.db.generatedTtsAudio],
      async () => {
        const current = await this.db.cards.get(id);

        if (!current) {
          throw new EntityNotFoundError('Card', id);
        }

        const updated: Card = {
          ...toCard(current),
          ...input,
          id,
          createdAt: current.createdAt,
          updatedAt: this.clock(),
        };

        requireNonEmpty(updated.target, 'Card target');
        requireNonEmpty(updated.targetLanguage, 'Card target language');

        const duplicate = await this.db.cards
          .where('[targetLanguage+normalizedTarget]')
          .equals([
            updated.targetLanguage,
            normalizeTarget(updated.target),
          ])
          .first();

        if (duplicate && duplicate.id !== id) {
          throw new DuplicateCardError(
            updated.target,
            updated.targetLanguage,
          );
        }

        await this.db.cards.put(toCardRecord(updated));
        if (
          updated.target !== current.target ||
          updated.pronunciationText !== current.pronunciationText
        ) {
          await this.db.generatedTtsAudio.where('cardId').equals(id).delete();
        }
        return updated;
      },
    );
  }

  async delete(id: string, options: DeleteCardOptions = {}): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.cards,
        this.db.lessonMemberships,
        this.db.lessonProgress,
        this.db.cardStatistics,
        this.db.learnSessions,
        this.db.generatedTtsAudio,
        this.db.cardStudyMarkers,
        this.db.srsCards,
        this.db.srsReviewLogs,
      ],
      async () => {
        const card = await this.db.cards.get(id);

        if (!card) {
          return;
        }

        const lessonCount = await this.db.lessonMemberships
          .where('cardId')
          .equals(id)
          .count();
        const affectedLessonIds = options.force
          ? (
              await this.db.lessonMemberships
                .where('cardId')
                .equals(id)
                .toArray()
            ).map((membership) => membership.lessonId)
          : [];

        if (lessonCount > 0 && !options.force) {
          throw new CardInUseError(id, lessonCount);
        }

        if (options.force) {
          await this.db.lessonMemberships.where('cardId').equals(id).delete();
          await this.db.lessonProgress.where('cardId').equals(id).delete();

          for (const lessonId of new Set(affectedLessonIds)) {
            await this.db.learnSessions
              .where('lessonId')
              .equals(lessonId)
              .delete();
          }
        }

        await this.db.cardStatistics.delete(id);
        await this.db.cardStudyMarkers.delete(id);
        await this.db.srsCards.delete(id);
        await this.db.srsReviewLogs.where('cardId').equals(id).delete();
        await this.db.generatedTtsAudio.where('cardId').equals(id).delete();
        await this.db.cards.delete(id);
      },
    );
  }
}
