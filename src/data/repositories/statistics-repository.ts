import {
  applyStatisticsDeltas,
  type GlobalCardStatistics,
  type StatisticsDelta,
} from '../../domain';
import type { VocabularyTrainerDatabase } from '../database';
import { EntityNotFoundError } from './errors';
import {
  type Clock,
  normalizeStatistics,
  systemClock,
} from './shared';

export type SaveStatisticsInput = Omit<
  GlobalCardStatistics,
  'averageResponseTimeMs' | 'updatedAt'
>;

export class StatisticsRepository {
  constructor(
    private readonly db: VocabularyTrainerDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  async createEmpty(cardId: string): Promise<GlobalCardStatistics> {
    return this.save({
      cardId,
      correctCount: 0,
      errorCount: 0,
      totalCompletedQuestions: 0,
      totalResponseTimeMs: 0,
    });
  }

  async get(cardId: string): Promise<GlobalCardStatistics | undefined> {
    return this.db.cardStatistics.get(cardId);
  }

  async list(): Promise<GlobalCardStatistics[]> {
    return this.db.cardStatistics.toArray();
  }

  async save(input: SaveStatisticsInput): Promise<GlobalCardStatistics> {
    return this.db.transaction(
      'rw',
      [this.db.cards, this.db.cardStatistics],
      async () => {
        if (!(await this.db.cards.get(input.cardId))) {
          throw new EntityNotFoundError('Card', input.cardId);
        }

        const statistics = normalizeStatistics({
          ...input,
          averageResponseTimeMs: null,
          updatedAt: this.clock(),
        });
        await this.db.cardStatistics.put(statistics);
        return statistics;
      },
    );
  }

  async applyDeltas(
    deltas: readonly StatisticsDelta[],
  ): Promise<GlobalCardStatistics[]> {
    if (deltas.length === 0) {
      return [];
    }

    return this.db.transaction(
      'rw',
      [this.db.cards, this.db.cardStatistics],
      async () => {
        const cardIds = [...new Set(deltas.map((delta) => delta.cardId))];
        const cards = await this.db.cards.bulkGet(cardIds);
        const missingIndex = cards.findIndex((card) => card === undefined);

        if (missingIndex >= 0) {
          throw new EntityNotFoundError('Card', cardIds[missingIndex] as string);
        }

        const current = (
          await this.db.cardStatistics.bulkGet(cardIds)
        ).filter(isStatistics);
        const updated = applyStatisticsDeltas(
          current,
          deltas,
          this.clock(),
        ).filter((item) => cardIds.includes(item.cardId));

        await this.db.cardStatistics.bulkPut(updated);
        return updated;
      },
    );
  }

  async delete(cardId: string): Promise<void> {
    await this.reset([cardId]);
  }

  async reset(cardIds: readonly string[]): Promise<void> {
    const uniqueCardIds = [...new Set(cardIds)];
    if (uniqueCardIds.length === 0) return;
    await this.db.transaction('rw', this.db.cardStatistics, async () => {
      await this.db.cardStatistics.bulkDelete(uniqueCardIds);
    });
  }
}

function isStatistics(
  statistics: GlobalCardStatistics | undefined,
): statistics is GlobalCardStatistics {
  return statistics !== undefined;
}
