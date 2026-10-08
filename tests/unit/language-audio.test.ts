import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findLanguage,
  isPlausibleLanguageTag,
  languageRegistry,
  normalizeLanguageCode,
  preferredTtsLocale,
} from "../../src/config/languages";
import type { Card, GeneratedTtsAudio, Lesson } from "../../src/domain";
import type { SaveGeneratedTtsAudioInput } from "../../src/data/repositories";
import { interfaceLanguageForLocale } from "../../src/data/repositories/settings-repository";
import {
  KOKORO_JAPANESE_PROVIDER_ID,
  clearSynthesizedAudioMemoryCacheForTests,
  getOrCreateSynthesizedAudio,
  japaneseProviderId,
  prepareGeneratedAudioForCards,
  providerSupportsLocale,
  resolveAudioSource,
  voiceMatchesLocale,
} from "../../src/services/audio";
import { japaneseVoiceIdFromProvider } from "../../src/services/tts/providers/kokoro-japanese";
import { shouldShowJapaneseReading } from "../../src/utils/japanese-readings";

beforeEach(() => {
  clearSynthesizedAudioMemoryCacheForTests();
});

describe("language registry", () => {
  it("contains every required built-in language and preferred TTS locales", () => {
    expect(languageRegistry.map((language) => language.code)).toEqual(
      expect.arrayContaining([
        "ja",
        "de",
        "en",
        "es",
        "fr",
        "it",
        "ko",
        "zh",
        "uk",
        "ru",
      ]),
    );
    expect(preferredTtsLocale("de")).toBe("de-DE");
    expect(findLanguage("jpn")?.code).toBe("ja");
  });

  it("normalizes aliases while accepting extensible BCP-47 tags", () => {
    expect(normalizeLanguageCode("GER")).toBe("de");
    expect(isPlausibleLanguageTag("pt-BR")).toBe(true);
    expect(isPlausibleLanguageTag("not a language")).toBe(false);
  });
});

describe("interface language defaults", () => {
  it("uses a supported system locale and falls back to English", () => {
    expect(interfaceLanguageForLocale("de-DE")).toBe("de");
    expect(interfaceLanguageForLocale("ru_RU")).toBe("ru");
    expect(interfaceLanguageForLocale("ja-JP")).toBe("ja");
    expect(interfaceLanguageForLocale("pt-BR")).toBe("en");
    expect(interfaceLanguageForLocale(undefined)).toBe("en");
  });
});

describe("audio source selection", () => {
  const lesson = createLesson();

  it("uses custom audio before system and application voices", () => {
    const card = createCard({
      blob: new Blob(["audio"]),
      mimeType: "audio/webm",
    });
    expect(
      resolveAudioSource(card, lesson, [voice("Japanese", "ja-JP")]).source,
    ).toBe("custom");
  });

  it("uses a matching system voice before the configured fallback", () => {
    const result = resolveAudioSource(createCard(), lesson, [
      voice("Japanese", "ja-JP"),
    ]);
    expect(result.source).toBe("system-voice");
    expect(result.voice?.voiceURI).toBe("Japanese");
  });

  it("never substitutes a wrong-language system default and uses the fallback", () => {
    const result = resolveAudioSource(createCard(), lesson, [
      voice("English", "en-US"),
    ]);
    expect(result).toMatchObject({
      source: "application-fallback",
      providerId: KOKORO_JAPANESE_PROVIDER_ID,
    });
    expect(voiceMatchesLocale(voice("English", "en-US"), "ja-JP")).toBe(false);
  });

  it("reports unavailable when neither a matching voice nor provider exists", () => {
    const german = {
      ...lesson,
      targetLanguage: "de",
      tts: { targetLocale: "de-DE", speechRate: 1 },
    };
    expect(
      resolveAudioSource(createCard(), german, [voice("English", "en-US")])
        .source,
    ).toBe("unavailable");
  });

  it("supports named Japanese application voices and the legacy provider id", () => {
    const namedProvider = japaneseProviderId("jf_nezumi");

    expect(providerSupportsLocale(namedProvider, "ja-JP")).toBe(true);
    expect(providerSupportsLocale(namedProvider, "de-DE")).toBe(false);
    expect(japaneseVoiceIdFromProvider(namedProvider)).toBe("jf_nezumi");
    expect(japaneseVoiceIdFromProvider(KOKORO_JAPANESE_PROVIDER_ID)).toBe(
      "jf_alpha",
    );
  });
});

