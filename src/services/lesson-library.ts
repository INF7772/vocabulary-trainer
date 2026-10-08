import { fileSystemHandleRepository } from "../data";
import type { Card, Lesson } from "../domain";
import { exportLessonPackage } from "./portability";

type PermissionStateValue = "granted" | "denied" | "prompt";

export interface WritableLessonFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface LessonFileHandle {
  createWritable(): Promise<WritableLessonFile>;
}

export interface LessonDirectoryHandle {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<LessonDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<LessonFileHandle>;
  removeEntry?(name: string): Promise<void>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionStateValue>;
  requestPermission?(options: {
    mode: "readwrite";
  }): Promise<PermissionStateValue>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options: {
    id?: string;
    mode: "readwrite";
  }) => Promise<LessonDirectoryHandle>;
}

interface DesktopStorageBridge {
  getStorageRoot(): Promise<string>;
  saveLessonFile(fileName: string, data: ArrayBuffer): Promise<string>;
  removeLessonFile(fileName: string): Promise<void>;
}

interface LessonLibraryWindow extends DirectoryPickerWindow {
  vocabularyTrainerDesktop?: DesktopStorageBridge;
}

export type LessonLibrarySyncResult =
  | { status: "saved"; directoryName: string }
  | { status: "unchanged"; directoryName: string }
  | { status: "not-configured" | "permission-required" | "unsupported" };

export interface LessonLibraryStatus {
  supported: boolean;
  configured: boolean;
  directoryName?: string;
  permission: PermissionStateValue | "unknown";
}

export function buildLessonLibraryRevision(
  lesson: Pick<Lesson, "updatedAt">,
  cards: readonly Pick<Card, "id" | "updatedAt">[],
): string {
  return [
    lesson.updatedAt,
    ...cards.map((card) => `${card.id}:${card.updatedAt}`),
  ].join("|");
}

export function isLessonLibrarySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    (Boolean((window as LessonLibraryWindow).vocabularyTrainerDesktop) ||
      typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function")
  );
}

export async function chooseLessonLibraryDirectory(): Promise<LessonLibraryStatus> {
  const desktop = (window as LessonLibraryWindow).vocabularyTrainerDesktop;
  if (desktop) return desktopLibraryStatus(desktop);
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    return { supported: false, configured: false, permission: "unknown" };
  }
  const root = await picker({ id: "vocabulary-trainer-library", mode: "readwrite" });
  await root.getDirectoryHandle("lessons", { create: true });
  await fileSystemHandleRepository.saveLessonLibraryHandle(root);
  return {
    supported: true,
    configured: true,
    directoryName: root.name,
    permission: "granted",
  };
}

export async function getLessonLibraryStatus(): Promise<LessonLibraryStatus> {
  const desktop = (window as LessonLibraryWindow).vocabularyTrainerDesktop;
  if (desktop) return desktopLibraryStatus(desktop);
  const supported = isLessonLibrarySupported();
  const root = await readStoredDirectory();
  if (!root) return { supported, configured: false, permission: "unknown" };
  return {
    supported,
    configured: true,
    directoryName: root.name,
    permission: await readPermission(root),
  };
}

export async function requestLessonLibraryPermission(): Promise<LessonLibraryStatus> {
  const desktop = (window as LessonLibraryWindow).vocabularyTrainerDesktop;
  if (desktop) return desktopLibraryStatus(desktop);
  const root = await readStoredDirectory();
  if (!root) return chooseLessonLibraryDirectory();
  const permission = root.requestPermission
    ? await root.requestPermission({ mode: "readwrite" })
    : "granted";
  return {
    supported: isLessonLibrarySupported(),
    configured: true,
    directoryName: root.name,
    permission,
  };
}

export async function syncLessonToLibrary(
  lessonId: string,
  revision?: string,
): Promise<LessonLibrarySyncResult> {
  const desktop = (window as LessonLibraryWindow).vocabularyTrainerDesktop;
  if (desktop) {
    const directoryName = await desktop.getStorageRoot();
    if (revision && synchronizedRevisions.get(lessonId) === revision) {
      return { status: "unchanged", directoryName };
    }
    const archive = await exportLessonPackage(lessonId);
    await desktop.saveLessonFile(
      `${lessonId}.vtlesson`,
      await archive.arrayBuffer(),
    );
    if (revision) synchronizedRevisions.set(lessonId, revision);
    return { status: "saved", directoryName };
  }
  if (!isLessonLibrarySupported()) return { status: "unsupported" };
  const root = await readStoredDirectory();
  if (!root) return { status: "not-configured" };
  if ((await readPermission(root)) !== "granted") {
    return { status: "permission-required" };
  }
  if (revision && synchronizedRevisions.get(lessonId) === revision) {
    return { status: "unchanged", directoryName: root.name };
  }
  const archive = await exportLessonPackage(lessonId);
  await writeLessonPackageToDirectory(root, lessonId, archive);
  if (revision) synchronizedRevisions.set(lessonId, revision);
  return { status: "saved", directoryName: root.name };
}

export async function writeLessonPackageToDirectory(
  root: LessonDirectoryHandle,
  lessonId: string,
  archive: Blob,
): Promise<void> {
  const lessons = await root.getDirectoryHandle("lessons", { create: true });
  const file = await lessons.getFileHandle(`${lessonId}.vtlesson`, {
    create: true,
  });
  const writable = await file.createWritable();
  try {
    await writable.write(archive);
  } finally {
    await writable.close();
  }
}

export async function removeLessonFromLibrary(lessonId: string): Promise<void> {
  const desktop = (window as LessonLibraryWindow).vocabularyTrainerDesktop;
  if (desktop) {
    await desktop.removeLessonFile(`${lessonId}.vtlesson`);
    synchronizedRevisions.delete(lessonId);
    return;
  }
  const root = await readStoredDirectory();
  if (!root || (await readPermission(root)) !== "granted") return;
  const lessons = await root.getDirectoryHandle("lessons", { create: true });
  try {
    await lessons.removeEntry?.(`${lessonId}.vtlesson`);
    synchronizedRevisions.delete(lessonId);
  } catch {
    // A missing external file is already the desired state.
  }
}

async function desktopLibraryStatus(
  desktop: DesktopStorageBridge,
): Promise<LessonLibraryStatus> {
  return {
    supported: true,
    configured: true,
    directoryName: await desktop.getStorageRoot(),
    permission: "granted",
  };
}

async function readStoredDirectory(): Promise<LessonDirectoryHandle | undefined> {
  try {
    return (await fileSystemHandleRepository.getLessonLibraryHandle()) as
      | LessonDirectoryHandle
      | undefined;
  } catch {
    return undefined;
  }
}

async function readPermission(
  handle: LessonDirectoryHandle,
): Promise<PermissionStateValue> {
  return handle.queryPermission
    ? handle.queryPermission({ mode: "readwrite" })
    : "granted";
}

const synchronizedRevisions = new Map<string, string>();
