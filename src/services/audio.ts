import type { Card, CustomAudio, Lesson } from "../domain";
import { generatedTtsAudioRepository } from "../data";
import type {
  GeneratedTtsAudioRepository,
  SaveGeneratedTtsAudioInput,
} from "../data/repositories";
import {
  areJapaneseVoiceAssetsInstalled,
  kokoroJapaneseProviderDescriptor,
  KOKORO_JAPANESE_DOWNLOAD_ESTIMATE_MB,
  KOKORO_JAPANESE_PROVIDER_ID,
  KOKORO_JAPANESE_VOICES,
  japaneseProviderId,
  japaneseVoiceIdFromProvider,
  synthesizeJapaneseFallback,
} from "./tts/providers/kokoro-japanese";

export {
  areJapaneseVoiceAssetsInstalled,
  KOKORO_JAPANESE_DOWNLOAD_ESTIMATE_MB,
  KOKORO_JAPANESE_PROVIDER_ID,
  KOKORO_JAPANESE_VOICES,
  japaneseProviderId,
};

export type AudioSource =
  | "custom"
  | "system-voice"
  | "application-fallback"
  | "unavailable";
export type AudioPlaybackStatus = "loading" | "playing" | "unavailable";

export interface AudioProviderDescriptor {
  id: string;
  name: string;
  supportedLanguageCodes: readonly string[];
  estimatedDownloadMb: number;
}

export const audioProviderDescriptors: readonly AudioProviderDescriptor[] = [
  kokoroJapaneseProviderDescriptor,
];

export interface AudioSourceResolution {
  source: AudioSource;
  voice?: SpeechSynthesisVoice;
  providerId?: string;
}

let currentAudio: HTMLAudioElement | null = null;
const synthesizedAudioMemoryCache = new Map<string, Blob>();
const synthesizedAudioPendingCache = new Map<string, Promise<Blob>>();
const generatedAudioPendingCache = new Map<
  string,
  Promise<{ blob: Blob; reused: boolean }>
>();
const TTS_CACHE_NAME = "vocabulary-trainer-tts-v1";

type GeneratedAudioStore = Pick<
  GeneratedTtsAudioRepository,
  "get" | "save"
>;

export interface GeneratedAudioProgress {
  completed: number;
  total: number;
  cardId: string;
  status: "pending" | "created" | "reused" | "failed";
}

export interface GeneratedAudioPreparationResult {
  total: number;
  created: number;
  reused: number;
  failedCardIds: string[];
  failureMessages: string[];
}

interface GeneratedAudioDependencies {
  store?: GeneratedAudioStore;
  synthesize?: (providerId: string, text: string) => Promise<Blob>;
}

export function isSpeechSynthesisSupported(): boolean {
  return (
    "speechSynthesis" in globalThis && "SpeechSynthesisUtterance" in globalThis
  );
}

export function voiceMatchesLocale(
  voice: Pick<SpeechSynthesisVoice, "lang">,
  locale: string,
): boolean {
  const language = locale.trim().toLowerCase().split("-")[0];
  const voiceLanguage = voice.lang.toLowerCase();
  return (
    Boolean(language) &&
    (voiceLanguage === language || voiceLanguage.startsWith(`${language}-`))
  );
}

export function getMatchingVoices(locale: string): SpeechSynthesisVoice[] {
  if (!isSpeechSynthesisSupported()) return [];
  return globalThis.speechSynthesis
    .getVoices()
    .filter((voice) => voiceMatchesLocale(voice, locale));
}

export function providerSupportsLocale(
  providerId: string | undefined,
  locale: string,
): boolean {
  const language = locale.toLowerCase().split("-")[0];
  return audioProviderDescriptors.some(
    (provider) =>
      (provider.id === providerId || providerId?.startsWith(`${provider.id}:`)) &&
      provider.supportedLanguageCodes.includes(language),
  );
}

export function isApplicationProviderSupported(
  providerId: string | undefined,
  locale: string,
): boolean {
  return (
    providerSupportsLocale(providerId, locale) &&
    typeof WebAssembly !== "undefined" &&
    "DecompressionStream" in globalThis
  );
}

export function resolveAudioSource(
  card: Pick<Card, "customAudio">,
  lesson: Pick<Lesson, "tts">,
  voices: readonly SpeechSynthesisVoice[],
): AudioSourceResolution {
  if (card.customAudio) return { source: "custom" };
  const matchingVoices = voices.filter((voice) =>
    voiceMatchesLocale(voice, lesson.tts.targetLocale),
  );
  const requestedVoice = matchingVoices.find(
    (voice) => voice.voiceURI === lesson.tts.voiceUri,
  );
  const voice = requestedVoice ?? matchingVoices[0];
  if (voice) return { source: "system-voice", voice };
  if (
    providerSupportsLocale(
      lesson.tts.fallbackProviderId,
      lesson.tts.targetLocale,
    )
  ) {
    return {
      source: "application-fallback",
      providerId: lesson.tts.fallbackProviderId,
    };
  }
  return { source: "unavailable" };
}

