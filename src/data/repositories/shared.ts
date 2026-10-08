import type { Card, GlobalCardStatistics } from '../../domain';
import { calculateAverageResponseTime } from '../../domain';
import type { CardRecord } from '../database/records';
import { InvalidEntityError } from './errors';

export type Clock = () => string;
export type IdFactory = () => string;

export const systemClock: Clock = () => new Date().toISOString();

export const systemIdFactory: IdFactory = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function normalizeTarget(target: string): string {
  return target.normalize('NFC');
}

export function toCard(record: CardRecord): Card {
  return {
    id: record.id,
    target: record.target,
    pronunciationText: record.pronunciationText,
    targetLanguage: record.targetLanguage,
    translations: record.translations,
    image: record.image,
    imageMetadata: record.imageMetadata,
    customAudio: record.customAudio,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toCardRecord(card: Card): CardRecord {
  return {
    ...card,
    normalizedTarget: normalizeTarget(card.target),
  };
}

export function requireNonEmpty(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new InvalidEntityError(`${fieldName} must not be empty.`);
  }

  return value;
}

export function normalizeStatistics(
  statistics: GlobalCardStatistics,
): GlobalCardStatistics {
  const counterFields = [
    statistics.correctCount,
    statistics.errorCount,
    statistics.totalCompletedQuestions,
    statistics.totalResponseTimeMs,
  ];

  if (counterFields.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new InvalidEntityError(
      'Statistics counters must be finite, non-negative numbers.',
    );
  }

  return {
    ...statistics,
    averageResponseTimeMs: calculateAverageResponseTime(statistics),
  };
}
