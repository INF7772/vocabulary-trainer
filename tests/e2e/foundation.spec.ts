import { expect, test } from "@playwright/test";
import JSZip from "jszip";

test("loads the routed application shell", { tag: ["@shell", "@ui"] }, async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Vocabulary Trainer");
  await expect(page.getByText("Vocabulary Trainer")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "My Lessons",
    }),
  ).toBeVisible();
});

test("creates a lesson through the real wizard and opens Card review", { tag: "@lessons" }, async ({
  page,
}) => {
  await page.goto("/lessons/new");

  await page.getByLabel("Lesson name").fill("Travel Japanese");
  await page.getByRole("button", { name: "Continue" }).click();
  await selectTargetLanguage(page, "jap", "Japanese");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Paste words").fill("猫\n水");
  await page.getByRole("button", { name: "Continue" }).click();
  await fillBulkTranslations(page, "cat\nwater");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Generate Cards" }).click();

  await expect(
    page.getByRole("heading", { name: "Travel Japanese" }),
  ).toBeVisible();
  await expect(
    page.getByText("This lesson is not ready for practice"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "猫" }).last()).toBeVisible();
  await expect(page.getByRole("link", { name: "水" }).last()).toBeVisible();
});

test("creates a third lesson when it reuses a Card from an earlier lesson", { tag: ["@lessons", "@storage"] }, async ({
  page,
}) => {
  await createGermanLesson(page, "First overlap", "Haus", "house");
  await createGermanLesson(page, "Second unique", "Wasser", "water");
  await createGermanLesson(page, "Third overlap", "Haus", "home");

  await expect(
    page.getByRole("heading", { name: "Third overlap" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Haus" }).last()).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("First overlap", { exact: true })).toBeVisible();
  await expect(page.getByText("Second unique", { exact: true })).toBeVisible();
  await expect(page.getByText("Third overlap", { exact: true })).toBeVisible();
});

test("builds a cross-Lesson practice and saves selected Cards as one Lesson", { tag: ["@practice", "@lessons"] }, async ({
  page,
}) => {
  await installSpeechVoice(page, "de-DE");
  await createGermanLesson(page, "Home words", "Haus", "house");
  await createGermanLesson(page, "Water words", "Wasser", "water");

  await page.goto("/practice");
  await page.getByLabel(/Home words · DE · 1/u).check();
  await page.getByLabel(/Water words · DE · 1/u).check();
  await expect(page.getByText(/2 selected.*2 words.*3 exercise formats/u)).toBeVisible();
  await page.getByRole("button", { name: "Customize session" }).click();
  await expect(page.getByText("2 Cards will be used")).toBeVisible();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Haus", { exact: true }).locator("xpath=ancestor::label").getByRole("checkbox"),
  ).toBeChecked();
  await expect(
    page.getByText("Wasser", { exact: true }).locator("xpath=ancestor::label").getByRole("checkbox"),
  ).toBeChecked();

  await page
    .getByLabel("Translation + image → choose the word")
    .uncheck();
  await page
    .getByLabel("Word → choose translation + image")
    .uncheck();
  await page.getByRole("button", { name: "Start practice" }).click();
  const meaning = await page.locator("#main-content main").innerText();
  await page
    .getByPlaceholder("Type the foreign word")
    .fill(meaning.includes("house") ? "Haus" : "Wasser");
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "End session" }).click();
  await page.getByText("Haus", { exact: true }).locator("xpath=ancestor::label").getByRole("checkbox").check();
  await page.getByText("Wasser", { exact: true }).locator("xpath=ancestor::label").getByRole("checkbox").check();
  await page.getByPlaceholder("New lesson name").fill("Combined review");
  await page.getByRole("button", { name: "Create lesson from selected" }).click();

  await expect(page.getByRole("heading", { name: "Combined review" })).toBeVisible();
  await page.getByRole("button", { name: "Select cards" }).click();
  await expect(page.getByRole("checkbox", { name: "selected: Haus" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "selected: Wasser" })).toBeVisible();
});

