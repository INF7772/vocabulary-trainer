import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MeaningBlock } from "../../src/components/MeaningBlock";
import type { Card } from "../../src/domain";

describe("MeaningBlock", () => {
  it("renders translation-only layout without a missing-image placeholder", () => {
    const card: Card = {
      id: "card",
      target: "Hallo",
      targetLanguage: "de",
      translations: { en: "hello" },
      image: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { container } = render(
      <MeaningBlock card={card} translationLanguage="en" showImage={false} />,
    );
    expect(screen.getByText("hello")).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText(/missing image/i)).toBeNull();
  });

  it("renders several selected translations at the same time", () => {
    const card: Card = {
      id: "card-multilingual",
      target: "Haus",
      targetLanguage: "de",
      translations: { ru: "дом", en: "house", fr: "maison" },
      image: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    render(
      <MeaningBlock
        card={card}
        translationLanguage="ru"
        translationLanguages={["ru", "en", "fr"]}
        showImage={false}
      />,
    );

    expect(screen.getByText("дом")).toBeVisible();
    expect(screen.getByText("house")).toBeVisible();
    expect(screen.getByText("maison")).toBeVisible();
    expect(screen.getByText("ru")).toBeVisible();
    expect(screen.getByText("en")).toBeVisible();
    expect(screen.getByText("fr")).toBeVisible();
  });
});
