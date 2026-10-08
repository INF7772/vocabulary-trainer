import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteTranslationPackage,
  findTranslationCapability,
  getTranslationPackageStatus,
  installTranslationPackage,
  onTranslationPackageProgress,
  translationCapabilities,
  type TranslationPackageProgress,
} from "../../src/services/translation-packages";
import {
  createLocalTranslationProvider,
  sanitizeTranslationOutput,
  TranslationTimeoutError,
  type TranslationPipelineLoader,
} from "../../src/services/translator";
import {
  canUseKanaStudyReadings,
  createKanaGlyphOptions,
  fillMissingKanaStudyTranslations,
  japaneseRomajiReading,
  kanaStudyReading,
} from "../../src/services/kana-study-reading";

afterEach(() => {
  Reflect.deleteProperty(window, "vocabularyTrainerDesktop");
});

describe("translation capability registry", () => {
  it.each([
    ["ja-JP", "ru", "ja", "ru"],
    ["de-DE", "ja-JP", "de", "ja"],
    ["uk-UA", "zh-CN", "uk", "zh"],
    ["en-US", "de-DE", "en", "de"],
  ])("resolves %s to %s through the multilingual package", (source, target, expectedSource, expectedTarget) => {
    const capability = findTranslationCapability(source, target);
    expect(capability).toMatchObject({
      id: "multilingual-v1",
      sourceLanguage: expectedSource,
      targetLanguage: expectedTarget,
    });
    expect(capability?.stages).toHaveLength(1);
  });

  it("rejects identical or unofficial languages", () => {
    expect(findTranslationCapability("ja", "ja")).toBeNull();
    expect(findTranslationCapability("ja", "eo")).toBeNull();
  });
});

describe("local translation provider", () => {
  it("batches input, sends language options, and reuses the model", async () => {
    const pipeline = vi.fn(async (input: string | string[]) =>
      (Array.isArray(input) ? input : [input]).map((text) => ({
        translation_text: `${text}-translated`,
      })),
    );
    const loader = vi.fn(async () => pipeline) as TranslationPipelineLoader;
    const provider = createLocalTranslationProvider(loader);
    const capability = findTranslationCapability("ja", "ru")!;
    const progress = vi.fn();
    const words = Array.from({ length: 10 }, (_, index) => `word-${index}`);

    await expect(provider.translate(words, capability, progress)).resolves.toEqual(
      words.map((word) => `${word}-translated`),
    );
    await provider.translate(["again"], findTranslationCapability("de", "en")!);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(pipeline).toHaveBeenNthCalledWith(1, words.slice(0, 4), {
      max_new_tokens: 16,
      no_repeat_ngram_size: 2,
      num_beams: 1,
      repetition_penalty: 1.15,
      src_lang: "ja",
      tgt_lang: "ru",
    });
    expect(pipeline).toHaveBeenLastCalledWith(["again"], {
      max_new_tokens: 14,
      no_repeat_ngram_size: 2,
      num_beams: 1,
      repetition_penalty: 1.15,
      src_lang: "de",
      tgt_lang: "en",
    });
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { completed: 4, total: 10 },
      { completed: 8, total: 10 },
      { completed: 10, total: 10 },
    ]);
  });

  it("reloads the model after package deletion", async () => {
    const loader = vi.fn(async () => async (input: string | string[]) =>
      (Array.isArray(input) ? input : [input]).map(() => ({
        translation_text: "перевод",
      }))) as TranslationPipelineLoader;
    const provider = createLocalTranslationProvider(loader);
    const capability = findTranslationCapability("ja", "ru")!;
    await provider.translate(["本"], capability);
    await provider.clear(capability.id);
    await provider.translate(["水"], capability);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("returns kana readings immediately without loading the translation model", async () => {
    const loader = vi.fn() as TranslationPipelineLoader;
    const provider = createLocalTranslationProvider(loader);
    const progress = vi.fn();
    const modelReady = vi.fn();

    await expect(provider.translate(
      ["あ", "し", "つ", "きゃ", "っ"],
      findTranslationCapability("ja", "ru")!,
      progress,
      modelReady,
    )).resolves.toEqual(["a", "shi", "tsu", "kya", "tsu"]);

    expect(loader).not.toHaveBeenCalled();
    expect(modelReady).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith({ completed: 5, total: 5 });
  });

  it("translates only semantic entries in a mixed kana and word list", async () => {
    const pipeline = vi.fn(async (input: string | string[]) =>
      (Array.isArray(input) ? input : [input]).map(() => ({
        translation_text: "book",
      })));
    const loader = vi.fn(async () => pipeline) as TranslationPipelineLoader;
    const provider = createLocalTranslationProvider(loader);

    await expect(provider.translate(
      ["あ", "本"],
      findTranslationCapability("ja", "en")!,
    )).resolves.toEqual(["a", "book"]);
    expect(pipeline).toHaveBeenCalledWith(["本"], expect.objectContaining({
      src_lang: "ja",
      tgt_lang: "en",
    }));
  });

  it("stops a translation batch that does not return", async () => {
    const loader = vi.fn(async () => () => new Promise(() => undefined)) as
      TranslationPipelineLoader;
    const provider = createLocalTranslationProvider(loader, {
      batchTimeoutMs: 5,
    });

    await expect(provider.translate(
      ["misspelled-input"],
      findTranslationCapability("en", "de")!,
    )).rejects.toBeInstanceOf(TranslationTimeoutError);
  });
});