test("keeps difficult Cards in one live automatic collection", { tag: "@practice" }, async ({ page }) => {
  await createGermanLesson(page, "Difficult source", "Haus", "house");

  await page.getByRole("button", { name: "Mark as difficult: Haus" }).click();
  await expect(page.getByText("Difficult", { exact: true })).toBeVisible();
  await page.goto("/");
  await page.getByText("Automatic Lessons", { exact: true }).click();

  const collection = page
    .getByText("Difficult words", { exact: true })
    .locator("xpath=ancestor::a");
  await expect(collection).toContainText("1 Card");
  await collection.click();
  await page.getByRole("button", { name: "Customize session" }).click();
  await expect(page.getByText(/1 Cards? will be used/u)).toBeVisible();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
});

test("reviews a due Card from Today and stores the self-rating", { tag: ["@learning", "@storage", "@ui"] }, async ({
  page,
}) => {
  await installSpeechVoice(page, "de-DE");
  await createGermanLesson(page, "Scheduled words", "Haus", "house");
  await page.evaluate(async () => {
    const request = indexedDB.open("vocabulary-trainer");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = database.transaction("cards", "readonly").objectStore("cards").getAll();
    const cards = await new Promise<Array<{ id: string }>>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    const now = new Date().toISOString();
    const transaction = database.transaction("srsCards", "readwrite");
    transaction.objectStore("srsCards").put({
      cardId: cards[0]!.id,
      dueAt: "2026-01-01T00:00:00.000Z",
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: "New",
      introducedAt: now,
      updatedAt: now,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.goto("/");
  await expect(page.getByText("Your learning queue is ready")).toBeVisible();
  await page.getByRole("link", { name: "Continue learning" }).click();
  await page.getByPlaceholder("Type the target word").fill("Haus");
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Exact match")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (globalThis as { __spokenTexts?: string[] }).__spokenTexts ?? []))
    .toContain("Haus");
  await page.getByRole("button", { name: "Took a few seconds" }).click();
  await expect(page.getByText(/Next review: in/u)).toBeVisible();
  await page.getByRole("button", { name: "Next task" }).click();
  await expect(page.getByRole("heading", { name: "You're done for today" })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open("vocabulary-trainer");
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("srsReviewLogs", "readonly");
        const count = transaction.objectStore("srsReviewLogs").count();
        const result = await new Promise<number>((resolve, reject) => {
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        });
        database.close();
        return result;
      }),
    )
    .toBe(1);
});

test("uses font-rendered kana choices instead of Japanese typing in Today", { tag: ["@learning", "@translation", "@ui"] }, async ({
  page,
}) => {
  await installSpeechVoice(page, "ja-JP");
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".vtlesson"]').setInputFiles({
    name: "kana.vtlesson",
    mimeType: "application/zip",
    buffer: await createKanaLessonPackage(),
  });
  await expect(page.getByRole("heading", { name: "Kana choices" })).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open("vocabulary-trainer");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = database.transaction("cards", "readonly").objectStore("cards").getAll();
    const cards = await new Promise<Array<{ id: string; target: string }>>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    const kana = cards.find((card) => card.target === "\u3042")!;
    const now = new Date().toISOString();
    const transaction = database.transaction("srsCards", "readwrite");
    transaction.objectStore("srsCards").put({
      cardId: kana.id,
      dueAt: "2026-01-01T00:00:00.000Z",
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: "New",
      introducedAt: now,
      updatedAt: now,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.goto("/today");
  await expect(page.getByText("Choose the kana glyph that matches the romaji")).toBeVisible();
  await expect(page.getByPlaceholder("Type the target word")).toHaveCount(0);
  await expect(page.locator("button[aria-pressed]")).toHaveCount(4);
  await page.getByRole("button", { name: "\u3042", exact: true }).click();
  await expect(page.getByText("Exact match")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (globalThis as { __spokenTexts?: string[] }).__spokenTexts ?? []))
    .toContain("\u3042");
});