export function isAudioAvailableForLesson(lesson: Lesson): boolean {
  const voices = isSpeechSynthesisSupported()
    ? globalThis.speechSynthesis.getVoices()
    : [];
  return (
    voices.some((voice) =>
      voiceMatchesLocale(voice, lesson.tts.targetLocale),
    ) ||
    isApplicationProviderSupported(
      lesson.tts.fallbackProviderId,
      lesson.tts.targetLocale,
    )
  );
}

export async function playCardAudio(
  card: Card,
  lesson: Lesson,
  onStatus?: (status: AudioPlaybackStatus) => void,
): Promise<void> {
  stopAudio();
  const voices = isSpeechSynthesisSupported()
    ? globalThis.speechSynthesis.getVoices()
    : [];
  const resolution = resolveAudioSource(card, lesson, voices);

  if (resolution.source === "custom") {
    await playBlob(card.customAudio!.blob, 1, onStatus);
    return;
  }
  if (resolution.source === "system-voice") {
    globalThis.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      card.pronunciationText?.trim() || card.target,
    );
    utterance.lang = lesson.tts.targetLocale;
    utterance.rate = lesson.tts.speechRate;
    utterance.voice = resolution.voice!;
    onStatus?.("playing");
    globalThis.speechSynthesis.speak(utterance);
    return;
  }
  if (resolution.source === "application-fallback") {
    onStatus?.("loading");
    const generated = await getOrCreateCardGeneratedAudio(
      card,
      lesson,
      resolution.providerId!,
    );
    await playBlob(generated.blob, lesson.tts.speechRate, onStatus);
    return;
  }
  onStatus?.("unavailable");
  throw new Error("No matching voice is available for this language.");
}

export async function prepareGeneratedAudioForCards(
  cards: readonly Card[],
  lesson: Lesson,
  onProgress?: (progress: GeneratedAudioProgress) => void,
  dependencies: GeneratedAudioDependencies = {},
): Promise<GeneratedAudioPreparationResult> {
  const providerId = lesson.tts.fallbackProviderId;
  const supported = Boolean(
    providerId && providerSupportsLocale(providerId, lesson.tts.targetLocale),
  );
  const eligibleCards = supported
    ? cards.filter((card) => !card.customAudio)
    : [];
  const result: GeneratedAudioPreparationResult = {
    total: eligibleCards.length,
    created: 0,
    reused: 0,
    failedCardIds: [],
    failureMessages: [],
  };

  if (!providerId || !supported) {
    return result;
  }

  if (eligibleCards.length > 0) {
    onProgress?.({
      completed: 0,
      total: eligibleCards.length,
      cardId: eligibleCards[0]!.id,
      status: "pending",
    });
  }

  for (const [index, card] of eligibleCards.entries()) {
    let status: GeneratedAudioProgress["status"];
    try {
      const generated = await getOrCreateCardGeneratedAudio(
        card,
        lesson,
        providerId,
        dependencies,
      );
      status = generated.reused ? "reused" : "created";
      result[generated.reused ? "reused" : "created"] += 1;
    } catch (error) {
      console.warn(
        "Local Card audio preparation failed:",
        error instanceof Error ? error.message : "unknown provider error",
      );
      status = "failed";
      result.failedCardIds.push(card.id);
      result.failureMessages.push(
        error instanceof Error ? error.message : "unknown provider error",
      );
    }
    onProgress?.({
      completed: index + 1,
      total: eligibleCards.length,
      cardId: card.id,
      status,
    });
  }

  return result;
}

export function buildGeneratedTtsAudioCacheKey(
  cardId: string,
  providerId: string,
  voiceId: string,
  sourceText: string,
  locale = "",
): string {
  return JSON.stringify([
    cardId,
    providerId,
    voiceId,
    sourceText.normalize("NFC"),
    locale.toLowerCase(),
  ]);
}

async function getOrCreateCardGeneratedAudio(
  card: Card,
  lesson: Lesson,
  providerId: string,
  dependencies: GeneratedAudioDependencies = {},
): Promise<{ blob: Blob; reused: boolean }> {
  const sourceText = (card.pronunciationText?.trim() || card.target).normalize(
    "NFC",
  );
  const voiceId = getProviderVoiceId(providerId);
  const cacheKey = buildGeneratedTtsAudioCacheKey(
    card.id,
    providerId,
    voiceId,
    sourceText,
    lesson.tts.targetLocale,
  );
  const pending = generatedAudioPendingCache.get(cacheKey);
  if (pending) return pending;
  const preparation = loadOrCreateCardGeneratedAudio(
    card,
    lesson,
    providerId,
    voiceId,
    sourceText,
    cacheKey,
    dependencies,
  );
  generatedAudioPendingCache.set(cacheKey, preparation);
  try {
    return await preparation;
  } finally {
    generatedAudioPendingCache.delete(cacheKey);
  }
}

