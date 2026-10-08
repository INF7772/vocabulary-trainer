import { database } from './database';
import {
  CardRepository,
  LearnSessionRepository,
  LessonRepository,
  SettingsRepository,
  StatisticsRepository,
  GeneratedTtsAudioRepository,
  FileSystemHandleRepository,
  CardStudyMarkerRepository,
  SrsRepository,
} from './repositories';

export const cardsRepository = new CardRepository(database);
export const lessonsRepository = new LessonRepository(database);
export const learnSessionsRepository = new LearnSessionRepository(database);
export const statisticsRepository = new StatisticsRepository(database);
export const settingsRepository = new SettingsRepository(database);
export const generatedTtsAudioRepository = new GeneratedTtsAudioRepository(database);
export const fileSystemHandleRepository = new FileSystemHandleRepository(database);
export const cardStudyMarkerRepository = new CardStudyMarkerRepository(database);
export const srsRepository = new SrsRepository(database);
