import { languageRegistry, normalizeLanguageCode } from "../config/languages";

export interface TranslationModelStage {
  modelId: string;
}

export interface TranslationCapability {
  id: string;
  sourceLanguage: string;
  targetLanguage: string;
  estimatedBytes: number;
  stages: readonly TranslationModelStage[];
}

export interface TranslationPackageStatus {
  packageId: string;
  installed: boolean;
  estimatedBytes: number;
  directory: string | null;
  supported: boolean;
}

export interface TranslationPackageProgress {
  packageId: string;
  downloadedBytes: number;
  totalBytes: number;
}

export const MULTILINGUAL_TRANSLATION_PACKAGE_ID = "multilingual-v1";
export const MULTILINGUAL_TRANSLATION_MODEL_ID = "Xenova/m2m100_418M";
export const MULTILINGUAL_TRANSLATION_PACKAGE_BYTES = 646_107_932;

const supportedLanguages = new Set(languageRegistry.map((language) => language.code));

export const translationCapabilities: readonly TranslationCapability[] = [
  {
    id: MULTILINGUAL_TRANSLATION_PACKAGE_ID,
    sourceLanguage: "mul",
    targetLanguage: "mul",
    estimatedBytes: MULTILINGUAL_TRANSLATION_PACKAGE_BYTES,
    stages: [{ modelId: MULTILINGUAL_TRANSLATION_MODEL_ID }],
  },
] as const;

interface TranslationPackageBridge {
  getTranslationPackageStatus?: (
    packageId: string,
  ) => Promise<TranslationPackageStatus>;
  installTranslationPackage?: (
    packageId: string,
  ) => Promise<TranslationPackageStatus>;
  deleteTranslationPackage?: (
    packageId: string,
  ) => Promise<TranslationPackageStatus>;
  onTranslationPackageProgress?: (
    listener: (progress: TranslationPackageProgress) => void,
  ) => () => void;
}

interface TranslationPackageWindow extends Window {
  vocabularyTrainerDesktop?: TranslationPackageBridge;
}

function bridge(): TranslationPackageBridge | undefined {
  return (globalThis.window as TranslationPackageWindow | undefined)
    ?.vocabularyTrainerDesktop;
}

export function findTranslationCapability(
  sourceLanguage: string,
  targetLanguage: string,
): TranslationCapability | null {
  const source = normalizeLanguageCode(sourceLanguage);
  const target = normalizeLanguageCode(targetLanguage);
  if (
    source === target ||
    !supportedLanguages.has(source) ||
    !supportedLanguages.has(target)
  ) {
    return null;
  }
  return {
    ...translationCapabilities[0],
    sourceLanguage: source,
    targetLanguage: target,
  };
}

export async function getTranslationPackageStatus(
  capability: TranslationCapability,
): Promise<TranslationPackageStatus> {
  const desktop = bridge();
  if (!desktop?.getTranslationPackageStatus) {
    return {
      packageId: capability.id,
      installed: false,
      estimatedBytes: capability.estimatedBytes,
      directory: null,
      supported: false,
    };
  }
  return desktop.getTranslationPackageStatus(capability.id);
}

export async function installTranslationPackage(
  capability: TranslationCapability,
): Promise<TranslationPackageStatus> {
  const desktop = bridge();
  if (!desktop?.installTranslationPackage) {
    throw new Error("Offline translation packages require the desktop application.");
  }
  return desktop.installTranslationPackage(capability.id);
}

export async function deleteTranslationPackage(
  capability: TranslationCapability,
): Promise<TranslationPackageStatus> {
  const desktop = bridge();
  if (!desktop?.deleteTranslationPackage) {
    throw new Error("Offline translation packages require the desktop application.");
  }
  return desktop.deleteTranslationPackage(capability.id);
}

export function onTranslationPackageProgress(
  listener: (progress: TranslationPackageProgress) => void,
): () => void {
  return bridge()?.onTranslationPackageProgress?.(listener) ?? (() => undefined);
}
