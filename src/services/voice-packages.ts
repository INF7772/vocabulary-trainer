import { KOKORO_JAPANESE_PROVIDER_ID } from "./tts/providers/kokoro-japanese";

export interface VoicePackageStatus {
  packageId: string;
  installed: boolean;
  estimatedBytes: number;
  directory?: string;
}

export interface VoicePackageProgress {
  packageId: string;
  downloadedBytes: number;
  totalBytes: number;
}

interface VoicePackageBridge {
  getVoicePackageStatus: (packageId: string) => Promise<VoicePackageStatus>;
  installVoicePackage: (packageId: string) => Promise<VoicePackageStatus>;
  deleteVoicePackage: (packageId: string) => Promise<VoicePackageStatus>;
  onVoicePackageProgress: (
    listener: (progress: VoicePackageProgress) => void,
  ) => () => void;
  openSystemVoiceSettings?: () => Promise<boolean>;
}

interface VoicePackageWindow extends Window {
  vocabularyTrainerDesktop?: VoicePackageBridge;
}

export function supportsDownloadableVoicePackages(): boolean {
  return Boolean(
    (globalThis.window as VoicePackageWindow | undefined)
      ?.vocabularyTrainerDesktop?.installVoicePackage,
  );
}

export function supportsSystemVoiceSettings(): boolean {
  return Boolean(
    (globalThis.window as VoicePackageWindow | undefined)
      ?.vocabularyTrainerDesktop?.openSystemVoiceSettings,
  );
}

export async function openSystemVoiceSettings(): Promise<void> {
  const open = (globalThis.window as VoicePackageWindow | undefined)
    ?.vocabularyTrainerDesktop?.openSystemVoiceSettings;
  if (open) await open();
}

export async function getJapaneseVoicePackageStatus(): Promise<VoicePackageStatus> {
  const bridge = (globalThis.window as VoicePackageWindow | undefined)
    ?.vocabularyTrainerDesktop;
  if (!bridge) {
    return {
      packageId: KOKORO_JAPANESE_PROVIDER_ID,
      installed: false,
      estimatedBytes: 367_088_960,
    };
  }
  return bridge.getVoicePackageStatus(KOKORO_JAPANESE_PROVIDER_ID);
}

export async function installJapaneseVoicePackage(
  onProgress: (progress: VoicePackageProgress) => void,
): Promise<VoicePackageStatus> {
  const bridge = (globalThis.window as VoicePackageWindow | undefined)
    ?.vocabularyTrainerDesktop;
  if (!bridge) throw new Error("Downloadable voice packages require the desktop app.");
  const unsubscribe = bridge.onVoicePackageProgress(onProgress);
  try {
    return await bridge.installVoicePackage(KOKORO_JAPANESE_PROVIDER_ID);
  } finally {
    unsubscribe();
  }
}

export async function deleteJapaneseVoicePackage(): Promise<VoicePackageStatus> {
  const bridge = (globalThis.window as VoicePackageWindow | undefined)
    ?.vocabularyTrainerDesktop;
  if (!bridge) throw new Error("Downloadable voice packages require the desktop app.");
  return bridge.deleteVoicePackage(KOKORO_JAPANESE_PROVIDER_ID);
}
