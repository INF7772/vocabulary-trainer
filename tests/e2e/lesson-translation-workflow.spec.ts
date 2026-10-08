import { expect, test } from "@playwright/test";

test("uses the six-step language and table translation workflow", { tag: ["@translation", "@lessons"] }, async ({ page }) => {
  await page.goto("/lessons/new");
  await expect(page.getByText("Step 1 of 6")).toBeVisible();

  await page.getByLabel("Lesson name").fill("German basics");
  await page.getByRole("button", { name: "Continue" }).click();
  const targetLanguage = page.getByLabel("Target language");
  await targetLanguage.fill("ger");
  await page.getByRole("listbox").getByRole("option", { name: /German/u }).click();
  await expect(targetLanguage).toHaveValue("German");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Step 3 of 6")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add language" })).toHaveCount(0);
  await page.getByLabel("Russian").check();
  await page.getByLabel("English").uncheck();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Paste words").fill("Haus\nWasser");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 5 of 6")).toBeVisible();
  await expect(page.getByText("Haus", { exact: true })).toBeVisible();
  await expect(page.getByText("Wasser", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Paste translation list" }).click();
  const paste = page.getByLabel("Paste translation list");
  await paste.fill("дом");
  await expect(page.getByText("1 non-empty lines for 2 words")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply translations" })).toBeDisabled();

  await paste.fill("дом\nвода");
  await page.getByRole("button", { name: "Apply translations" }).click();
  const houseTranslation = page.getByLabel(/Haus.*Russian/u);
  const waterTranslation = page.getByLabel(/Wasser.*Russian/u);
  await expect(houseTranslation).toHaveValue("дом");
  await expect(waterTranslation).toHaveValue("вода");

  await houseTranslation.fill("жилище");
  await expect(houseTranslation).toHaveValue("жилище");
});

test("shows the missing desktop model dialog immediately", { tag: "@translation" }, async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "vocabularyTrainerDesktop", {
      configurable: true,
      value: {
        getTranslationPackageStatus: async (packageId: string) => ({
          packageId,
          installed: false,
          estimatedBytes: 236_851_768,
          directory: `C:\\portable\\translation-models\\${packageId}`,
          supported: true,
        }),
        onTranslationPackageProgress: () => () => undefined,
      },
    });
  });
  await page.goto("/lessons/new");
  await page.getByLabel("Lesson name").fill("Missing model");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Target language").fill("ger");
  await page.getByRole("listbox").getByRole("option", { name: /German/u }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Russian").check();
  await page.getByLabel("English").uncheck();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Paste words").fill("Haus");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Auto translate all" }).click();
  const dialog = page.getByRole("dialog", { name: "Offline translation package required" });
  await expect(dialog).toContainText("German → Russian");
  await expect(dialog).toContainText("647 MB");
  await expect(dialog.getByRole("button", { name: "Download" })).toBeVisible();
});

test("fills kana study readings instantly without an offline model", { tag: "@translation" }, async ({ page }) => {
  await page.goto("/lessons/new");
  await page.getByLabel("Lesson name").fill("Hiragana");
  await page.getByRole("button", { name: "Continue" }).click();
  const targetLanguage = page.getByLabel("Target language");
  await targetLanguage.fill("jap");
  await page.getByRole("listbox").getByRole("option", { name: /Japanese/u }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Paste words").fill("あ\nし\nつ\nきゃ");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Auto translate all" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel(/あ.*English/u)).toHaveValue("a");
  await expect(page.getByLabel(/し.*English/u)).toHaveValue("shi");
  await expect(page.getByLabel(/つ.*English/u)).toHaveValue("tsu");
  await expect(page.getByLabel(/きゃ.*English/u)).toHaveValue("kya");
  await expect(page.getByRole("status")).toContainText("romaji readings");

  for (const symbol of ["あ", "し", "つ", "きゃ"]) {
    await page.getByLabel(new RegExp(`${symbol}.*English`, "u")).fill("");
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Generate Cards" }).click();
  await expect(page.getByRole("heading", { name: "Hiragana" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "あ" }).last().locator("xpath=ancestor::li[1]"),
  ).toContainText("EN: a");
  await expect(
    page.getByRole("link", { name: "し" }).last().locator("xpath=ancestor::li[1]"),
  ).toContainText("EN: shi");
});
