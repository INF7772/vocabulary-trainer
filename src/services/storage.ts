let persistenceRequested = false;

export interface StorageStatus {
  supported: boolean;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (persistenceRequested) {
    return null;
  }

  persistenceRequested = true;

  try {
    if (!globalThis.navigator?.storage?.persist) {
      return null;
    }

    return await globalThis.navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const storage = globalThis.navigator?.storage;
  if (!storage) return { supported: false, persisted: null, usage: null, quota: null };

  try {
    const [persisted, estimate] = await Promise.all([
      storage.persisted?.() ?? Promise.resolve(null),
      storage.estimate?.() ?? Promise.resolve({}),
    ]);
    return {
      supported: Boolean(storage.persist || storage.persisted || storage.estimate),
      persisted,
      usage: finiteOrNull(estimate.usage),
      quota: finiteOrNull(estimate.quota),
    };
  } catch {
    return { supported: true, persisted: null, usage: null, quota: null };
  }
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
