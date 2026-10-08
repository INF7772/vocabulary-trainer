import type { TranslationCapability } from "./translation-packages";
import { kanaStudyReading } from "./kana-study-reading";

export interface TranslationProgress {
  completed: number;
  total: number;
}

export interface TranslationProvider {
  translate(
    texts: readonly string[],
    capability: TranslationCapability,
    onProgress?: (progress: TranslationProgress) => void,
    onModelReady?: () => void,
  ): Promise<string[]>;
  clear(capabilityId?: string): Promise<void>;
}

interface TranslationOutput {
  translation_text: string;
}

export class TranslationTimeoutError extends Error {
  constructor() {
    super("Local translation timed out.");
    this.name = "TranslationTimeoutError";
  }
}

type TranslationPipeline = (
  input: string | string[],
  options?: {
    src_lang?: string;
    tgt_lang?: string;
    max_new_tokens?: number;
    num_beams?: number;
    no_repeat_ngram_size?: number;
    repetition_penalty?: number;
    stopping_criteria?: unknown;
  },
) => Promise<TranslationOutput | TranslationOutput[] | TranslationOutput[][]>;

export type TranslationPipelineLoader = (
  capabilityId: string,
  modelId: string,
) => Promise<TranslationPipeline>;

const BATCH_SIZE = 4;
const MODEL_LOAD_TIMEOUT_MS = 90_000;
const TRANSLATION_BATCH_TIMEOUT_MS = 45_000;

interface LocalTranslationProviderOptions {
  modelLoadTimeoutMs?: number;
  batchTimeoutMs?: number;
}

export function createLocalTranslationProvider(
  pipelineLoader: TranslationPipelineLoader,
  options: LocalTranslationProviderOptions = {},
): TranslationProvider {
  const pipelinePromises = new Map<string, Promise<TranslationPipeline>>();
  const modelLoadTimeoutMs = options.modelLoadTimeoutMs ?? MODEL_LOAD_TIMEOUT_MS;
  const batchTimeoutMs = options.batchTimeoutMs ?? TRANSLATION_BATCH_TIMEOUT_MS;

  async function loadPipeline(capabilityId: string, modelId: string) {
    const key = `${capabilityId}:${modelId}`;
    let pending = pipelinePromises.get(key);
    if (!pending) {
      pending = pipelineLoader(capabilityId, modelId).catch((error) => {
        pipelinePromises.delete(key);
        throw error;
      });
      pipelinePromises.set(key, pending);
    }
    return pending;
  }

  return {
    async translate(texts, capability, onProgress, onModelReady) {
      const readings = texts.map((text) =>
        kanaStudyReading(text, capability.sourceLanguage));
      const modelIndexes = readings.flatMap((reading, index) =>
        reading === null ? [index] : []);
      const readingCount = readings.length - modelIndexes.length;
      if (modelIndexes.length === 0) {
        onModelReady?.();
        onProgress?.({ completed: texts.length, total: texts.length });
        return readings as string[];
      }

      let current = modelIndexes.map((index) => texts[index]!);
      for (const [stageIndex, stage] of capability.stages.entries()) {
        const translator = await withTranslationTimeout(
          loadPipeline(capability.id, stage.modelId),
          modelLoadTimeoutMs,
        );
        if (stageIndex === 0) onModelReady?.();
        const next: string[] = [];
        for (let start = 0; start < current.length; start += BATCH_SIZE) {
          const chunk = current.slice(start, start + BATCH_SIZE);
          const maxNewTokens = Math.max(
            8,
            Math.min(
              32,
              Math.max(...chunk.map((text) => [...text].length)) * 2 + 4,
            ),
          );
          const output = await withTranslationTimeout(
            translator(chunk, {
              src_lang: capability.sourceLanguage,
              tgt_lang: capability.targetLanguage,
              max_new_tokens: maxNewTokens,
              no_repeat_ngram_size: 2,
              num_beams: 1,
              repetition_penalty: 1.15,
            }),
            batchTimeoutMs,
          );
          const translated = flattenTranslations(output).map((value) =>
            sanitizeTranslationOutput(value, capability.targetLanguage));
          if (translated.some((value) => !value)) {
            throw new Error("The local translation model returned unusable text.");
          }
          if (translated.length !== chunk.length) {
            throw new Error("The local translation model returned an unexpected result count.");
          }
          next.push(...translated);
          if (stageIndex === capability.stages.length - 1) {
            onProgress?.({
              completed: readingCount + Math.min(start + chunk.length, current.length),
              total: texts.length,
            });
          }
        }
        current = next;
      }
      const results = readings as Array<string | null>;
      modelIndexes.forEach((originalIndex, resultIndex) => {
        results[originalIndex] = current[resultIndex] ?? "";
      });
      return results as string[];
    },
    async clear(capabilityId) {
      if (!capabilityId) pipelinePromises.clear();
      else {
        for (const key of pipelinePromises.keys()) {
          if (key.startsWith(`${capabilityId}:`)) pipelinePromises.delete(key);
        }
      }
    },
  };
}

