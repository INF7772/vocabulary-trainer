import { expect, test } from "@playwright/test";
import JSZip from "jszip";

test.skip(
  process.env.RUN_LOCAL_VOICE_E2E !== "1",
  "Run explicitly because real local model initialization is resource intensive.",
);

test("prepares and reuses the self-hosted Japanese voice without model network requests", { tag: "@voice-model" }, async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  const remoteModelRequests: string[] = [];
  const browserDiagnostics: string[] = [];
  page.on("console", (message) => {
    browserDiagnostics.push(message.text());
  });
  page.on("pageerror", (error) => browserDiagnostics.push(error.message));
  page.on("requestfailed", (request) =>
    browserDiagnostics.push(
      `${request.url()}: ${request.failure()?.errorText ?? "request failed"}`,
    ),
  );
  page.on("request", (request) => {
    if (/huggingface\.co|cdn\.jsdelivr\.net/u.test(request.url())) {
      remoteModelRequests.push(request.url());
    }
  });
  await page.addInitScript(() => {
    const originalPlay = HTMLMediaElement.prototype.play;
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: function play() {
        (
          globalThis as typeof globalThis & {
            __vocabularyTrainerAudioStartedAt?: number;
          }
        ).__vocabularyTrainerAudioStartedAt = performance.now();
        try {
          const result = originalPlay.call(this);
          void result.catch(() => undefined);
        } catch {
          // The benchmark only needs the synchronous playback boundary.
        }
        return Promise.resolve();
      },
    });
  });

  await page.goto("/");
  page.on("dialog", (dialog) => void dialog.accept());
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __voiceHeartbeat?: {
        intervalId: ReturnType<typeof globalThis.setInterval>;
        lastAt: number;
        maxGapMs: number;
        ticks: number;
      };
    };
    const heartbeat = {
      intervalId: undefined as unknown as ReturnType<
        typeof globalThis.setInterval
      >,
      lastAt: performance.now(),
      maxGapMs: 0,
      ticks: 0,
    };
    heartbeat.intervalId = globalThis.setInterval(() => {
      const now = performance.now();
      heartbeat.maxGapMs = Math.max(heartbeat.maxGapMs, now - heartbeat.lastAt);
      heartbeat.lastAt = now;
      heartbeat.ticks += 1;
    }, 50);
    scope.__voiceHeartbeat = heartbeat;
  });
  const importStartedAt = Date.now();
  await page
    .locator('input[type="file"][accept*=".vtlesson"]')
    .setInputFiles({
      name: "voice-import.vtlesson",
      mimeType: "application/zip",
      buffer: await createLessonWithoutGeneratedAudio(),
    });
  await expect(page).toHaveURL(/\/lessons\/[^/?]+\?review=1/u, {
    timeout: 350_000,
  });
  await expect(page.getByRole("heading", { name: "Imported voice test" })).toBeVisible({
    timeout: 350_000,
  });
  const importPreparationDurationMs = Date.now() - importStartedAt;
  const heartbeat = await page.evaluate(() => {
    const value = (
      globalThis as typeof globalThis & {
        __voiceHeartbeat?: {
          intervalId: ReturnType<typeof globalThis.setInterval>;
          maxGapMs: number;
          ticks: number;
        };
      }
    ).__voiceHeartbeat;
    if (value) globalThis.clearInterval(value.intervalId);
    return value ?? null;
  });
  expect(heartbeat?.ticks).toBeGreaterThan(10);
  expect(heartbeat?.maxGapMs ?? Number.POSITIVE_INFINITY).toBeLessThan(1_000);
  expect(
    await readGeneratedAudioCount(page),
    browserDiagnostics.join("\n"),
  ).toBe(1);

  expect(
    await readGeneratedAudioCount(page),
    browserDiagnostics.join("\n"),
  ).toBe(1);
  expect(remoteModelRequests).toEqual([]);

  const playbackStartedAt = await page.evaluate(() => performance.now());
  await page
    .getByRole("button", { name: /Play current audio:/u })
    .first()
    .click();
  const playbackObservedAt = await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __vocabularyTrainerAudioStartedAt?: number;
              }
            ).__vocabularyTrainerAudioStartedAt ?? null,
        ),
      { timeout: 2_000 },
    )
    .not.toBeNull();
  void playbackObservedAt;
  const storedPlaybackDelayMs = await page.evaluate(
    (startedAt) =>
      ((
        globalThis as typeof globalThis & {
          __vocabularyTrainerAudioStartedAt?: number;
        }
      ).__vocabularyTrainerAudioStartedAt ?? Number.POSITIVE_INFINITY) -
      startedAt,
    playbackStartedAt,
  );
  expect(storedPlaybackDelayMs).toBeLessThan(1_000);
  testInfo.annotations.push({
    type: "voice-import-preparation-ms",
    description: String(importPreparationDurationMs),
  });
  testInfo.annotations.push({
    type: "stored-playback-delay-ms",
    description: storedPlaybackDelayMs.toFixed(1),
  });
  testInfo.annotations.push({
    type: "renderer-max-heartbeat-gap-ms",
    description: heartbeat!.maxGapMs.toFixed(1),
  });
  process.stdout.write(
    `[voice benchmark] import preparation=${importPreparationDurationMs}ms, renderer max gap=${heartbeat!.maxGapMs.toFixed(1)}ms, stored playback=${storedPlaybackDelayMs.toFixed(1)}ms\n`,
  );
});

async function createLessonWithoutGeneratedAudio(): Promise<Buffer> {
  const timestamp = "2026-09-25T12:00:00.000Z";
  const lessonId = "portable-voice-lesson";
  const cardId = "portable-voice-card";
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify({
      kind: "vocabulary-trainer-lesson",
      formatVersion: 1,
      exportedAt: timestamp,
      lesson: {
        id: lessonId,
        name: "Imported voice test",
        targetLanguage: "ja",
        translationLanguages: ["en"],
        activeTranslationLanguage: "en",
        visibleTranslationLanguages: ["en"],
        useImages: false,
        tts: {
          targetLocale: "ja-JP",
          speechRate: 1,
          fallbackProviderId: "kokoro-jp",
        },
        kind: "user",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      cardOrder: [cardId],
      cards: [
        {
          id: cardId,
          target: "試験",
          pronunciationText: "しけん",
          targetLanguage: "ja",
          translations: { en: "test" },
          image: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      generatedTtsAudio: [],
    }),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

async function readGeneratedAudioCount(
  page: import("@playwright/test").Page,
): Promise<number> {
  return page.evaluate(async () => {
    const request = indexedDB.open("vocabulary-trainer");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("generatedTtsAudio", "readonly");
    const count = await new Promise<number>((resolve, reject) => {
      const query = transaction.objectStore("generatedTtsAudio").count();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
    });
    database.close();
    return count;
  });
}
