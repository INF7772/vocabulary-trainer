import { buildTodayQueue, type Card, type Lesson, type SrsCardState } from "../domain";
import { database, type VocabularyTrainerDatabase } from "../data/database";
import { withSettingsDefaults } from "../data/repositories/settings-repository";
import { createKanaGlyphOptions } from "./kana-study-reading";
import { resolveLessonContentType, toPracticeCards } from "./lesson-data";

export interface TodayCardItem {
  card: Card;
  lesson: Lesson;
  srs?: SrsCardState;
  manuallyDifficult: boolean;
  kanaOptions: string[];
  requiresHandwriting: boolean;
  acceptedDrawingTargets: string[];
}

export interface TodayNewGroup {
  lesson: Lesson;
  cards: Card[];
}

export interface LessonQueueItem {
  lesson: Lesson;
  cardCount: number;
  introducedCount: number;
}

export interface TodayPlanData {
  reviewItems: TodayCardItem[];
  newGroups: TodayNewGroup[];
  lessonQueue: LessonQueueItem[];
  difficultCount: number;
  dueCount: number;
  newCount: number;
  estimatedMinutes: number;
}

export async function loadTodayPlan(
  now = new Date(),
  db: VocabularyTrainerDatabase = database,
): Promise<TodayPlanData> {
  const [lessons, memberships, progress, cards, srsCards, markers, rawSettings] =
    await Promise.all([
      db.lessons.orderBy("createdAt").toArray(),
      db.lessonMemberships.toArray(),
      db.lessonProgress.toArray(),
      db.cards.toArray(),
      db.srsCards.toArray(),
      db.cardStudyMarkers.toArray(),
      db.settings.get("application"),
    ]);
  const settings = rawSettings
    ? withSettingsDefaults(rawSettings)
    : { maximumNewCardsPerDay: 10 };
  const cardsById = new Map(cards.map((card) => [card.id, card as Card]));
  const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const lessonOrder = new Map(lessons.map((lesson, index) => [lesson.id, index]));
  const orderedMemberships = [...memberships].sort(
    (left, right) =>
      (lessonOrder.get(left.lessonId) ?? 0) -
        (lessonOrder.get(right.lessonId) ?? 0) ||
      left.position - right.position,
  );
  const firstMembershipByCard = new Map<string, (typeof memberships)[number]>();
  for (const membership of orderedMemberships) {
    if (!firstMembershipByCard.has(membership.cardId)) {
      firstMembershipByCard.set(membership.cardId, membership);
    }
  }
  const lessonCardsById = new Map(
    lessons.map((lesson) => [
      lesson.id,
      orderedMemberships
        .filter((membership) => membership.lessonId === lesson.id)
        .flatMap((membership) => {
          const card = cardsById.get(membership.cardId);
          return card ? [card] : [];
        }),
    ]),
  );
  const lessonContentTypes = new Map(
    lessons.map((lesson) => [
      lesson.id,
      resolveLessonContentType(lesson, lessonCardsById.get(lesson.id) ?? []),
    ]),
  );
  const practiceCardsByLessonAndCard = new Map(
    lessons.flatMap((lesson) =>
      toPracticeCards(lessonCardsById.get(lesson.id) ?? [], lesson).map(
        (card) => [`${lesson.id}\0${card.id}`, card] as const,
      ),
    ),
  );
  const progressByMembership = new Map(
    progress.map((item) => [`${item.lessonId}\0${item.cardId}`, item]),
  );
  const scheduledCardIds = new Set(srsCards.map((item) => item.cardId));
  const markedCardIds = new Set(markers.map((item) => item.cardId));
  const newCandidates = orderedMemberships
    .filter(
      (membership) =>
        !scheduledCardIds.has(membership.cardId) &&
        !progressByMembership.get(
          `${membership.lessonId}\0${membership.cardId}`,
        )?.learned,
    )
    .map((membership) => membership.cardId);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const introducedTodayCount = srsCards.filter((item) => {
    const introducedAt = new Date(item.introducedAt);
    return introducedAt >= startOfToday && introducedAt <= now;
  }).length;
  const queue = buildTodayQueue({
    now,
    maximumNewCardsPerDay: settings.maximumNewCardsPerDay,
    reviewStates: srsCards,
    introducedTodayCount,
    newCardIdsInLessonOrder: newCandidates,
  });
  const srsByCard = new Map(srsCards.map((item) => [item.cardId, item]));
  const reviewItems = queue.reviewCardIds.flatMap((cardId) => {
    const card = cardsById.get(cardId);
    const membership = firstMembershipByCard.get(cardId);
    const lesson = membership && lessonsById.get(membership.lessonId);
    const srs = srsByCard.get(cardId);
    const practiceCard = lesson
      ? practiceCardsByLessonAndCard.get(`${lesson.id}\0${cardId}`)
      : undefined;
    return card && lesson && srs
      ? [{
          card,
          lesson,
          srs,
          manuallyDifficult: markedCardIds.has(cardId),
          requiresHandwriting: lessonContentTypes.get(lesson.id) === "symbols",
          acceptedDrawingTargets: practiceCard?.acceptedDrawingTargets ?? [
            card.target,
          ],
          kanaOptions: createKanaGlyphOptions(
            card.target,
            card.targetLanguage,
            cards
              .filter((candidate) => candidate.targetLanguage === card.targetLanguage)
              .map((candidate) => candidate.target),
          ),
        }]
      : [];
  });
  const selectedNewIds = new Set(queue.newCardIds);
  const newGroupsByLesson = new Map<string, TodayNewGroup>();
  for (const membership of orderedMemberships) {
    if (!selectedNewIds.has(membership.cardId)) continue;
    const card = cardsById.get(membership.cardId);
    const lesson = lessonsById.get(membership.lessonId);
    if (!card || !lesson) continue;
    const group = newGroupsByLesson.get(lesson.id) ?? { lesson, cards: [] };
    if (!group.cards.some((item) => item.id === card.id)) group.cards.push(card);
    newGroupsByLesson.set(lesson.id, group);
    selectedNewIds.delete(membership.cardId);
  }
  const lessonQueue = lessons.map((lesson) => {
    const lessonMemberships = orderedMemberships.filter(
      (membership) => membership.lessonId === lesson.id,
    );
    return {
      lesson,
      cardCount: lessonMemberships.length,
      introducedCount: lessonMemberships.filter(
        (membership) =>
          scheduledCardIds.has(membership.cardId) ||
          progressByMembership.get(
            `${membership.lessonId}\0${membership.cardId}`,
          )?.learned,
      ).length,
    };
  });

  return {
    reviewItems,
    newGroups: [...newGroupsByLesson.values()],
    lessonQueue,
    difficultCount: reviewItems.filter((item) => item.manuallyDifficult).length,
    dueCount: reviewItems.length,
    newCount: queue.newCount,
    estimatedMinutes: queue.estimatedMinutes,
  };
}