test("uses handwriting for an explicit symbol Lesson", { tag: ["@learning", "@ui"] }, async ({
  page,
}) => {
  await installSpeechVoice(page, "ja-JP");
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".vtlesson"]').setInputFiles({
    name: "symbols.vtlesson",
    mimeType: "application/zip",
    buffer: await createSymbolLessonPackage(),
  });
  await expect(
    page.getByRole("heading", { name: "Kana handwriting" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open("vocabulary-trainer");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = database.transaction("cards", "readonly").objectStore("cards").getAll();
    const cards = await new Promise<Array<{ id: string; target: string }>>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    const card = cards.find((item) => item.target === "\u3042")!;
    const now = new Date().toISOString();
    const transaction = database.transaction("srsCards", "readwrite");
    transaction.objectStore("srsCards").put({
      cardId: card.id,
      dueAt: "2026-01-01T00:00:00.000Z",
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: "New",
      introducedAt: now,
      updatedAt: now,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.goto("/today");
  await expect(page.getByText("Write the symbol by hand")).toBeVisible();
  await expect(page.getByPlaceholder("Type the target word")).toHaveCount(0);
  const canvas = page.getByRole("img", { name: "Handwriting canvas" });
  await expect(canvas.locator("text")).toHaveCount(0);
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 80, bounds!.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 200, bounds!.y + 80, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(bounds!.x + 140, bounds!.y + 55);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 140, bounds!.y + 210, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(bounds!.x + 95, bounds!.y + 150);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 195, bounds!.y + 190, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.getByText("Your drawing", { exact: true })).toBeVisible();
  await expect(page.getByText("Correct symbol", { exact: true })).toBeVisible();
  await expect(page.getByText(/similarity/u)).toBeVisible();
  await expect(page.getByRole("img", { name: "Handwriting canvas" })).toBeVisible();
  await expect(page.getByText("\u3042", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /System is wrong/u }).click();
  await expect(page.getByText(/You marked the drawing/u)).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Kana handwriting" }).click();
  await page.getByRole("link", { name: "Handwriting practice" }).click();
  await expect(
    page.getByRole("heading", { name: "Handwriting practice" }),
  ).toBeVisible();
  const practiceCanvas = page.getByRole("img", { name: "Handwriting canvas" });
  await expect(practiceCanvas.locator("text")).toHaveCount(0);
  const practiceBounds = await practiceCanvas.boundingBox();
  expect(practiceBounds).not.toBeNull();
  await page.mouse.move(practiceBounds!.x + 90, practiceBounds!.y + 80);
  await page.mouse.down();
  await page.mouse.move(practiceBounds!.x + 90, practiceBounds!.y + 210);
  await page.mouse.up();
  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.getByText("Correct symbol", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Needs more practice" }).click();
  await expect(page.getByText(/You marked the drawing/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Next question" })).toBeVisible();
});

test("advances Learn handwriting after automatic checking without a confirmation click", { tag: ["@learning", "@ui"] }, async ({
  page,
}) => {
  await installSpeechVoice(page, "ja-JP");
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".vtlesson"]').setInputFiles({
    name: "symbols.vtlesson",
    mimeType: "application/zip",
    buffer: await createSymbolLessonPackage(),
  });

  await page.getByRole("link", { name: "Learn", exact: true }).click();
  await page.getByRole("button", { name: "Learn", exact: true }).click();

  for (let answered = 0; answered < 4; answered += 1) {
    const main = page.locator("#main-content main").last();
    await main.locator("button[aria-label]:not(:disabled)").first().click();
    const correction = page.getByRole("button", {
      name: "My answer was correct",
    });
    const next = page.getByRole("button", { name: "Next question" });
    await expect(next.or(correction)).toBeVisible();
    if (await correction.isVisible()) {
      await correction.click();
    }
    await next.click();
  }

  await expect(page.getByText("Write the symbol by hand")).toBeVisible();
  const questionBefore = await page.getByText(/Question \d+/u).innerText();
  const canvas = page.getByRole("img", { name: "Handwriting canvas" });
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 80, bounds!.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 180, bounds!.y + 80, { steps: 4 });
  await page.mouse.up();

  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText(/similarity/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept as correct" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Needs more practice" })).toHaveCount(0);

  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByText(questionBefore, { exact: true })).toHaveCount(0);
});

