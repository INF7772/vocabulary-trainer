import { useLiveQuery } from "dexie-react-hooks";
import {
  BookOpen,
  Clock3,
  Download,
  FileUp,
  Flag,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { TodayOverview } from "../components/TodayOverview";
import { Button } from "../components/ui/Button";
import { languageDisplayName } from "../config/languages";
import { hasRecentError, type Lesson } from "../domain";
import {
  cardStudyMarkerRepository,
  lessonsRepository,
  statisticsRepository,
} from "../data";
import { getUserErrorKey } from "../services/errors";
import {
  summarizeLesson,
  type LessonSummary,
} from "../services/lesson-data";
import { importLessonForOfflineUse } from "../services/lesson-preparation";
import { removeLessonFromLibrary } from "../services/lesson-library";
import {
  downloadBlob,
  exportLessonPackage,
  safeFilename,
} from "../services/portability";
import { requestPersistentStorage } from "../services/storage";
import { formatAccuracy } from "../utils/format";

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lessonInput = useRef<HTMLInputElement>(null);
  const homeData = useLiveQuery(async () => {
    const [all, statistics, studyMarkers] = await Promise.all([
      lessonsRepository.list(),
      statisticsRepository.list(),
      cardStudyMarkerRepository.list(),
    ]);
    const lessons = await Promise.all(
      all.map(async (lesson) => {
        const [cards, progress] = await Promise.all([
          lessonsRepository.listCards(lesson.id),
          lessonsRepository.listProgress(lesson.id),
        ]);
        return {
          lesson,
          summary: summarizeLesson(cards, progress, statistics),
          cards,
        };
      }),
    );
    const statisticsByCard = new Map(
      statistics.map((item) => [item.cardId, item]),
    );
    const markedCardIds = new Set(studyMarkers.map((item) => item.cardId));
    const byLanguage = new Map<
      string,
      { difficult: Set<string>; recent: Set<string> }
    >();
    for (const { lesson, cards } of lessons) {
      const collection = byLanguage.get(lesson.targetLanguage) ?? {
        difficult: new Set<string>(),
        recent: new Set<string>(),
      };
      for (const card of cards) {
        if (markedCardIds.has(card.id)) collection.difficult.add(card.id);
        if (hasRecentError(statisticsByCard.get(card.id), nowMs)) {
          collection.recent.add(card.id);
        }
      }
      byLanguage.set(lesson.targetLanguage, collection);
    }
    return { lessons, collections: [...byLanguage.entries()] };
  }, [nowMs]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function importLesson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const result = await importLessonForOfflineUse(file, (progress) =>
        setImportMessage(
          t("audio.preparingCards", {
            completed: progress.completed,
            total: progress.total,
          }),
        ),
      );
      await requestPersistentStorage();
      const audioQuery = result.audio.failedCardIds.length
        ? `&audioFailed=${result.audio.failedCardIds.length}`
        : "";
      navigate(`/lessons/${result.lesson.id}?review=1${audioQuery}`, {
        state: { notice: t("settings.lessonImported") },
      });
    } catch (error) {
      setImportMessage(t(getUserErrorKey(error)));
    } finally {
      setImporting(false);
    }
  }

  if (!homeData) return <p>{t("common.loading")}</p>;
  const { lessons, collections } = homeData;
  const recentLesson = [...lessons].sort((left, right) =>
    right.lesson.updatedAt.localeCompare(left.lesson.updatedAt),
  )[0];
  const otherLessons = lessons.filter(
    ({ lesson }) => lesson.id !== recentLesson?.lesson.id,
  );
  const usefulCollections = collections
    .flatMap(([language, collection]) => [
      {
        key: `${language}-difficult`,
        count: collection.difficult.size,
        icon: <Flag size={20} aria-hidden="true" />,
        language,
        title: t("training.difficultCollection"),
        selection: "difficult",
      },
      {
        key: `${language}-recent`,
        count: collection.recent.size,
        icon: <Clock3 size={20} aria-hidden="true" />,
        language,
        title: t("training.recentErrorsCollection"),
        selection: "recent-errors",
      },
    ])
    .filter((collection) => collection.count > 0);

  return (
    <div className="space-y-7">
      <PageHeader
        title={t("home.title")}
        description={
          lessons.length ? t("home.dashboardBody") : t("home.foundationReady")
        }
        actions={
          lessons.length ? (
            <Button
              variant="secondary"
              disabled={importing}
              onClick={() => lessonInput.current?.click()}
              icon={<FileUp aria-hidden="true" size={18} />}
            >
              {importing ? t("settings.importing") : t("home.importLesson")}
            </Button>
          ) : undefined
        }
      />
      <input
        ref={lessonInput}
        accept=".vtlesson,.zip,application/zip"
        className="sr-only"
        onChange={(event) => void importLesson(event)}
        type="file"
      />
      {importMessage ? (
        <p
          className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          role="status"
        >
          {importMessage}
        </p>
      ) : null}

      {lessons.length > 0 ? <TodayOverview /> : null}

      {lessons.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <BookOpen className="mx-auto text-sky-600" aria-hidden="true" size={40} />
          <h2 className="mt-4 text-xl font-bold">{t("home.empty")}</h2>
          <p className="mx-auto mt-2 max-w-lg text-slate-600 dark:text-slate-300">
            {t("home.emptyBody")}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white dark:bg-sky-400 dark:text-slate-950"
              to="/lessons/new"
            >
              <Plus size={18} aria-hidden="true" /> {t("home.createFirst")}
            </Link>
            <Button
              variant="secondary"
              disabled={importing}
              onClick={() => lessonInput.current?.click()}
              icon={<FileUp aria-hidden="true" size={18} />}
            >
              {importing ? t("settings.importing") : t("home.importLesson")}
            </Button>
          </div>
        </section>
      ) : (
        <>
          {recentLesson ? (
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {t("home.continueLearning")}
              </h2>
              <LessonCard {...recentLesson} featured />
            </section>
          ) : null}

          {usefulCollections.length > 0 ? (
            <details className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 font-bold [&::-webkit-details-marker]:hidden">
                <span>{t("training.automaticCollections")}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800">
                  {usefulCollections.length}
                </span>
              </summary>
              <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-2 dark:border-slate-800">
                {usefulCollections.map((collection) => (
                  <AutomaticCollection
                    key={collection.key}
                    count={collection.count}
                    icon={collection.icon}
                    language={languageDisplayName(collection.language, t)}
                    title={collection.title}
                    to={`/practice?language=${encodeURIComponent(collection.language)}&selection=${collection.selection}`}
                  />
                ))}
              </div>
            </details>
          ) : null}

          {otherLessons.length > 0 ? (
            <section>
              <h2 className="mb-3 text-2xl font-black">
                {t("home.otherLessons")}
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {otherLessons.map((item) => (
                  <LessonCard key={item.lesson.id} {...item} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function LessonCard({
  lesson,
  summary,
  featured = false,
}: {
  lesson: Lesson;
  summary: LessonSummary;
  featured?: boolean;
}) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const progress = summary.cardCount
    ? Math.round((summary.learnedCount / summary.cardCount) * 100)
    : 0;

  async function exportLesson() {
    setExporting(true);
    try {
      const blob = await exportLessonPackage(lesson.id);
      downloadBlob(blob, `${safeFilename(lesson.name)}.vtlesson`);
    } finally {
      setExporting(false);
    }
  }

  async function deleteLesson() {
    if (!window.confirm(t("lesson.deleteConfirm"))) return;
    await removeLessonFromLibrary(lesson.id);
    await lessonsRepository.delete(lesson.id, { deleteOrphanCards: false });
  }
  return (
    <article
      className={`rounded-3xl border bg-white shadow-sm dark:bg-slate-900 ${
        featured
          ? "border-sky-200 p-6 dark:border-sky-900"
          : "border-slate-200 p-5 dark:border-slate-800"
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            {lesson.targetLanguage.toUpperCase()} ·{" "}
            {lesson.visibleTranslationLanguages
              .map((language) => language.toUpperCase())
              .join(" · ")}
          </p>
          <Link
            className={`${featured ? "text-3xl" : "text-xl"} mt-1 block truncate font-black hover:text-sky-700 dark:hover:text-sky-300`}
            to={`/lessons/${lesson.id}`}
          >
            {lesson.name}
          </Link>
        </div>
        <details className="relative">
          <summary
            aria-label={t("common.moreActions")}
            className="grid size-10 cursor-pointer list-none place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden"
          >
            <MoreHorizontal aria-hidden="true" size={20} />
          </summary>
          <div className="absolute right-0 top-11 z-20 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <Link className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800" to={`/lessons/${lesson.id}/settings`}>
              <Pencil size={16} aria-hidden="true" /> {t("lesson.settings")}
            </Link>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800" disabled={exporting} onClick={() => void exportLesson()} type="button">
              <Download size={16} aria-hidden="true" /> {exporting ? t("lesson.exporting") : t("lesson.export")}
            </button>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950" onClick={() => void deleteLesson()} type="button">
              <Trash2 size={16} aria-hidden="true" /> {t("common.delete")}
            </button>
          </div>
        </details>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-sky-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span>
          {summary.learnedCount} / {summary.cardCount}{" "}
          {t("lesson.learned").toLocaleLowerCase()}
        </span>
        <span>
          {t("lesson.accuracy")}: {formatAccuracy(summary.averageAccuracy)}
        </span>
      </div>
      <div className="mt-5 flex items-center gap-2">
        <Link
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 font-bold text-white hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
          to={`/lessons/${lesson.id}/learn`}
        >
          <Play aria-hidden="true" size={18} /> {t("lesson.learn")}
        </Link>
        <Link
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          to={`/practice?lesson=${lesson.id}`}
        >
          <SlidersHorizontal aria-hidden="true" size={18} /> {t("training.configure")}
        </Link>
      </div>
    </article>
  );
}

function AutomaticCollection({
  count,
  icon,
  language,
  title,
  to,
}: {
  count: number;
  icon: ReactNode;
  language: string;
  title: string;
  to: string;
}) {
  const { t } = useTranslation();
  return (
    <Link
      className="flex items-center gap-4 rounded-2xl bg-slate-50 p-4 hover:bg-sky-50 dark:bg-slate-800 dark:hover:bg-sky-950"
      to={to}
    >
      <span className="rounded-xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block">{title}</strong>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {language}
        </span>
      </span>
      <span className="rounded-full bg-white px-3 py-1 text-sm font-bold dark:bg-slate-900">
        {t("training.collectionCount", { count })}
      </span>
    </Link>
  );
}
