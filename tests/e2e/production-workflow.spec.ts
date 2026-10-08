import {
  expect,
  type Browser,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

const vocabulary = [
  ["東京", "Tokyo"],
  ["学校", "school"],
  ["先生", "teacher"],
  ["学生", "student"],
  ["電車", "train"],
  ["駅", "station"],
  ["食べる", "eat"],
  ["飲む", "drink"],
  ["見る", "see"],
  ["聞く", "listen"],
  ["話す", "speak"],
  ["書く", "write"],
] as const;

const targetByMeaning = new Map<string, string>(
  vocabulary.map(([target, meaning]) => [meaning, target]),
);
const meaningByTarget = new Map<string, string>(vocabulary);
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("mandatory portable production workflow", { tag: ["@release", "@storage"] }, async ({ page, browser }) => {
  test.setTimeout(180_000);
  await createTwelveCardLesson(page);
  const lessonUrl = page.url().replace(/\?review=1$/u, "");
  await completeCardMedia(page);

  await expect(
    page.getByText("This lesson is not ready for practice"),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Learn", exact: true }).click();
  await page.getByRole("button", { name: "Learn", exact: true }).click();
  await expect(
    page.locator("#main-content main button[aria-label]").first(),
  ).toBeVisible();

  const firstCorrect = await correctChoiceName(page);
  const choiceButtons = page.locator("#main-content main button[aria-label]");
  const labels = await choiceButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label") ?? ""),
  );
  const wrongLabels = labels.filter((label) => label !== firstCorrect);
  await page.getByRole("button", { name: wrongLabels[0]! }).click();
  await expect(
    page.getByText("Incorrect. Try again.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: wrongLabels[1]! }).click();
  await expect(
    page.getByRole("button", { name: "I don't know the answer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I don't know the answer" }).click();
  await expect(page.getByRole("button", { name: "Next question" })).toBeVisible();
  await advanceToNextQuestion(page);

  let retrySeen = false;
  let carryOverSeen = false;
  for (let question = 0; question < 70; question += 1) {
    if (
      await page
        .getByRole("heading", { name: "Lesson learned" })
        .isVisible()
        .catch(() => false)
    )
      break;
    if (
      await page
        .getByText("Try again", { exact: true })
        .isVisible()
        .catch(() => false)
    )
      retrySeen = true;
    if (
      await page
        .getByText("Batch 2", { exact: true })
        .isVisible()
        .catch(() => false)
    ) {
      carryOverSeen = true;
      await expect(page.getByText("9 learned", { exact: true })).toBeVisible();
    }
    await answerCurrentQuestion(page);
    const next = page.getByRole("button", { name: "Next question" });
    if (await next.isVisible().catch(() => false)) {
      await advanceToNextQuestion(page);
    }
  }
  await expect(
    page.getByRole("heading", { name: "Lesson learned" }),
  ).toBeVisible();
  expect(retrySeen).toBe(true);
  expect(carryOverSeen).toBe(true);

  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByText("12 / 12")).toBeVisible();
  await page.getByRole("link", { name: "Automate" }).click();
  await page.getByRole("link", { name: "Quick Choice" }).click();
  await page.getByRole("button", { name: "Start Quick Choice" }).click();
  await answerCurrentQuestion(page);
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next question" })).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();

  await page.goto(`${lessonUrl}/chaos`);
  const wordSection = page
    .getByRole("heading", { name: "Words" })
    .locator("..");
  const meaningSection = page
    .getByRole("heading", { name: "Meaning blocks" })
    .locator("..");
  const wordButtons = wordSection.getByRole("button");
  const firstWord = (await wordButtons.first().innerText())
    .trim()
    .split("\n")[0]!;
  const correctMeaning = meaningByTarget.get(firstWord)!;
  const meaningButtons = meaningSection.getByRole("button");
  const meaningTexts = await meaningButtons.allInnerTexts();
  const wrongMeaning = meaningTexts
    .map((value) => value.trim())
    .find((value) => value !== correctMeaning)!;
  const wrongTarget = targetByMeaning.get(wrongMeaning)!;
  const errorsBefore = await readErrorCounts(page, [firstWord, wrongTarget]);
  await wordButtons.filter({ hasText: firstWord }).click();
  await meaningButtons.filter({ hasText: wrongMeaning }).click();
  await expect(page.getByText("Those two do not match.")).toBeVisible();
  const errorsAfter = await readErrorCounts(page, [firstWord, wrongTarget]);
  expect(errorsAfter[firstWord]).toBe((errorsBefore[firstWord] ?? 0) + 1);
  expect(errorsAfter[wrongTarget]).toBe((errorsBefore[wrongTarget] ?? 0) + 1);
  await wordButtons.filter({ hasText: firstWord }).click();
  await meaningButtons.filter({ hasText: correctMeaning }).click();
  await expect(page.getByText("Match found")).toBeVisible();

  await page.goto(lessonUrl);
  const lessonDownload = page.waitForEvent("download");
  await page.getByText("More actions", { exact: true }).click();
  await page.getByRole("button", { name: "Export Lesson" }).click();
  const lessonFile = await (await lessonDownload).path();
  expect(lessonFile).not.toBeNull();

  await page.getByLabel("Settings").click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Storage / Backup" }).click();
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full backup" }).click();
  const backupFile = await (await backupDownload).path();
  expect(backupFile).not.toBeNull();

  await verifyCleanLessonImport(browser, lessonFile!);

  await page.goto(lessonUrl);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByText("More actions", { exact: true }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByRole("heading", { name: "Portable Japanese" }),
  ).toHaveCount(0);
  await page.getByLabel("Settings").click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Storage / Backup" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('input[accept^=".vtbackup"]').setInputFiles(backupFile!);
  await expect(
    page.getByText(/Backup restored: 1 lessons and 12 Cards/u),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "My Lessons" }).click();
  await page.getByRole("link", { name: "Portable Japanese", exact: true }).click();
  await expect(page.getByText("12 / 12")).toBeVisible();
});

test("installed app shell and existing data work offline", { tag: ["@shell", "@storage"] }, async ({
  page,
  context,
}) => {
  await installJapaneseSystemVoice(page);
  await createTwelveCardLesson(page);
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText(
      "You are offline. Existing lessons and practice still work.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Portable Japanese" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Automate" }).click();
  await expect(page.getByRole("link", { name: "Quick Choice" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chaos" })).toBeVisible();
});

async function installJapaneseSystemVoice(page: Page) {
  await page.addInitScript(() => {
    class Utterance {
      lang = "";
      rate = 1;
      voice: unknown;
      constructor(public text: string) {}
    }
    const voice = {
      voiceURI: "test-ja",
      name: "Test Japanese",
      lang: "ja-JP",
      localService: true,
      default: false,
    };
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
      value: Utterance,
      configurable: true,
    });
    Object.defineProperty(globalThis, "speechSynthesis", {
      value: {
        getVoices: () => [voice],
        speak: () => undefined,
        cancel: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
  });
}

async function createTwelveCardLesson(page: Page) {
  await page.goto("/lessons/new");
  await page.getByLabel("Lesson name").fill("Portable Japanese");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Target language").fill("jap");
  await page.getByRole("option", { name: /Japanese/i }).getByRole("button").click();
  for (let step = 0; step < 2; step += 1)
    await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByLabel("Paste words")
    .fill(vocabulary.map(([target]) => target).join("\n"));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Paste translation list" }).click();
  await page
    .locator("#bulk-translations")
    .fill(vocabulary.map(([, meaning]) => meaning).join("\n"));
  await page.getByRole("button", { name: "Apply translations" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Generate Cards" }).click();
  await expect(
    page.getByRole("heading", { name: "Portable Japanese" }),
  ).toBeVisible();
}

async function completeCardMedia(page: Page) {
  for (const [target] of vocabulary) {
    await page.getByRole("link", { name: target, exact: true }).first().click();
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: `${target}.png`,
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await expect(page.locator("img").first()).toBeVisible();
    await page.locator('input[type="file"][accept="audio/*"]').setInputFiles({
      name: `${target}.webm`,
      mimeType: "audio/webm",
      buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("heading", { name: "Portable Japanese" }),
    ).toBeVisible();
  }
}

async function correctChoiceName(page: Page): Promise<string> {
  const main = page.locator("#main-content main");
  const heading = main.getByRole("heading", { level: 1 });
  if (await heading.isVisible().catch(() => false)) {
    const target = (await heading.innerText()).trim();
    return optionLabel(
      await main.locator("button[aria-label]").all(),
      meaningByTarget.get(target)!,
    );
  }
  for (const [meaning, target] of targetByMeaning) {
    if (
      await main
        .getByText(meaning, { exact: true })
        .isVisible()
        .catch(() => false)
    ) {
      return optionLabel(
        await main.locator("button[aria-label]").all(),
        target,
      );
    }
  }
  throw new Error("Could not identify the current choice question.");
}

async function optionLabel(options: Locator[], value: string) {
  for (const option of options) {
    const label = await option.getAttribute("aria-label");
    if (label?.endsWith(`. ${value}`)) return label;
  }
  throw new Error(`Expected option was not visible: ${value}`);
}

async function answerCurrentQuestion(page: Page) {
  const input = page.getByLabel("Type the foreign word");
  if (await input.isVisible().catch(() => false)) {
    const main = page.locator("#main-content main");
    for (const [meaning, target] of targetByMeaning) {
      if (
        await main
          .getByText(meaning, { exact: true })
          .isVisible()
          .catch(() => false)
      ) {
        await input.fill(target);
        await page.getByRole("button", { name: "Check answer" }).click();
        return;
      }
    }
  }
  const label = await correctChoiceName(page);
  await page.getByRole("button", { name: label }).click();
}

async function advanceToNextQuestion(page: Page) {
  const next = page.getByRole("button", { name: "Next question" });
  await next.click();
  await expect(next).toBeHidden();
  await expect(
    page.locator("#main-content main button[aria-label]").first().or(
      page.getByLabel("Type the foreign word"),
    ).or(page.getByRole("heading", { name: "Lesson learned" })),
  ).toBeVisible();
}

async function readErrorCounts(
  page: Page,
  targets: string[],
): Promise<Record<string, number>> {
  return page.evaluate(async (requestedTargets) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vocabulary-trainer");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(
      ["cards", "cardStatistics"],
      "readonly",
    );
    const cards = await new Promise<Array<{ id: string; target: string }>>(
      (resolve, reject) => {
        const request = transaction.objectStore("cards").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    const result: Record<string, number> = {};
    for (const target of requestedTargets) {
      const card = cards.find((item) => item.target === target);
      if (!card) continue;
      result[target] = await new Promise<number>((resolve, reject) => {
        const request = transaction.objectStore("cardStatistics").get(card.id);
        request.onsuccess = () => resolve(request.result?.errorCount ?? 0);
        request.onerror = () => reject(request.error);
      });
    }
    database.close();
    return result;
  }, targets);
}

async function verifyCleanLessonImport(browser: Browser, lessonFile: string) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator('input[accept*=".vtlesson"]').setInputFiles(lessonFile);
  await expect(
    page.getByRole("heading", { name: "Portable Japanese" }),
  ).toBeVisible();
  await expect(page.getByText("0 / 12")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("vocabulary-trainer");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("cardStatistics", "readonly");
        const count = await new Promise<number>((resolve, reject) => {
          const request = transaction.objectStore("cardStatistics").count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        database.close();
        return count;
      }),
    )
    .toBe(0);
  await context.close();
}
