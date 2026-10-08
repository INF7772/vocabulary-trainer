import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import { graduateToSrs } from "../../src/domain";
import { schemaV8, VocabularyTrainerDatabase } from "../../src/data/database";
import { CardRepository, SrsRepository } from "../../src/data/repositories";

describe("SRS repository", () => {
  const databases: VocabularyTrainerDatabase[] = [];

  afterEach(async () => {
    await Promise.all(databases.map((database) => database.delete()));
    databases.length = 0;
  });

  it("persists a rating and its audit log atomically", async () => {
    const database = new VocabularyTrainerDatabase(`srs-${crypto.randomUUID()}`);
    databases.push(database);
    const now = "2026-10-02T12:00:00.000Z";
    const cards = new CardRepository(database, () => now, () => "card-1");
    const srs = new SrsRepository(database, () => now, () => "review-1");
    const card = await cards.create({
      target: "猫",
      targetLanguage: "ja",
      translations: { ru: "кошка" },
    });
    await database.srsCards.put(
      graduateToSrs(card.id, new Date("2026-09-01T12:00:00.000Z")),
    );

    const updated = await srs.review(card.id, "hard");

    expect(updated.reps).toBe(2);
    await expect(srs.listLogs(card.id)).resolves.toEqual([
      expect.objectContaining({
        id: "review-1",
        cardId: card.id,
        rating: "hard",
      }),
    ]);
  });

  it("migrates previously Learned Cards as immediately due", async () => {
    const name = `srs-v8-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(8).stores(schemaV8);
    await legacy.open();
    const learnedAt = "2026-09-01T12:00:00.000Z";
    await legacy.table("cards").put({
      id: "card-1",
      normalizedTarget: "猫",
      target: "猫",
      targetLanguage: "ja",
      translations: { ru: "кошка" },
      image: null,
      createdAt: learnedAt,
      updatedAt: learnedAt,
    });
    await legacy.table("lessonProgress").put({
      lessonId: "lesson-1",
      cardId: "card-1",
      learned: true,
      updatedAt: learnedAt,
    });
    legacy.close();

    const upgraded = new VocabularyTrainerDatabase(name);
    databases.push(upgraded);
    await upgraded.open();

    await expect(upgraded.srsCards.get("card-1")).resolves.toMatchObject({
      cardId: "card-1",
      state: "New",
      introducedAt: learnedAt,
    });
  });
});
