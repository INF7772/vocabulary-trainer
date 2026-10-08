import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../src/app/App";
import { i18n } from "../../src/i18n";

describe("application shell", () => {
  afterEach(async () => {
    cleanup();
    window.history.pushState({}, "", "/");
    await i18n.changeLanguage("en");
  });

  it("renders the responsive product shell and localized home page", async () => {
    await i18n.changeLanguage("en");
    render(<App />);

    expect(screen.getByText("Vocabulary Trainer")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        name: "My Lessons",
      }),
    ).toBeInTheDocument();
  });

  it("walks through lesson creation and reports incomplete cards on review", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("en");
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "New Lesson" }));
    await user.type(
      await screen.findByLabelText("Lesson name"),
      "Japanese basics",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Target language"), "jap");
    await user.click(screen.getByRole("button", { name: /Japanese/u }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Step 3 of 6");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(await screen.findByLabelText("Paste words"), "猫\n水");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Paste translation list" }));
    await user.type(screen.getByLabelText("Paste translation list"), "cat\nwater");
    await user.click(screen.getByRole("button", { name: "Apply translations" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Generate Cards" }));

    expect(
      await screen.findByRole("heading", { name: "Japanese basics" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This lesson is not ready for practice"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "猫" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "水" }).length).toBeGreaterThan(0);
  });

  it("creates a symbol lesson without translation setup", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("en");
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "New Lesson" }));
    await user.click(screen.getByRole("button", { name: /^Symbols/u }));
    await user.type(screen.getByLabelText("Lesson name"), "Korean signs");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Target language"), "kor");
    await user.click(screen.getByRole("button", { name: /Korean/u }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Step 3 of 4")).toBeInTheDocument();
    expect(screen.queryByText("Translation languages")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Paste symbols"), "ㄱ\nㄴ");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Step 4 of 4")).toBeInTheDocument();
    expect(screen.queryByText("Translations")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Generate Cards" }));

    expect(
      await screen.findByRole("heading", { name: "Korean signs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Handwriting practice" }),
    ).toBeInTheDocument();
  });
});