test("accepts romaji for Japanese vocabulary with ambiguous kana input", { tag: ["@learning", "@translation", "@ui"] }, async ({
  page,
}) => {
  await installSpeechVoice(page, "ja-JP");
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".vtlesson"]').setInputFiles({
    name: "kana-vocabulary.vtlesson",
    mimeType: "application/zip",
    buffer: await createKanaLessonPackage(),
  });
  await expect(page.getByRole("heading", { name: "Kana choices" })).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open("vocabulary-trainer");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = database.transaction("cards", "readonly").objectStore("cards").getAll();
    const cards = await new Promise<Array<{ id: string; target: string }>>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    const word = cards.find((card) => card.target === "\u3064\u3065\u304f")!;
    const now = new Date().toISOString();
    const transaction = database.transaction("srsCards", "readwrite");
    transaction.objectStore("srsCards").put({
      cardId: word.id,
      dueAt: "2026-01-01T00:00:00.000Z",
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: "New",
      introducedAt: now,
      updatedAt: now,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.goto("/today");
  await expect(page.getByText("Romaji is accepted: type ji for じ/ぢ and zu for ず/づ.")).toBeVisible();
  await page.getByPlaceholder("Type the romaji reading or the Japanese word").fill("tsuzuku");
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Exact match")).toBeVisible();
  await expect(page.getByText("\u3064\u3065\u304f", { exact: true }).first()).toBeVisible();
});

test("generates and displays a Japanese kanji reading when the preference is enabled", { tag: ["@translation", "@settings"] }, async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("heading", { name: "Special features" }).click();
  await page.getByRole("checkbox", { name: /Show Japanese readings/u }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.goto("/lessons/new");
  await page.getByLabel("Lesson name").fill("Kanji readings");
  await page.getByRole("button", { name: "Continue" }).click();
  await selectTargetLanguage(page, "jap", "Japanese");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Paste words").fill("日本");
  await page.getByRole("button", { name: "Continue" }).click();
  await fillBulkTranslations(page, "Japan");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Generate Cards" }).click();

  await expect(page.getByRole("heading", { name: "Kanji readings" })).toBeVisible();
  await expect(page.locator("ruby rt")).toHaveText("にっぽん", { timeout: 30_000 });
});

test("imports a Lesson from Home and exposes all practice modes", { tag: ["@lessons", "@audio", "@practice"] }, async ({
  page,
}) => {
  await installSpeechVoice(page, "ja-JP");
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".vtlesson"]').setInputFiles({
    name: "japanese.vtlesson",
    mimeType: "application/zip",
    buffer: await createJapaneseLessonPackage(),
  });

  await expect(
    page.getByRole("heading", { name: "Imported Japanese" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const request = indexedDB.open("vocabulary-trainer");
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("lessons", "readonly");
        const lessons = await new Promise<
          Array<{ tts: { fallbackProviderId?: string } }>
        >((resolve, reject) => {
          const all = transaction.objectStore("lessons").getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        });
        const audioTransaction = database.transaction(
          "generatedTtsAudio",
          "readonly",
        );
        const generatedCount = await new Promise<number>((resolve, reject) => {
          const count = audioTransaction.objectStore("generatedTtsAudio").count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        });
        database.close();
        return {
          providerId: lessons[0]?.tts.fallbackProviderId,
          generatedCount,
        };
      }),
    )
    .toEqual({ providerId: undefined, generatedCount: 0 });
  await expect(page.getByRole("link", { name: "Learn" })).toBeVisible();
  await page.getByRole("link", { name: "Automate", exact: true }).click();
  await expect(page).toHaveURL(/\/automate$/u);
  await expect(page.getByRole("link", { name: "Quick Choice" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chaos" })).toBeVisible();
  await page.getByRole("link", { name: "Quick Choice" }).click();
  await expect(page).toHaveURL(/\/quick-choice$/u);
  await page.getByRole("button", { name: "Start Quick Choice" }).click();
  await expect(page.getByText("Question 1 / 10")).toBeVisible();
  const shortcuts = page.locator("#main-content main kbd");
  await expect(shortcuts).toHaveCount(2);
  await page.keyboard.press((await shortcuts.first().textContent())!.trim());
  await expect(
    page.getByText(/^(Correct|Incorrect\. Try again\.)$/u, { exact: true }),
  ).toBeVisible();
});

test("persists language defaults independently from interface language", { tag: "@settings" }, async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("heading", { name: "Languages" }).click();
  await page.getByLabel("Default target language").fill("de");
  const translationLanguages = page.getByRole("group", {
    name: "Offline translation packages",
  });
  await translationLanguages.getByLabel("Add language").fill("fr");
  await translationLanguages.getByRole("button", { name: "Add language" }).click();
  await page.getByRole("checkbox", { name: "FR" }).check();
  await page.getByRole("heading", { name: "Special features" }).click();
  await page.getByLabel("Show existing card images by default").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await page.reload();

  await page.getByRole("heading", { name: "Languages" }).click();
  await expect(page.getByLabel("Default target language")).toHaveValue("de");
  await expect(page.getByRole("checkbox", { name: "EN", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "FR", exact: true })).toBeChecked();
  await page.getByRole("heading", { name: "Special features" }).click();
  await expect(
    page.getByLabel("Show existing card images by default"),
  ).not.toBeChecked();
  await page.getByRole("link", { name: "New Lesson" }).click();
  await page.getByLabel("Lesson name").fill("Defaults check");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Target language")).toHaveValue("German");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("English")).toBeChecked();
  await expect(page.getByLabel("French")).toBeChecked();
});

