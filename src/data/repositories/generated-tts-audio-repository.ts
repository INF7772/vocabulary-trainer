import type { GeneratedTtsAudio } from "../../domain";
import type { VocabularyTrainerDatabase } from "../database";
import { type Clock, systemClock } from "./shared";

export type SaveGeneratedTtsAudioInput = Omit<
  GeneratedTtsAudio,
  "createdAt" | "updatedAt"
>;

export class GeneratedTtsAudioRepository {
  constructor(
    private readonly db: VocabularyTrainerDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  get(cacheKey: string): Promise<GeneratedTtsAudio | undefined> {
    return this.db.generatedTtsAudio.get(cacheKey);
  }

  list(): Promise<GeneratedTtsAudio[]> {
    return this.db.generatedTtsAudio.toArray();
  }

  async save(input: SaveGeneratedTtsAudioInput): Promise<GeneratedTtsAudio> {
    const current = await this.get(input.cacheKey);
    const now = this.clock();
    const record: GeneratedTtsAudio = {
      ...input,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    await this.db.generatedTtsAudio.put(record);
    return record;
  }

  deleteForCard(cardId: string): Promise<number> {
    return this.db.generatedTtsAudio.where("cardId").equals(cardId).delete();
  }
}