async function loadOrCreateCardGeneratedAudio(
  card: Card,
  lesson: Lesson,
  providerId: string,
  voiceId: string,
  sourceText: string,
  cacheKey: string,
  dependencies: GeneratedAudioDependencies,
): Promise<{ blob: Blob; reused: boolean }> {
  const store = dependencies.store ?? generatedTtsAudioRepository;
  const stored = await store.get(cacheKey);
  if (stored) return { blob: stored.blob, reused: true };

  const synthesize = dependencies.synthesize ?? synthesizeWithProvider;
  const blob = await synthesize(providerId, sourceText);
  const record: SaveGeneratedTtsAudioInput = {
    cacheKey,
    cardId: card.id,
    providerId,
    voiceId,
    sourceText,
    locale: lesson.tts.targetLocale,
    blob,
    mimeType: blob.type || "audio/wav",
  };
  await store.save(record);
  return { blob, reused: false };
}

function getProviderVoiceId(providerId: string): string {
  const japaneseVoice = japaneseVoiceIdFromProvider(providerId);
  if (japaneseVoice) return japaneseVoice;
  throw new Error("The configured speech provider is unavailable.");
}

async function synthesizeWithProvider(
  providerId: string,
  text: string,
): Promise<Blob> {
  const voiceId = japaneseVoiceIdFromProvider(providerId);
  if (!voiceId) {
    throw new Error("The configured speech provider is unavailable.");
  }
  return getOrCreateSynthesizedAudio(
    `${providerId}:${voiceId}:${text.normalize("NFC")}`,
    () => synthesizeJapaneseFallback(text, voiceId),
  );
}

export async function getOrCreateSynthesizedAudio(
  key: string,
  create: () => Promise<Blob>,
): Promise<Blob> {
  const memory = synthesizedAudioMemoryCache.get(key);
  if (memory) return memory;
  const pending = synthesizedAudioPendingCache.get(key);
  if (pending) return pending;
  const result = loadOrCreateSynthesizedAudio(key, create);
  synthesizedAudioPendingCache.set(key, result);
  try {
    return await result;
  } finally {
    synthesizedAudioPendingCache.delete(key);
  }
}

async function loadOrCreateSynthesizedAudio(
  key: string,
  create: () => Promise<Blob>,
): Promise<Blob> {
  const canUsePersistentCache =
    "caches" in globalThis && Boolean(globalThis.crypto?.subtle);
  const request = canUsePersistentCache ? await createCacheRequest(key) : null;
  if (request) {
    try {
      const cache = await globalThis.caches.open(TTS_CACHE_NAME);
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        synthesizedAudioMemoryCache.set(key, blob);
        return blob;
      }
    } catch {
      // Cache API is best-effort; synthesis remains available without it.
    }
  }
  const blob = await create();
  synthesizedAudioMemoryCache.set(key, blob);
  if (request) {
    try {
      const cache = await globalThis.caches.open(TTS_CACHE_NAME);
      await cache.put(request, new Response(blob));
    } catch {
      // Storage pressure must not turn successful synthesis into a failure.
    }
  }
  return blob;
}

async function createCacheRequest(key: string): Promise<Request> {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return new Request(`https://vocabulary-trainer.invalid/tts/${hash}`);
}

export function clearSynthesizedAudioMemoryCacheForTests(): void {
  synthesizedAudioMemoryCache.clear();
  synthesizedAudioPendingCache.clear();
  generatedAudioPendingCache.clear();
}

async function playBlob(
  blob: Blob,
  playbackRate: number,
  onStatus?: (status: AudioPlaybackStatus) => void,
): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.playbackRate = playbackRate;
  currentAudio = audio;
  const release = () => {
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
  };
  audio.addEventListener("ended", release, { once: true });
  audio.addEventListener("error", release, { once: true });
  onStatus?.("playing");
  try {
    await audio.play();
  } catch (error) {
    release();
    throw error;
  }
}

export function stopAudio(): void {
  globalThis.speechSynthesis?.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

export interface AudioRecorder {
  stop: () => Promise<CustomAudio>;
  cancel: () => void;
}

export async function startAudioRecording(): Promise<AudioRecorder> {
  if (
    !globalThis.navigator?.mediaDevices?.getUserMedia ||
    !globalThis.MediaRecorder
  ) {
    throw new Error("Audio recording is unavailable in this browser.");
  }
  const stream = await globalThis.navigator.mediaDevices.getUserMedia({
    audio: true,
  });
  const mimeType = chooseRecordingMimeType();
  const recorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined,
  );
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();
  return {
    stop: () =>
      new Promise<CustomAudio>((resolve, reject) => {
        recorder.addEventListener(
          "stop",
          () => {
            stream.getTracks().forEach((track) => track.stop());
            const blob = new Blob(chunks, {
              type: recorder.mimeType || "audio/webm",
            });
            if (blob.size > 0) resolve({ blob, mimeType: blob.type });
            else reject(new Error("The recording is empty."));
          },
          { once: true },
        );
        recorder.stop();
      }),
    cancel: () => {
      recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

export function audioFromFile(file: File): CustomAudio {
  return { blob: file, mimeType: file.type || "audio/webm" };
}

function chooseRecordingMimeType(): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}
