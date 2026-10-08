import { createBrowserRouter } from 'react-router-dom';

import { AppShell } from '../components/AppShell';
import { LocalizedLoading } from '../components/LocalizedLoading';
import { AppErrorPage } from '../pages/AppErrorPage';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <AppErrorPage />,
    HydrateFallback: LocalizedLoading,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'today', lazy: async () => ({ Component: (await import('../pages/TodayPage')).TodayPage }) },
      { path: 'practice', lazy: async () => ({ Component: (await import('../pages/TrainingPage')).TrainingPage }) },
      { path: 'lessons/new', lazy: async () => ({ Component: (await import('../pages/LessonWizardPage')).LessonWizardPage }) },
      { path: 'lessons/:lessonId', lazy: async () => ({ Component: (await import('../pages/LessonDetailPage')).LessonDetailPage }) },
      { path: 'lessons/:lessonId/settings', lazy: async () => ({ Component: (await import('../pages/LessonSettingsPage')).LessonSettingsPage }) },
      { path: 'lessons/:lessonId/cards/:cardId', lazy: async () => ({ Component: (await import('../pages/CardEditorPage')).CardEditorPage }) },
      { path: 'lessons/:lessonId/learn', lazy: async () => ({ Component: (await import('../pages/LearnPage')).LearnPage }) },
      { path: 'lessons/:lessonId/handwriting', lazy: async () => ({ Component: (await import('../pages/HandwritingPracticePage')).HandwritingPracticePage }) },
      { path: 'lessons/:lessonId/automate', lazy: async () => ({ Component: (await import('../pages/AutomatePage')).AutomatePage }) },
      { path: 'lessons/:lessonId/quick-choice', lazy: async () => ({ Component: (await import('../pages/QuickChoicePage')).QuickChoicePage }) },
      { path: 'lessons/:lessonId/chaos', lazy: async () => ({ Component: (await import('../pages/ChaosPage')).ChaosPage }) },
      { path: 'settings', lazy: async () => ({ Component: (await import('../pages/SettingsPage')).SettingsPage }) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
