import { useLiveQuery } from 'dexie-react-hooks';

import {
  cardStudyMarkerRepository,
  lessonsRepository,
  statisticsRepository,
} from '../data';

export function useLessonBundle(lessonId?: string) {
  return useLiveQuery(async () => {
    if (!lessonId) {
      return null;
    }

    const lesson = await lessonsRepository.get(lessonId);

    if (!lesson) {
      return null;
    }

    const [cards, progress, statistics, studyMarkers] = await Promise.all([
      lessonsRepository.listCards(lessonId),
      lessonsRepository.listProgress(lessonId),
      statisticsRepository.list(),
      cardStudyMarkerRepository.list(),
    ]);

    return { lesson, cards, progress, statistics, studyMarkers };
  }, [lessonId]);
}
