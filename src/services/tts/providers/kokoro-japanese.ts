export const KOKORO_JAPANESE_PROVIDER_ID = "kokoro-jp";
export const KOKORO_JAPANESE_VOICE_ID = "jf_alpha";
export const KOKORO_JAPANESE_DOWNLOAD_ESTIMATE_MB = 367;
export const KOKORO_JAPANESE_VOICES = [
  { id: "jf_alpha", name: "Alpha" },
  { id: "jf_gongitsune", name: "Gongitsune" },
  { id: "jf_nezumi", name: "Nezumi" },
  { id: "jf_tebukuro", name: "Tebukuro" },
  { id: "jm_kumo", name: "Kumo" },
] as const;

export const kokoroJapaneseProviderDescriptor = {
  id: KOKORO_JAPANESE_PROVIDER_ID,
  name: "Japanese offline voice (Kokoro + Open JTalk)",
  supportedLanguageCodes: ["ja"] as const,
  estimatedDownloadMb: KOKORO_JAPANESE_DOWNLOAD_ESTIMATE_MB,
};

interface KokoroEngine {
  speak(text: string, voice: string): Promise<{ toBlob(): Blob }>;
}

let enginePromise: Promise<KokoroEngine> | null = null;

export function japaneseProviderId(voiceId: string): string {
  return `${KOKORO_JAPANESE_PROVIDER_ID}:${voiceId}`;
}

export function japaneseVoiceIdFromProvider(providerId: string): string | null {
  if (providerId === KOKORO_JAPANESE_PROVIDER_ID) return KOKORO_JAPANESE_VOICE_ID;
  const prefix = `${KOKORO_JAPANESE_PROVIDER_ID}:`;
  if (!providerId.startsWith(prefix)) return null;
  const voiceId = providerId.slice(prefix.length);
  return KOKORO_JAPANESE_VOICES.some((voice) => voice.id === voiceId)
    ? voiceId
    : null;
}

export async function synthesizeJapaneseFallback(
  text: string,
  voiceId = KOKORO_JAPANESE_VOICE_ID,
): Promise<Blob> {
  if (!enginePromise) {
    enginePromise = loadEngine().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  const engine = await enginePromise;
  const audio = await engine.speak(text, voiceId);
  return audio.toBlob();
}

async function loadEngine(): Promise<KokoroEngine> {
  const [{ env: transformersEnvironment }, { env: kokoroEnvironment }] =
    await Promise.all([
      import("@huggingface/transformers"),
      import("kokoro-js"),
    ]);
  transformersEnvironment.allowLocalModels = true;
  transformersEnvironment.allowRemoteModels = false;
  transformersEnvironment.localModelPath = "/voice-models/models/";
  // Keep model initialization and inference away from the renderer thread.
  // Without ONNX Runtime's proxy worker, preparing a Lesson's recordings can
  // make the entire Electron window unresponsive for several seconds at once.
  if (transformersEnvironment.backends.onnx.wasm) {
    transformersEnvironment.backends.onnx.wasm.proxy = true;
    transformersEnvironment.backends.onnx.wasm.numThreads = Math.max(
      1,
      Math.min(2, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1),
    );
  }
  kokoroEnvironment.wasmPaths = "/voice-models/onnxruntime/";
  installLocalVoiceRedirect();
  const { KokoroJP } = await import("kokoro-js-jp");
  return KokoroJP.load({
    modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
    dtype: "q4",
    device: "wasm",
    japanese: {
      assetsUrl: "/voice-models/kokoro-js-jp",
      dicArchiveUrl:
        "/voice-models/kokoro-js-jp/open_jtalk_dic_utf_8-1.11.tar.bin",
    },
  }) as Promise<KokoroEngine>;
}

let localVoiceRedirectInstalled = false;

function installLocalVoiceRedirect(): void {
  if (localVoiceRedirectInstalled) return;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const match = url.match(
      /https:\/\/huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/main\/voices\/([^/?#]+\.bin)/u,
    );
    if (match?.[1]) {
      return originalFetch(
        `/voice-models/models/onnx-community/Kokoro-82M-v1.0-ONNX/voices/${match[1]}`,
        init,
      );
    }
    return originalFetch(input, init);
  };
  localVoiceRedirectInstalled = true;
}

export async function areJapaneseVoiceAssetsInstalled(): Promise<boolean> {
  try {
    const response = await fetch("/voice-models/manifest.json", {
      cache: "no-store",
    });
    if (!response.ok) return false;
    const manifest = (await response.json()) as { provider?: unknown };
    return manifest.provider === "kokoro-js-jp";
  } catch {
    return false;
  }
}
