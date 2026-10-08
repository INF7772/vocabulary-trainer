import { PortabilityError } from './portability';

export type UserErrorKey =
  | 'errors.corruptedImport'
  | 'errors.unsupportedBackup'
  | 'errors.invalidImport'
  | 'errors.storage'
  | 'errors.generic';

export function getUserErrorKey(error: unknown): UserErrorKey {
  if (error instanceof PortabilityError) {
    if (error.code === 'corrupted') return 'errors.corruptedImport';
    if (error.code === 'unsupported-version') return 'errors.unsupportedBackup';
    if (error.code === 'invalid-data') return 'errors.invalidImport';
    if (error.code === 'storage-failed') return 'errors.storage';
  }
  return 'errors.generic';
}