describe("Japanese readings", () => {
  it("shows only saved readings for Japanese text containing kanji", () => {
    expect(shouldShowJapaneseReading(true, "ja", "今日")).toBe(true);
    expect(shouldShowJapaneseReading(false, "ja", "今日")).toBe(false);
    expect(shouldShowJapaneseReading(true, "de", "今日")).toBe(false);
    expect(shouldShowJapaneseReading(true, "ja", "きょう")).toBe(false);
    expect(shouldShowJapaneseReading(true, "ja", "今日")).toBe(true);
  });
});

describe("synthesized audio cache", () => {
  it("synthesizes an identical phrase only once in the current session", async () => {
    const create = vi.fn(async () => new Blob(["audio"], { type: "audio/wav" }));

    const first = await getOrCreateSynthesizedAudio("provider:voice:слово", create);
    const second = await getOrCreateSynthesizedAudio("provider:voice:слово", create);

    expect(second).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("coalesces simultaneous requests for the same phrase", async () => {
    let finish!: (blob: Blob) => void;
    const create = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );

    const first = getOrCreateSynthesizedAudio("provider:voice:parallel", create);
    const second = getOrCreateSynthesizedAudio("provider:voice:parallel", create);
    finish(new Blob(["audio"]));

    await expect(first).resolves.toBeInstanceOf(Blob);
    await expect(second).resolves.toBeInstanceOf(Blob);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("generated Card audio preparation", () => {
  it("creates local audio once per Card and reuses the stored result", async () => {
    const records = new Map<string, GeneratedTtsAudio>();
    const store = {
      get: vi.fn(async (key: string) => records.get(key)),
      save: vi.fn(async (input: SaveGeneratedTtsAudioInput) => {
        const record: GeneratedTtsAudio = {
          ...input,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        records.set(input.cacheKey, record);
        return record;
      }),
    };
    const synthesize = vi.fn(async (providerId: string, text: string) => {
      void providerId;
      void text;
      return new Blob(["generated"], { type: "audio/wav" });
    });
    const cards = [
      createCard(undefined, "card-1", "猫"),
      createCard(undefined, "card-2", "水"),
    ];

    await expect(
      prepareGeneratedAudioForCards(cards, createLesson(), undefined, {
        store,
        synthesize,
      }),
    ).resolves.toMatchObject({ total: 2, created: 2, reused: 0 });
    await expect(
      prepareGeneratedAudioForCards(cards, createLesson(), undefined, {
        store,
        synthesize,
      }),
    ).resolves.toMatchObject({ total: 2, created: 0, reused: 2 });
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it("continues when one Card cannot be synthesized", async () => {
    const store = {
      get: vi.fn(async () => undefined),
      save: vi.fn(async (input: SaveGeneratedTtsAudioInput) => ({
        ...input,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
    };
    const synthesize = vi
      .fn(async (providerId: string, text: string) => {
        void providerId;
        void text;
        return new Blob();
      })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Blob(["generated"]));
    const progress = vi.fn();

    const result = await prepareGeneratedAudioForCards(
      [
        createCard(undefined, "card-1", "猫"),
        createCard(undefined, "card-2", "水"),
      ],
      createLesson(),
      progress,
      { store, synthesize },
    );

    expect(result).toMatchObject({
      total: 2,
      created: 1,
      failedCardIds: ["card-1"],
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ completed: 2, total: 2 }),
    );
  });
});

function createLesson(): Lesson {
  return {
    id: "lesson",
    name: "Japanese example",
    targetLanguage: "ja",
    translationLanguages: ["en"],
    activeTranslationLanguage: "en",
    visibleTranslationLanguages: ["en"],
    useImages: false,
    tts: {
      targetLocale: "ja-JP",
      speechRate: 1,
      fallbackProviderId: KOKORO_JAPANESE_PROVIDER_ID,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createCard(
  customAudio?: Card["customAudio"],
  id = "card",
  target = "猫",
): Card {
  return {
    id,
    target,
    targetLanguage: "ja",
    translations: { en: "cat" },
    image: null,
    customAudio,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function voice(voiceURI: string, lang: string): SpeechSynthesisVoice {
  return { voiceURI, name: voiceURI, lang, localService: true, default: false };
}