describe("kana study readings", () => {
  it("uses one Hepburn answer for ambiguous ji and zu kana spellings", () => {
    expect(japaneseRomajiReading("\u3058", "ja")).toBe("ji");
    expect(japaneseRomajiReading("\u3062", "ja")).toBe("ji");
    expect(japaneseRomajiReading("\u305a", "ja")).toBe("zu");
    expect(japaneseRomajiReading("\u3065", "ja")).toBe("zu");
    expect(japaneseRomajiReading("\u3064\u3065\u304f", "ja")).toBe("tsuzuku");
    expect(japaneseRomajiReading("\u7d9a\u304f", "ja")).toBeNull();
  });

  it("builds four same-script glyph choices without requiring an IME", () => {
    const options = createKanaGlyphOptions(
      "\u3042",
      "ja",
      ["\u3042", "\u3044", "\u3046", "\u3048"],
    );

    expect(options).toHaveLength(4);
    expect(new Set(options).size).toBe(4);
    expect(options).toContain("\u3042");
    expect(options.every((value) => /^[\p{Script=Hiragana}]+$/u.test(value))).toBe(true);
    expect(createKanaGlyphOptions("\u672c", "ja", ["\u3042"])).toEqual([]);
  });

  it("recognizes kana-only Japanese study entries", () => {
    expect(kanaStudyReading("  が  ", "ja")).toBe("ga");
    expect(kanaStudyReading("今日", "ja")).toBeNull();
    expect(kanaStudyReading("こんにちは", "ja")).toBeNull();
    expect(kanaStudyReading("あい", "ja")).toBeNull();
    expect(kanaStudyReading("あa", "ja")).toBeNull();
    expect(kanaStudyReading("あ", "de")).toBeNull();
    expect(canUseKanaStudyReadings(["あ", "イ"], "ja")).toBe(true);
    expect(canUseKanaStudyReadings(["あ", "本"], "ja")).toBe(false);
  });

  it("repairs missing Lesson translations without replacing manual values", () => {
    const original = { ru: "ручное значение" };
    expect(fillMissingKanaStudyTranslations(
      "し",
      "ja",
      ["ru", "en"],
      original,
    )).toEqual({ ru: "ручное значение", en: "shi" });
    expect(fillMissingKanaStudyTranslations(
      "こんにちは",
      "ja",
      ["ru"],
      {},
    )).toEqual({});
  });
});

describe("translation output cleanup", () => {
  it("removes foreign-script hallucinations and consecutive repetition", () => {
    expect(sanitizeTranslationOutput(
      "комната ห้อง ห้อง ห้อง",
      "ru",
    )).toBe("комната");
    expect(sanitizeTranslationOutput("Японский ญี่ปุ่น", "ru")).toBe("Японский");
    expect(sanitizeTranslationOutput("room room room", "en")).toBe("room");
    expect(sanitizeTranslationOutput("中国語", "zh")).toBe("中国語");
  });
});

describe("desktop translation package lifecycle", () => {
  it("reports progress and supports install, lookup, delete, and re-download", async () => {
    const installed = new Set<string>();
    let progressListener: ((value: TranslationPackageProgress) => void) | null = null;
    const capability = translationCapabilities[0]!;
    const status = (packageId: string) => ({
      packageId,
      installed: installed.has(packageId),
      estimatedBytes: capability.estimatedBytes,
      directory: `C:\\portable\\translation-models\\${packageId}`,
      supported: true,
    });
    const bridge = {
      getTranslationPackageStatus: vi.fn(async (packageId: string) => status(packageId)),
      installTranslationPackage: vi.fn(async (packageId: string) => {
        progressListener?.({
          packageId,
          downloadedBytes: capability.estimatedBytes,
          totalBytes: capability.estimatedBytes,
        });
        installed.add(packageId);
        return status(packageId);
      }),
      deleteTranslationPackage: vi.fn(async (packageId: string) => {
        installed.delete(packageId);
        return status(packageId);
      }),
      onTranslationPackageProgress: vi.fn(
        (listener: (value: TranslationPackageProgress) => void) => {
          progressListener = listener;
          return () => { progressListener = null; };
        },
      ),
    };
    Object.defineProperty(window, "vocabularyTrainerDesktop", {
      configurable: true,
      value: bridge,
    });
    const progress = vi.fn();
    const unsubscribe = onTranslationPackageProgress(progress);

    expect(await getTranslationPackageStatus(capability)).toMatchObject({ installed: false });
    expect(await installTranslationPackage(capability)).toMatchObject({ installed: true });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      downloadedBytes: capability.estimatedBytes,
    }));
    expect(await deleteTranslationPackage(capability)).toMatchObject({ installed: false });
    expect(await installTranslationPackage(capability)).toMatchObject({ installed: true });
    unsubscribe();
  });

  it("fails clearly outside the desktop package bridge", async () => {
    const capability = translationCapabilities[0]!;
    await expect(installTranslationPackage(capability)).rejects.toThrow("desktop application");
    await expect(getTranslationPackageStatus(capability)).resolves.toMatchObject({
      installed: false,
      supported: false,
    });
  });
});
