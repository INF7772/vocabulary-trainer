import type { LocalFileSystemHandleRecord } from "../../domain";
import type { VocabularyTrainerDatabase } from "../database";

export class FileSystemHandleRepository {
  constructor(
    private readonly db: VocabularyTrainerDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async getLessonLibraryHandle(): Promise<unknown | undefined> {
    return (await this.db.fileSystemHandles.get("lesson-library"))?.handle;
  }

  async saveLessonLibraryHandle(
    handle: unknown,
  ): Promise<LocalFileSystemHandleRecord> {
    const record: LocalFileSystemHandleRecord = {
      id: "lesson-library",
      handle,
      updatedAt: this.clock(),
    };
    await this.db.fileSystemHandles.put(record);
    return record;
  }

  async clearLessonLibraryHandle(): Promise<void> {
    await this.db.fileSystemHandles.delete("lesson-library");
  }
}
