import {
  previewSrsReview,
  scheduleSrsReview,
  type ReviewRating,
  type SrsCardState,
  type SrsPreview,
  type SrsReviewLog,
} from "../../domain";
import type { VocabularyTrainerDatabase } from "../database";
import { EntityNotFoundError } from "./errors";
import {
  type Clock,
  type IdFactory,
  systemClock,
  systemIdFactory,
} from "./shared";

export class SrsRepository {
  constructor(
    private readonly db: VocabularyTrainerDatabase,
    private readonly clock: Clock = systemClock,
    private readonly idFactory: IdFactory = systemIdFactory,
  ) {}

  async get(cardId: string): Promise<SrsCardState | undefined> {
    return this.db.srsCards.get(cardId);
  }

  async list(): Promise<SrsCardState[]> {
    return this.db.srsCards.toArray();
  }

  async listLogs(cardId?: string): Promise<SrsReviewLog[]> {
    return cardId
      ? this.db.srsReviewLogs.where("cardId").equals(cardId).sortBy("reviewedAt")
      : this.db.srsReviewLogs.orderBy("reviewedAt").toArray();
  }

  async preview(cardId: string): Promise<SrsPreview[]> {
    const current = await this.db.srsCards.get(cardId);
    if (!current) throw new EntityNotFoundError("SRS Card", cardId);
    return previewSrsReview(current, new Date(this.clock()));
  }

  async review(cardId: string, rating: ReviewRating): Promise<SrsCardState> {
    return this.db.transaction(
      "rw",
      [this.db.cards, this.db.srsCards, this.db.srsReviewLogs],
      async () => {
        if (!(await this.db.cards.get(cardId))) {
          throw new EntityNotFoundError("Card", cardId);
        }
        const current = await this.db.srsCards.get(cardId);
        if (!current) throw new EntityNotFoundError("SRS Card", cardId);
        const reviewedAt = this.clock();
        const next = scheduleSrsReview(current, rating, new Date(reviewedAt));
        await this.db.srsCards.put(next);
        await this.db.srsReviewLogs.add({
          id: this.idFactory(),
          cardId,
          rating,
          reviewedAt,
          dueBefore: current.dueAt,
          dueAfter: next.dueAt,
          stability: next.stability,
          difficulty: next.difficulty,
        });
        return next;
      },
    );
  }
}
