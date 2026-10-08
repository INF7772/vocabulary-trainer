import type { CardStudyMarker } from "../../domain";
import type { VocabularyTrainerDatabase } from "../database";
import { EntityNotFoundError } from "./errors";
import { type Clock, systemClock } from "./shared";

export class CardStudyMarkerRepository {
  constructor(
    private readonly db: VocabularyTrainerDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  async list(): Promise<CardStudyMarker[]> {
    return this.db.cardStudyMarkers.toArray();
  }

  async isMarked(cardId: string): Promise<boolean> {
    return Boolean(await this.db.cardStudyMarkers.get(cardId));
  }

  async setMarked(cardId: string, marked: boolean): Promise<void> {
    await this.db.transaction(
      "rw",
      [this.db.cards, this.db.cardStudyMarkers],
      async () => {
        if (!(await this.db.cards.get(cardId))) {
          throw new EntityNotFoundError("Card", cardId);
        }
        if (!marked) {
          await this.db.cardStudyMarkers.delete(cardId);
          return;
        }
        const current = await this.db.cardStudyMarkers.get(cardId);
        const now = this.clock();
        await this.db.cardStudyMarkers.put({
          cardId,
          markedAt: current?.markedAt ?? now,
          updatedAt: now,
        });
      },
    );
  }
}