test("shows several translations together and advances Learn only on request", { tag: ["@learning", "@ui"] }, async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await installSpeechVoice(page, "ja-JP");
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".vtlesson"]').setInputFiles({
    name: "japanese.vtlesson",
    mimeType: "application/zip",
    buffer: await createJapaneseLessonPackage(),
  });

  const lessonUrl = page.url();
  await page.getByText("More actions", { exact: true }).click();
  await page.getByRole("link", { name: "Edit lesson" }).click();
  await expect(
    page.getByRole("checkbox", { name: "RU", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "DE", exact: true }),
  ).toBeChecked();
  await page.goto(lessonUrl);

  await page.getByRole("link", { name: "Learn", exact: true }).click();
  await page.getByRole("button", { name: "Learn", exact: true }).click();

  await expect(page.getByText("en", { exact: true })).toBeVisible();
  await expect(page.getByText("ru", { exact: true })).toBeVisible();
  await expect(page.getByText("de", { exact: true })).toBeVisible();

  const correctTarget = (await page.locator("#main-content main").innerText()).includes("cat")
    ? "猫"
    : "水";

  const rejectedAnswer = page
    .locator("#main-content main button[aria-label]")
    .filter({ hasNotText: correctTarget })
    .first();
  const shortcut = (await rejectedAnswer.locator("kbd").textContent())?.trim();
  expect(shortcut).toMatch(/^[1-4]$/u);
  const viewportBox = await page.getByTestId("practice-viewport").boundingBox();
  expect(viewportBox).not.toBeNull();
  expect(viewportBox!.y + viewportBox!.height).toBeLessThanOrEqual(600);
  const startedAt = Date.now();
  await page.keyboard.press(shortcut!);
  await expect(page.getByText("Incorrect. Try again.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "My answer was correct" }).click();
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(500);
  const stoppedTime = await page.getByTestId("question-timer").textContent();
  await page.waitForTimeout(700);
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  await expect(page.getByTestId("question-timer")).toHaveText(stoppedTime!);
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByText("Correct", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "I don't know the answer" }).click();
  await expect(page.getByText(/^Answer: /u)).toBeVisible();
  await page.getByRole("button", { name: "My answer was correct" }).click();
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
});

