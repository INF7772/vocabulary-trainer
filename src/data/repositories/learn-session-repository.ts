import {
  applyStatisticsDeltas,
  graduateToSrs,
  type GlobalCardStatistics,
  type LearnSessionState,
  type LearnTransition,
} from '../../domain';
import type { VocabularyTrainerDatabase } from '../database';
import type { LearnSessionRecord } from '../database/records';
import { EntityNotFoundError } from './errors';
import { type Clock, systemClock } from './shared';

export class LearnSessionRepository {
  constructor(
    private readonly db: VocabularyTrainerDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  async save(state: LearnSessionState): Promise<LearnSessionState> {
    return this.db.transaction(
      'rw',
      [this.db.lessons, this.db.learnSessions],
      async () => {
        if (!(await this.db.lessons.get(state.lessonId))) {
          throw new EntityNotFoundError('Lesson', state.lessonId);
        }

        const existing = await this.db.learnSessions.get(state.id);
        const now = this.clock();
        const record: LearnSessionRecord = {
          id: state.id,
          lessonId: state.lessonId,
          state: structuredClone(state),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        await this.db.learnSessions.put(record);
        return structuredClone(record.state);
      },
    );
  }

  async restartLesson(state: LearnSessionState): Promise<LearnSessionState> {
    return this.db.transaction(
      "rw",
      [
        this.db.lessons,
        this.db.lessonMemberships,
        this.db.lessonProgress,
        this.db.learnSessions,
        this.db.srsCards,
      ],
      async () => {
        if (!(await this.db.lessons.get(state.lessonId))) {
          throw new EntityNotFoundError("Lesson", state.lessonId);
        }

        const memberships = await this.db.lessonMemberships
          .where("lessonId")
          .equals(state.lessonId)
          .toArray();
        const membershipCardIds = new Set(
          memberships.map((membership) => membership.cardId),
        );
        const sessionCardIds = new Set([
          ...state.remainingNewCardIds,
          ...state.difficultCardIds,
          ...state.learnedCardIds,
          ...state.participatedCardIds,
          ...(state.currentBatch?.cardIds ?? []),
        ]);

        if (
          membershipCardIds.size !== sessionCardIds.size ||
          [...membershipCardIds].some((cardId) => !sessionCardIds.has(cardId))
        ) {
          throw new EntityNotFoundError(
            "LessonMembership",
            `${state.lessonId}:restart-scope`,
          );
        }

        const now = this.clock();
        await this.db.learnSessions
          .where("lessonId")
          .equals(state.lessonId)
          .delete();
        await this.db.lessonProgress.bulkPut(
          memberships.map((membership) => ({
            lessonId: membership.lessonId,
            cardId: membership.cardId,
            learned: false,
            updatedAt: now,
          })),
        );
        await this.db.learnSessions.put({
          id: state.id,
          lessonId: state.lessonId,
          state: structuredClone(state),
          createdAt: now,
          updatedAt: now,
        });
        return structuredClone(state);
      },
    );
  }

  async commitTransition(
    transition: LearnTransition,
  ): Promise<GlobalCardStatistics[]> {
    const { state } = transition;

    return this.db.transaction(
      'rw',
      [
        this.db.lessons,
        this.db.cards,
        this.db.lessonMemberships,
        this.db.lessonProgress,
        this.db.cardStatistics,
        this.db.learnSessions,
        this.db.srsCards,
      ],
      async () => {
        if (!(await this.db.lessons.get(state.lessonId))) {
          throw new EntityNotFoundError('Lesson', state.lessonId);
        }

        const statisticsCardIds = [
          ...new Set(
            transition.statisticsDeltas.map((delta) => delta.cardId),
          ),
        ];
        const statisticsCards = await this.db.cards.bulkGet(statisticsCardIds);
        const missingStatisticsCardIndex = statisticsCards.findIndex(
          (card) => card === undefined,
        );

        if (missingStatisticsCardIndex >= 0) {
          throw new EntityNotFoundError(
            'Card',
            statisticsCardIds[missingStatisticsCardIndex] as string,
          );
        }

        for (const cardId of statisticsCardIds) {
          if (
            !(await this.db.lessonMemberships.get([state.lessonId, cardId]))
          ) {
            throw new EntityNotFoundError(
              'LessonMembership',
              `${state.lessonId}:${cardId}`,
            );
          }
        }

        const now = this.clock();
        const currentStatistics = (
          await this.db.cardStatistics.bulkGet(statisticsCardIds)
        ).filter(isStatistics);
        const updatedStatistics = applyStatisticsDeltas(
          currentStatistics,
          transition.statisticsDeltas,
          now,
        ).filter((item) => statisticsCardIds.includes(item.cardId));

        if (updatedStatistics.length > 0) {
          await this.db.cardStatistics.bulkPut(updatedStatistics);
        }

        if (transition.newlyLearnedCardIds.length > 0) {
          const existingSrs = await this.db.srsCards.bulkGet(
            transition.newlyLearnedCardIds,
          );
          const newSrsStates = transition.newlyLearnedCardIds
            .filter((_, index) => !existingSrs[index])
            .map((cardId) => graduateToSrs(cardId, new Date(now)));
          if (newSrsStates.length > 0) {
            await this.db.srsCards.bulkPut(newSrsStates);
          }
        }

        const progressCardIds = [
          ...new Set([
            ...(state.currentBatch?.cardIds ?? []),
            ...transition.newlyLearnedCardIds,
          ]),
        ];

        for (const cardId of progressCardIds) {
          const membership = await this.db.lessonMemberships.get([
            state.lessonId,
            cardId,
          ]);

          if (!membership) {
            throw new EntityNotFoundError(
              'LessonMembership',
              `${state.lessonId}:${cardId}`,
            );
          }

          const currentProgress = await this.db.lessonProgress.get([
            state.lessonId,
            cardId,
          ]);
          const learned =
            currentProgress?.learned ||
            transition.newlyLearnedCardIds.includes(cardId);
          const currentBatch = state.currentBatch;

          await this.db.lessonProgress.put({
            lessonId: state.lessonId,
            cardId,
            learned,
            learningState:
              learned || !currentBatch?.cardIds.includes(cardId)
                ? undefined
                : {
                    stage: currentBatch.stage,
                    dirtyInCurrentBatch:
                      currentBatch.dirtyCardIds.includes(cardId),
                  },
            updatedAt: now,
          });
        }

        const existing = await this.db.learnSessions.get(state.id);
        await this.db.learnSessions.put({
          id: state.id,
          lessonId: state.lessonId,
          state: structuredClone(state),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });

        return updatedStatistics;
      },
    );
  }

  async get(id: string): Promise<LearnSessionState | undefined> {
    const record = await this.db.learnSessions.get(id);
    return record ? structuredClone(record.state) : undefined;
  }

  async getLatestForLesson(
    lessonId: string,
  ): Promise<LearnSessionState | undefined> {
    const records = await this.db.learnSessions
      .where('lessonId')
      .equals(lessonId)
      .sortBy('updatedAt');
    const latest = records.at(-1);
    return latest ? structuredClone(latest.state) : undefined;
  }

  async delete(id: string): Promise<void> {
    await this.db.learnSessions.delete(id);
  }

  async deleteForLesson(lessonId: string): Promise<void> {
    await this.db.learnSessions.where('lessonId').equals(lessonId).delete();
  }
}

function isStatistics(
  statistics: GlobalCardStatistics | undefined,
): statistics is GlobalCardStatistics {
  return statistics !== undefined;
}
