let enginePromise: Promise<{
  convert(text: string, options: { to: "hiragana"; mode: "normal" }): Promise<string>;
}> | null = null;

async function loadEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import("kuroshiro"),
      import("kuroshiro-analyzer-kuromoji"),
    ]).then(async ([kuroshiroModule, analyzerModule]) => {
      const Kuroshiro = unwrapDefault(kuroshiroModule.default);
      const KuromojiAnalyzer = unwrapDefault(analyzerModule.default);
      const engine = new Kuroshiro();
      await withDictionaryRequests(async () => {
        await engine.init(new KuromojiAnalyzer({ dictPath: "/kuromoji-dict/" }));
      });
      return engine;
    }).catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

async function withDictionaryRequests(operation: () => Promise<void>): Promise<void> {
  const NativeXMLHttpRequest = globalThis.XMLHttpRequest;
  class DictionaryXMLHttpRequest extends NativeXMLHttpRequest {
    override open(
      method: string,
      url: string | URL,
      async = true,
      username?: string | null,
      password?: string | null,
    ): void {
      const requested = String(url);
      const localUrl = requested.startsWith("/kuromoji-dict/") && requested.endsWith(".gz")
        ? `${requested}.bin`
        : requested;
      super.open(method, localUrl, async, username, password);
    }
  }
  globalThis.XMLHttpRequest = DictionaryXMLHttpRequest;
  try {
    await operation();
  } finally {
    globalThis.XMLHttpRequest = NativeXMLHttpRequest;
  }
}

function unwrapDefault<T>(value: T | { default: T }): T {
  if (typeof value === "object" && value !== null && "default" in value) {
    return value.default;
  }
  return value as T;
}

export async function generateJapaneseReading(text: string): Promise<string> {
  const normalized = text.trim();
  if (!normalized) return "";
  const engine = await loadEngine();
  return engine.convert(normalized, { to: "hiragana", mode: "normal" });
}