async function createJapaneseLessonPackage(): Promise<Buffer> {
  const timestamp = "2026-09-25T12:00:00.000Z";
  const lessonId = `imported-${crypto.randomUUID()}`;
  const cards = [
    { id: `${lessonId}-cat`, target: "猫", pronunciationText: "ねこ", translations: { en: "cat", ru: "кот", de: "Katze" } },
    { id: `${lessonId}-water`, target: "水", pronunciationText: "みず", translations: { en: "water", ru: "вода", de: "Wasser" } },
  ];
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    kind: "vocabulary-trainer-lesson",
    formatVersion: 1,
    exportedAt: timestamp,
    lesson: {
      id: lessonId,
      name: "Imported Japanese",
      targetLanguage: "ja",
      translationLanguages: ["en", "ru", "de"],
      activeTranslationLanguage: "en",
      visibleTranslationLanguages: ["en", "ru", "de"],
      useImages: false,
      tts: { targetLocale: "ja-JP", speechRate: 1 },
      kind: "user",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    cardOrder: cards.map((card) => card.id),
    cards: cards.map((card) => ({ ...card, targetLanguage: "ja", image: null, createdAt: timestamp, updatedAt: timestamp })),
    generatedTtsAudio: [],
  }));
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

async function createKanaLessonPackage(): Promise<Buffer> {
  const timestamp = "2026-10-02T12:00:00.000Z";
  const lessonId = `kana-${crypto.randomUUID()}`;
  const targets = ["\u3042", "\u3044", "\u3046", "\u3048", "\u3064\u3065\u304f"];
  const readings = ["a", "i", "u", "e", "tsuzuku"];
  const cards = targets.map((target, index) => ({
    id: `${lessonId}-${index}`,
    target,
    pronunciationText: target,
    translations: { en: readings[index] },
  }));
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    kind: "vocabulary-trainer-lesson",
    formatVersion: 1,
    exportedAt: timestamp,
    lesson: {
      id: lessonId,
      name: "Kana choices",
      targetLanguage: "ja",
      translationLanguages: ["en"],
      activeTranslationLanguage: "en",
      visibleTranslationLanguages: ["en"],
      useImages: false,
      tts: { targetLocale: "ja-JP", speechRate: 1 },
      kind: "user",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    cardOrder: cards.map((card) => card.id),
    cards: cards.map((card) => ({
      ...card,
      targetLanguage: "ja",
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    generatedTtsAudio: [],
  }));
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

async function createSymbolLessonPackage(): Promise<Buffer> {
  const timestamp = "2026-10-04T12:00:00.000Z";
  const lessonId = `symbols-${crypto.randomUUID()}`;
  const targets = ["\u3042", "\u3044"];
  const cards = targets.map((target, index) => ({
    id: `${lessonId}-${index}`,
    target,
    pronunciationText: target,
    targetLanguage: "ja",
    translations: { en: index === 0 ? "a" : "i" },
    image: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    kind: "vocabulary-trainer-lesson",
    formatVersion: 1,
    exportedAt: timestamp,
    lesson: {
      id: lessonId,
      name: "Kana handwriting",
      contentType: "symbols",
      targetLanguage: "ja",
      translationLanguages: ["en"],
      activeTranslationLanguage: "en",
      visibleTranslationLanguages: ["en"],
      useImages: false,
      tts: { targetLocale: "ja-JP", speechRate: 1 },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    cardOrder: cards.map((card) => card.id),
    cards,
    generatedTtsAudio: [],
  }));
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

test("restarts a fully learned Lesson and queues every Card again", { tag: ["@learning", "@practice"] }, async ({
  page,
}) => {
  await page.addInitScript(() => {
    class Utterance {
      lang = "";
      rate = 1;
      voice: unknown;
      constructor(public text: string) {}
    }
    const germanVoice = {
      voiceURI: "test-de",
      name: "Test German",
      lang: "de-DE",
      localService: true,
      default: false,
    };
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
      value: Utterance,
      configurable: true,
    });
    Object.defineProperty(globalThis, "speechSynthesis", {
      value: {
        getVoices: () => [germanVoice],
        speak: () => undefined,
        cancel: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
  });
  await page.goto("/lessons/new");
  await page.getByLabel("Lesson name").fill("German essentials");
  await page.getByRole("button", { name: "Continue" }).click();
  await selectTargetLanguage(page, "ger", "German");
  for (let step = 0; step < 2; step += 1)
    await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Paste words").fill("Hallo");
  await page.getByRole("button", { name: "Continue" }).click();
  await fillBulkTranslations(page, "hello");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Generate Cards" }).click();

  await expect(
    page.getByRole("heading", { name: "German essentials" }),
  ).toBeVisible();
  await expect(
    page.getByText("This lesson is not ready for practice"),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Learn", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Learn", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Learn", exact: true }).click();

  for (let stage = 1; stage <= 2; stage += 1) {
    await expect(
      page.getByText(`Stage ${stage} / 3`, { exact: true }),
    ).toBeVisible();
    const answer = page.locator("#main-content main button[aria-label]").first();
    const shortcut = (await answer.locator("kbd").textContent())?.trim();
    expect(shortcut).toMatch(/^[1-4]$/u);
    await page.keyboard.press(shortcut!);
    await page.getByRole("button", { name: "Next question" }).click();
  }
  await page.locator("#typing-answer").fill("Hallo");
  await page.locator("#typing-answer").press("Enter");
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lesson learned" }),
  ).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Lesson learned" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Restart session" }).click();
  await expect(page.getByText("Stage 1 / 3", { exact: true })).toBeVisible();
  await expect(page.getByText("0 learned", { exact: true })).toBeVisible();
  await expect(
    page.locator("#main-content main button[aria-label]").first(),
  ).toBeVisible();

  await page.getByRole("link", { name: "German essentials" }).click();
  await expect(page.getByText(/Questions: 3/u)).toBeVisible();
  await page.getByRole("link", { name: "Automate", exact: true }).click();
  await page.getByRole("link", { name: "Quick Choice" }).click();
  await page.getByRole("button", { name: "Start Quick Choice" }).click();
  await page.keyboard.press(
    (await page.locator("#main-content main kbd").first().textContent())!.trim(),
  );
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByText(/Questions: 4/u)).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("More actions: Hallo").click();
  await page.getByRole("button", { name: "Reset statistics", exact: true }).click();
  await expect(page.getByText(/Questions: 0/u)).toBeVisible();
  await expect(
    page.getByText("Statistics were reset. Learning progress was kept."),
  ).toBeVisible();
});

async function selectTargetLanguage(
  page: import("@playwright/test").Page,
  query: string,
  language: string,
) {
  await page.getByLabel("Target language").fill(query);
  await page.getByRole("option", { name: new RegExp(language, "i") }).getByRole("button").click();
}

async function fillBulkTranslations(
  page: import("@playwright/test").Page,
  translations: string,
) {
  await page.getByRole("button", { name: "Paste translation list" }).click();
  await page.locator("#bulk-translations").fill(translations);
  await page.getByRole("button", { name: "Apply translations" }).click();
}

async function createGermanLesson(
  page: import("@playwright/test").Page,
  name: string,
  word: string,
  translation: string,
) {
  await page.goto("/lessons/new");
  await page.getByLabel("Lesson name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await selectTargetLanguage(page, "ger", "German");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Paste words").fill(word);
  await page.getByRole("button", { name: "Continue" }).click();
  await fillBulkTranslations(page, translation);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Generate Cards" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function installSpeechVoice(page: import("@playwright/test").Page, locale: string) {
  await page.addInitScript((language) => {
    class Utterance {
      lang = "";
      rate = 1;
      voice: unknown;
      constructor(public text: string) {}
    }
    const matchingVoice = {
      voiceURI: `test-${language}`,
      name: `Test ${language}`,
      lang: language,
      localService: true,
      default: false,
    };
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
      value: Utterance,
      configurable: true,
    });
    Object.defineProperty(globalThis, "speechSynthesis", {
      value: {
        getVoices: () => [matchingVoice],
        speak: (utterance: { text: string }) => {
          const target = globalThis as typeof globalThis & { __spokenTexts?: string[] };
          target.__spokenTexts = [...(target.__spokenTexts ?? []), utterance.text];
        },
        cancel: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
  }, locale);
}
