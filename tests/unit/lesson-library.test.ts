import { describe, expect, it, vi } from "vitest";

import {
  getLessonLibraryStatus,
  isLessonLibrarySupported,
  type LessonDirectoryHandle,
  writeLessonPackageToDirectory,
} from "../../src/services/lesson-library";

describe("local Lesson library", () => {
  it("creates lessons/<id>.vtlesson and closes the writable file", async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const getFileHandle = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));
    const lessonsDirectory = {
      name: "lessons",
      getDirectoryHandle: vi.fn(),
      getFileHandle,
    } as unknown as LessonDirectoryHandle;
    const root = {
      name: "project",
      getDirectoryHandle: vi.fn(async () => lessonsDirectory),
      getFileHandle: vi.fn(),
    } as unknown as LessonDirectoryHandle;
    const archive = new Blob(["lesson"], { type: "application/zip" });

    await writeLessonPackageToDirectory(root, "lesson-123", archive);

    expect(root.getDirectoryHandle).toHaveBeenCalledWith("lessons", {
      create: true,
    });
    expect(getFileHandle).toHaveBeenCalledWith("lesson-123.vtlesson", {
      create: true,
    });
    expect(write).toHaveBeenCalledWith(archive);
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses the native desktop storage bridge without a directory picker", async () => {
    Object.defineProperty(window, "vocabularyTrainerDesktop", {
      configurable: true,
      value: {
        getStorageRoot: vi.fn(async () => "C:\\Vocabulary Trainer Data"),
        saveLessonFile: vi.fn(),
        removeLessonFile: vi.fn(),
      },
    });

    expect(isLessonLibrarySupported()).toBe(true);
    await expect(getLessonLibraryStatus()).resolves.toEqual({
      supported: true,
      configured: true,
      directoryName: "C:\\Vocabulary Trainer Data",
      permission: "granted",
    });

    Reflect.deleteProperty(window, "vocabularyTrainerDesktop");
  });
});
