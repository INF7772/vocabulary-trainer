import type { Card, LearnSessionState, Timestamp } from '../../domain';

export interface CardRecord extends Card {
  normalizedTarget: string;
}

export interface LearnSessionRecord {
  id: string;
  lessonId: string;
  state: LearnSessionState;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
