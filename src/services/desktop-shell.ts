import { database } from "../data";

export interface DesktopStorageInfo {
  root: string;
  portable: boolean;
  migratedFrom: string | null;
  warning: string | null;
  applicationBytes: number | null;
  freeBytes: number | null;
  windowTheme: "light" | "dark";
  menuPresent: boolean;
}

interface DesktopShellBridge {
  getStorageInfo?: () => Promise<DesktopStorageInfo>;
  setWindowTheme?: (theme: "light" | "dark") => Promise<void>;
  exitApplication?: () => Promise<boolean>;
}

interface DesktopShellWindow extends Window {
  vocabularyTrainerDesktop?: DesktopShellBridge;
}

function bridge(): DesktopShellBridge | undefined {
  return (globalThis.window as DesktopShellWindow | undefined)
    ?.vocabularyTrainerDesktop;
}

export function isDesktopApplication(): boolean {
  return Boolean(bridge()?.exitApplication);
}

export async function getDesktopStorageInfo(): Promise<DesktopStorageInfo | null> {
  return (await bridge()?.getStorageInfo?.()) ?? null;
}

export async function setDesktopWindowTheme(
  theme: "light" | "dark",
): Promise<void> {
  await bridge()?.setWindowTheme?.(theme);
}

export async function exitDesktopApplication(): Promise<void> {
  const desktop = bridge();
  if (!desktop?.exitApplication) return;
  database.close();
  await desktop.exitApplication();
}