const TARGET_LETTER_PATTERNS: Readonly<Record<string, RegExp>> = {
  de: /[\p{Script=Latin}]/u,
  en: /[\p{Script=Latin}]/u,
  es: /[\p{Script=Latin}]/u,
  fr: /[\p{Script=Latin}]/u,
  it: /[\p{Script=Latin}]/u,
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}]/u,
  ko: /[\p{Script=Hangul}\p{Script=Han}\p{Script=Latin}]/u,
  ru: /[\p{Script=Cyrillic}\p{Script=Latin}]/u,
  uk: /[\p{Script=Cyrillic}\p{Script=Latin}]/u,
  zh: /[\p{Script=Han}\p{Script=Latin}]/u,
};

export function sanitizeTranslationOutput(
  value: string,
  targetLanguage: string,
): string {
  const allowedLetters = TARGET_LETTER_PATTERNS[targetLanguage];
  let cleaned = value.normalize("NFC").trim();
  if (allowedLetters) {
    let accepted = "";
    for (const character of cleaned) {
      if (/\p{L}/u.test(character) && !allowedLetters.test(character)) break;
      accepted += character;
    }
    cleaned = accepted.trim().replace(/[\s,;:–—-]+$/u, "");
  }

  const tokens = cleaned.split(/\s+/u).filter(Boolean);
  const deduplicated: string[] = [];
  for (const token of tokens) {
    const normalized = token.toLocaleLowerCase(targetLanguage);
    const previous = deduplicated.at(-1)?.toLocaleLowerCase(targetLanguage);
    if (normalized !== previous) deduplicated.push(token);
  }
  return deduplicated.join(" ").slice(0, 200).trim();
}

function withTranslationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new TranslationTimeoutError()),
      timeoutMs,
    );
    operation.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function flattenTranslations(
  output: TranslationOutput | TranslationOutput[] | TranslationOutput[][],
): string[] {
  const flattened = (Array.isArray(output) ? output.flat() : [output]) as TranslationOutput[];
  return flattened.map((item) => {
    if (!item?.translation_text) {
      throw new Error("The local translation model returned no text.");
    }
    return item.translation_text;
  });
}

async function createTransformersPipeline(
  capabilityId: string,
  modelId: string,
): Promise<TranslationPipeline> {
  const {
    env,
    InterruptableStoppingCriteria,
    pipeline,
    StoppingCriteriaList,
  } = await import("@huggingface/transformers");
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = `/translation-models/${capabilityId}/models/`;
  // ONNX Runtime otherwise initializes and executes WASM on the renderer's
  // main thread. The multilingual model is large enough to make the whole
  // Electron window appear hung during its first load and while decoding.
  // Its supported proxy mode moves that work to a dedicated worker while the
  // UI, progress indicator, and window controls remain responsive.
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.proxy = true;
    env.backends.onnx.wasm.numThreads = Math.max(
      1,
      Math.min(2, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1),
    );
  }
  const translator = (await pipeline("translation", modelId, {
    device: "wasm",
    dtype: "q8",
  })) as unknown as TranslationPipeline;
  return async (input, options = {}) => {
    const interruption = new InterruptableStoppingCriteria();
    const stoppingCriteria = new StoppingCriteriaList();
    stoppingCriteria.push(interruption);
    const timeout = globalThis.setTimeout(
      () => interruption.interrupt(),
      TRANSLATION_BATCH_TIMEOUT_MS - 250,
    );
    try {
      const output = await translator(input, {
        ...options,
        stopping_criteria: stoppingCriteria,
      });
      if (interruption.interrupted) throw new TranslationTimeoutError();
      return output;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  };
}

export const localTranslationProvider = createLocalTranslationProvider(
  createTransformersPipeline,
);
