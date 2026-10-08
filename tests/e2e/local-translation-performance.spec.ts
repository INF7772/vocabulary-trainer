import { _electron as electron, expect, test } from "@playwright/test";
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const executablePath = process.env.LOCAL_TRANSLATION_TEST_EXECUTABLE;
const modelPackageRoot = process.env.LOCAL_TRANSLATION_MODEL_ROOT;

test.skip(
  !executablePath || !modelPackageRoot,
  "Set LOCAL_TRANSLATION_TEST_EXECUTABLE and LOCAL_TRANSLATION_MODEL_ROOT to run the real offline-model check.",
);

test("quickly produces clean Russian translations for short Japanese vocabulary", { tag: "@translation-model" }, async () => {
  test.setTimeout(6 * 60_000);
  const storageRoot = mkdtempSync(path.join(tmpdir(), "vocabulary-translation-test-"));
  const packageTarget = path.join(
    storageRoot,
    "translation-models",
    "multilingual-v1",
  );
  hardLinkTree(modelPackageRoot!, packageTarget);

  const application = await electron.launch({
    executablePath: executablePath!,
    args: ["--lang=en-US"],
    env: {
      ...process.env,
      VOCABULARY_TRAINER_PORTABLE_DATA_DIR: storageRoot,
    },
  });

  try {
    const page = await application.firstWindow();
    await page.goto("vocabulary-trainer://app/lessons/new");
    await page.locator("#lesson-name").fill("Japanese translation quality");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("#target-language").fill("Japanese");
    await page.getByRole("listbox").getByRole("option", { name: "Japanese" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Russian").check();
    await page.getByLabel("English").uncheck();
    await page.getByRole("button", { name: "Continue" }).click();
    const vocabulary = ["部屋", "日本語", "英語", "中国語", "インドネシア語"];
    await page.locator("#target-words").fill(vocabulary.join("\n"));
    await page.getByRole("button", { name: "Continue" }).click();

    await page.evaluate(() => {
      const target = window as typeof window & { translationHeartbeat?: number };
      target.translationHeartbeat = 0;
      window.setInterval(() => {
        target.translationHeartbeat = (target.translationHeartbeat ?? 0) + 1;
      }, 50);
    });
    await page.getByRole("button", { name: "Auto translate all" }).click();

    await expect.poll(
      () => page.evaluate(() =>
        (window as typeof window & { translationHeartbeat?: number })
          .translationHeartbeat ?? 0),
      { timeout: 15_000 },
    ).toBeGreaterThan(10);

    const startedAt = Date.now();
    const translationInputs = vocabulary.map((word) =>
      page.getByLabel(`${word} — Russian`));
    await expect(translationInputs.at(-1)!).not.toHaveValue("", {
      timeout: 5 * 60_000,
    });

    const elapsedMs = Date.now() - startedAt;
    const translations = await Promise.all(
      translationInputs.map((input) => input.inputValue()),
    );
    expect(elapsedMs, "five short words should not take two minutes").toBeLessThan(60_000);
    expect(translations[0]).toMatch(/комнат/iu);
    expect(translations[1]).toMatch(/япон/iu);
    expect(translations[2]).toMatch(/англ/iu);
    expect(translations[3]).toMatch(/китай/iu);
    expect(translations[4]).toMatch(/индонез/iu);
    expect(translations.join(" ")).not.toMatch(/\p{Script=Thai}/u);
  } finally {
    await application.close();
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

function hardLinkTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      hardLinkTree(sourcePath, targetPath);
    } else if (statSync(sourcePath).isFile()) {
      try {
        linkSync(sourcePath, targetPath);
      } catch {
        copyFileSync(sourcePath, targetPath);
      }
    }
  }
}
