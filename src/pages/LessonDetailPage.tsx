import { calculateAccuracy, type Card } from "../domain";
import {
  ArrowLeft,
  BookOpen,
  Download,
  Flag,
  MoreHorizontal,
  PenTool,
  Pencil,
  RotateCcw,
  Shuffle,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { CardImage } from "../components/CardImage";
import { LessonReadinessPanel } from "../components/LessonReadinessPanel";
import { PageHeader } from "../components/PageHeader";
import { TargetText } from "../components/TargetText";
import { Button } from "../components/ui/Button";
import { inputClassName } from "../components/ui/FormField";
import {
  cardsRepository,
  cardStudyMarkerRepository,
  lessonsRepository,
  settingsRepository,
  statisticsRepository,
} from "../data";
import { useLessonBundle } from "../hooks/useLessonBundle";
import { useAudioAvailability } from "../hooks/useAudioAvailability";
import { resolveLessonContentType, summarizeLesson } from "../services/lesson-data";
import {
  buildLessonLibraryRevision,
  removeLessonFromLibrary,
} from "../services/lesson-library";
import { getCardReadiness } from "../services/lesson-data";
import {
  playCardAudio,
  prepareGeneratedAudioForCards,
} from "../services/audio";
import { prepareLessonForOfflineUse } from "../services/lesson-preparation";
import { formatAccuracy, formatDuration } from "../utils/format";
import { getUserErrorKey } from "../services/errors";
import { fillMissingKanaStudyTranslations } from "../services/kana-study-reading";
import {
  downloadBlob,
  exportLessonPackage,
  safeFilename,
} from "../services/portability";

type SortMode =
  | "alphabetical"
  | "lowest"
  | "highest"
  | "slowest"
  | "fastest"
  | "errors";

export function LessonDetailPage() {
  const { lessonId } = useParams();
  const bundle = useLessonBundle(lessonId);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sort, setSort] = useState<SortMode>("alphabetical");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [newName, setNewName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [resettingStatistics, setResettingStatistics] = useState(false);
  const [preparedLibraryRevision, setPreparedLibraryRevision] = useState<
    string | null
  >(null);
  const [status, setStatus] = useState<string | null>(null);
  const audioAvailable = useAudioAvailability(bundle?.lesson);
  const statsByCard = useMemo(
    () => new Map(bundle?.statistics.map((item) => [item.cardId, item]) ?? []),
    [bundle],
  );
  const progressByCard = useMemo(
    () => new Map(bundle?.progress.map((item) => [item.cardId, item]) ?? []),
    [bundle],
  );
  const markedCardIds = useMemo(
    () => new Set(bundle?.studyMarkers.map((item) => item.cardId) ?? []),
    [bundle],
  );

  const sortedCards = useMemo(() => {
    const cards = [...(bundle?.cards ?? [])];
    return cards.sort((a, b) => compareCards(a, b, sort, statsByCard));
  }, [bundle?.cards, sort, statsByCard]);
  const libraryRevision = bundle
    ? buildLessonLibraryRevision(bundle.lesson, bundle.cards)
    : "";
  const libraryLessonId = bundle?.lesson.id;
  const preparingAudio = Boolean(
    libraryRevision && preparedLibraryRevision !== libraryRevision,
  );

  useEffect(() => {
    if (!bundle || !libraryLessonId) return;
    let active = true;
    void Promise.all(bundle.cards.map(async (card) => {
      const translations = fillMissingKanaStudyTranslations(
        card.target,
        card.targetLanguage,
        bundle.lesson.translationLanguages,
        card.translations,
      );
      return translations === card.translations
        ? card
        : cardsRepository.update(card.id, { translations });
    })).then((preparedCards) => prepareLessonForOfflineUse(
      bundle.lesson,
      preparedCards,
      (progress) => {
        if (!active) return;
        setStatus(
          t("audio.preparingCards", {
            completed: progress.completed,
            total: progress.total,
          }),
        );
      },
    ))
      .then((result) => {
        if (!active) return;
        if (result.audio.failedCardIds.length > 0) {
          setStatus(
            t("audio.preparationPartial", {
              count: result.audio.failedCardIds.length,
            }),
          );
        } else if (result.library.status === "permission-required") {
          setStatus(t("settings.libraryPermissionRequired"));
        } else {
          setStatus(t("audio.offlineReady"));
        }
      })
      .catch((error) => {
        if (active) setStatus(t(getUserErrorKey(error)));
      })
      .finally(() => {
        if (active) setPreparedLibraryRevision(libraryRevision);
      });
    return () => {
      active = false;
    };
    // The revision contains each content timestamp used by the Lesson package.
    // Generated audio is deliberately prepared before the package is synced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryLessonId, libraryRevision, t]);

  if (bundle === undefined) return <p>{t("common.loading")}</p>;
  if (!bundle) return <p>{t("notFound.title")}</p>;

  const { lesson, cards, progress, statistics } = bundle;
  const contentType = resolveLessonContentType(lesson, cards);
  const summary = summarizeLesson(cards, progress, statistics);
  async function createFromSelection() {
    if (!newName.trim() || selected.size === 0) return;
    const created = await lessonsRepository.create({
      name: newName.trim(),
      targetLanguage: lesson.targetLanguage,
      translationLanguages: lesson.translationLanguages,
      activeTranslationLanguage: lesson.activeTranslationLanguage,
      visibleTranslationLanguages: lesson.visibleTranslationLanguages,
      useImages: lesson.useImages,
      tts: lesson.tts,
    });
    for (const cardId of selected)
      await lessonsRepository.addCard(created.id, cardId);
    setStatus(t("audio.preparingCards", { completed: 0, total: selected.size }));
    const result = await prepareGeneratedAudioForCards(
      cards.filter((card) => selected.has(card.id)),
      created,
      (progress) =>
        setStatus(
          t("audio.preparingCards", {
            completed: progress.completed,
            total: progress.total,
          }),
        ),
    );
    const audioQuery = result.failedCardIds.length
      ? `?audioFailed=${result.failedCardIds.length}`
      : "";
    navigate(`/lessons/${created.id}${audioQuery}`);
  }

  async function deleteLesson() {
    if (!window.confirm(t("lesson.deleteConfirm"))) return;
    await removeLessonFromLibrary(lesson.id);
    await lessonsRepository.delete(lesson.id, {
      deleteOrphanCards: false,
    });
    navigate("/");
  }

  async function exportLesson() {
    setExporting(true);
    setStatus(null);
    try {
      const blob = await exportLessonPackage(lesson.id);
      downloadBlob(blob, `${safeFilename(lesson.name)}.vtlesson`);
      setStatus(t("lesson.exported"));
    } catch (error) {
      setStatus(t(getUserErrorKey(error)));
    } finally {
      setExporting(false);
    }
  }

  async function resetCardStatistics(cardId: string, target: string) {
    if (!window.confirm(t("lesson.resetCardStatisticsConfirm", { target }))) {
      return;
    }
    setResettingStatistics(true);
    try {
      await statisticsRepository.reset([cardId]);
      setStatus(t("lesson.statisticsReset"));
    } catch (error) {
      setStatus(t(getUserErrorKey(error)));
    } finally {
      setResettingStatistics(false);
    }
  }

  async function resetLessonStatistics() {
    if (!window.confirm(t("lesson.resetLessonStatisticsConfirm"))) return;
    setResettingStatistics(true);
    try {
      await statisticsRepository.reset(cards.map((card) => card.id));
      setStatus(t("lesson.statisticsReset"));
    } catch (error) {
      setStatus(t(getUserErrorKey(error)));
    } finally {
      setResettingStatistics(false);
    }
  }

  async function setTranslationVisibility(
    language: string,
    visible: boolean,
  ) {
    const next = visible
      ? [...new Set([...lesson.visibleTranslationLanguages, language])]
      : lesson.visibleTranslationLanguages.filter((item) => item !== language);
    if (next.length === 0) return;
    await lessonsRepository.update(lesson.id, {
      activeTranslationLanguage: next[0],
      visibleTranslationLanguages: next,
    });
    const settings = await settingsRepository.get();
    await settingsRepository.update({
      translationLanguages: [
        ...new Set([...settings.translationLanguages, ...lesson.translationLanguages]),
      ],
      defaultActiveTranslationLanguage: next[0],
      defaultVisibleTranslationLanguages: next,
    });
  }

  return (
    <div className="space-y-7">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-sky-700 dark:text-slate-300"
      >
        <ArrowLeft size={17} aria-hidden="true" />
        {t("common.back")}
      </Link>
      <PageHeader
        eyebrow={`${lesson.targetLanguage.toUpperCase()} → ${lesson.visibleTranslationLanguages.map((language) => language.toUpperCase()).join(" · ")}`}
        title={lesson.name}
        actions={
          <details className="relative">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
              <MoreHorizontal size={18} aria-hidden="true" />
              {t("common.moreActions")}
            </summary>
            <div className="absolute right-0 top-12 z-30 w-64 space-y-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <Link
                className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                to={`/lessons/${lesson.id}/settings`}
              >
                <Pencil size={17} aria-hidden="true" /> {t("lesson.settings")}
              </Link>
              <button
                className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                disabled={exporting}
                onClick={() => void exportLesson()}
                type="button"
              >
                <Download size={17} aria-hidden="true" />
                {exporting ? t("lesson.exporting") : t("lesson.export")}
              </button>
              <button
                className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                disabled={resettingStatistics || !cards.some((card) => statsByCard.has(card.id))}
                onClick={() => void resetLessonStatistics()}
                type="button"
              >
                <RotateCcw size={17} aria-hidden="true" /> {t("lesson.resetLessonStatistics")}
              </button>
              <button
                className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
                onClick={() => void deleteLesson()}
                type="button"
              >
                <Trash2 size={17} aria-hidden="true" /> {t("common.delete")}
              </button>
            </div>
          </details>
        }
      />

      {status ? (
        <p
          className="rounded-xl bg-sky-50 p-3 text-sky-900 dark:bg-sky-950 dark:text-sky-100"
          role="status"
        >
          {status}
        </p>
      ) : null}

      {searchParams.get("review") === "1" ? (
        <section className="rounded-2xl border border-sky-300 bg-sky-50 p-5 dark:border-sky-800 dark:bg-sky-950">
          <h2 className="font-bold">{t("wizard.review")}</h2>
          <p className="mt-1 text-sm">{t(contentType === "symbols" ? "wizard.symbolReviewBody" : "wizard.reviewBody")}</p>
        </section>
      ) : null}

      {searchParams.get("audioFailed") ? (
        <p
          className="rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          role="status"
        >
          {t("audio.preparationPartial", {
            count: Number(searchParams.get("audioFailed")),
          })}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label={t("lesson.cards")} value={String(summary.cardCount)} />
        <Metric
          label={t("lesson.learned")}
          value={`${summary.learnedCount} / ${summary.cardCount}`}
        />
        <Metric
          label={t("lesson.accuracy")}
          value={formatAccuracy(summary.averageAccuracy)}
        />
        <Metric
          label={t("lesson.averageTime")}
          value={formatDuration(summary.averageResponseTimeMs)}
        />
      </dl>
      <LessonReadinessPanel lesson={lesson} cards={cards} />

      <section className="flex flex-col gap-3 rounded-2xl bg-slate-100 p-4 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Link
            aria-disabled={preparingAudio}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 font-semibold text-white hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 ${preparingAudio ? "pointer-events-none opacity-50" : ""}`}
            onClick={(event) => {
              if (preparingAudio) event.preventDefault();
            }}
            tabIndex={preparingAudio ? -1 : undefined}
            to={`/lessons/${lesson.id}/learn`}
          >
            <BookOpen size={18} aria-hidden="true" />
            {t("lesson.learn")}
          </Link>
          <Link
            aria-disabled={preparingAudio}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 font-semibold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 ${preparingAudio ? "pointer-events-none opacity-50" : ""}`}
            onClick={(event) => {
              if (preparingAudio) event.preventDefault();
            }}
            tabIndex={preparingAudio ? -1 : undefined}
            to={`/lessons/${lesson.id}/automate`}
          >
            <Shuffle size={18} aria-hidden="true" />
            {t("lesson.automate")}
          </Link>
          {contentType === "symbols" ? (
            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 font-semibold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950"
              to={`/lessons/${lesson.id}/handwriting`}
            >
              <PenTool size={18} aria-hidden="true" />
              {t("handwriting.practice")}
            </Link>
          ) : null}
        </div>
        <details>
          <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-sm font-semibold hover:bg-white dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
            {t("lesson.visibleTranslations")}
          </summary>
          <fieldset className="mt-2 flex flex-wrap items-center gap-2">
            <legend className="sr-only">{t("lesson.visibleTranslations")}</legend>
            {lesson.translationLanguages.map((language) => {
              const checked = lesson.visibleTranslationLanguages.includes(language);
              return (
                <label key={language} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      void setTranslationVisibility(language, event.target.checked);
                    }}
                  />
                  {language.toUpperCase()}
                </label>
              );
            })}
          </fieldset>
        </details>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-bold">{t("lesson.cards")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setSelectionMode((value) => !value);
                setSelected(new Set());
              }}
            >
              {selectionMode
                ? t("lesson.cancelSelection")
                : t("lesson.selectCards")}
            </Button>
            <label className="text-sm font-semibold">
              <span className="sr-only">{t("lesson.sort")}</span>
              <select
                aria-label={t("lesson.sort")}
                className={`${inputClassName} w-auto`}
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
              >
                <option value="alphabetical">{t("lesson.alphabetical")}</option>
                <option value="lowest">{t("lesson.lowestAccuracy")}</option>
                <option value="highest">{t("lesson.highestAccuracy")}</option>
                <option value="slowest">{t("lesson.slowest")}</option>
                <option value="fastest">{t("lesson.fastest")}</option>
                <option value="errors">{t("lesson.mostErrors")}</option>
              </select>
            </label>
          </div>
        </div>
        {cards.length === 0 ? (
          <p>{t("lesson.noCards")}</p>
        ) : (
          <ul className="grid gap-3">
            {sortedCards.map((card) => {
              const stat = statsByCard.get(card.id);
              const learned = progressByCard.get(card.id)?.learned ?? false;
              const readiness = getCardReadiness(card, lesson, audioAvailable);
              return (
                <li
                  key={card.id}
                  className={`grid items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 ${selectionMode ? "grid-cols-[auto_72px_1fr_auto]" : "grid-cols-[72px_1fr_auto]"}`}
                >
                  {selectionMode ? (
                    <input
                      className="h-5 w-5 accent-sky-600"
                      type="checkbox"
                      aria-label={`${t("common.selected")}: ${card.target}`}
                      checked={selected.has(card.id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(card.id);
                          else next.delete(card.id);
                          return next;
                        })
                      }
                    />
                  ) : null}
                  {lesson.useImages ? (
                    <CardImage
                      image={card.image}
                      className="h-16 w-[72px] rounded-xl"
                    />
                  ) : (
                    <div aria-hidden="true" className="h-16 w-[72px]" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        className="text-lg font-bold text-slate-950 hover:text-sky-700 hover:underline dark:text-white dark:hover:text-sky-300"
                        to={`/lessons/${lesson.id}/cards/${card.id}`}
                      >
                        <TargetText {...card} />
                      </Link>
                      {learned ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                          {t("lesson.learned")}
                        </span>
                      ) : null}
                      {markedCardIds.has(card.id) ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                          {t("training.difficultMarked")}
                        </span>
                      ) : null}
                      {readiness.issues.length > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                          {readiness.issues
                            .map((issue) =>
                              issue === "missing-translation"
                                ? `${t("card.missingTranslation")}: ${readiness.missingTranslationLanguages.join(", ").toUpperCase()}`
                                : t("card.audioUnavailable"),
                            )
                            .join(", ")}
                        </span>
                      ) : null}
                      {lesson.useImages && !card.image ? (
                        <span className="text-xs text-slate-500">
                          {t("card.missingImage")} ({t("card.optional")})
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                      {lesson.translationLanguages.map((language) => (
                        <span key={language}>
                          <b>{language.toUpperCase()}:</b>{" "}
                          {card.translations[language] || "—"}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("lesson.questions")}: {stat?.totalCompletedQuestions ?? 0} ·{" "}
                      {t("lesson.errors")}: {stat?.errorCount ?? 0} ·{" "}
                      {t("lesson.accuracy")}:{" "}
                      {formatAccuracy(stat ? calculateAccuracy(stat) : null)} ·{" "}
                      {t("lesson.averageTime")}:{" "}
                      {formatDuration(stat?.averageResponseTimeMs ?? null)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={markedCardIds.has(card.id)
                        ? `${t("training.unmarkDifficult")}: ${card.target}`
                        : `${t("training.markDifficult")}: ${card.target}`}
                      title={markedCardIds.has(card.id)
                        ? t("training.unmarkDifficult")
                        : t("training.markDifficult")}
                      className={`rounded-xl p-2 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-amber-950 ${markedCardIds.has(card.id) ? "text-amber-600 dark:text-amber-300" : "text-slate-500 dark:text-slate-400"}`}
                      onClick={() => void cardStudyMarkerRepository.setMarked(
                        card.id,
                        !markedCardIds.has(card.id),
                      )}
                    >
                      <Flag size={18} aria-hidden="true" fill={markedCardIds.has(card.id) ? "currentColor" : "none"} />
                    </button>
                    <button
                      type="button"
                      aria-label={`${t("audio.play")}: ${card.target}`}
                      className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
                      onClick={() =>
                        void playCardAudio(card, lesson).catch(() => undefined)
                      }
                    >
                      <Volume2 size={18} aria-hidden="true" />
                    </button>
                    <details className="relative">
                      <summary
                        aria-label={`${t("common.moreActions")}: ${card.target}`}
                        className="grid size-9 cursor-pointer list-none place-items-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden"
                      >
                        <MoreHorizontal size={18} aria-hidden="true" />
                      </summary>
                      <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                        <button
                          type="button"
                          disabled={resettingStatistics || !stat}
                          className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
                          onClick={() => void resetCardStatistics(card.id, card.target)}
                        >
                          <RotateCcw size={15} aria-hidden="true" />
                          {t("lesson.resetCardStatistics")}
                        </button>
                      </div>
                    </details>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selected.size > 0 ? (
        <section className="sticky bottom-4 rounded-2xl border border-sky-300 bg-white/95 p-4 shadow-xl backdrop-blur dark:border-sky-800 dark:bg-slate-900/95">
          <h2 className="font-bold">
            {t("lesson.createSelected")} ({selected.size})
          </h2>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className={inputClassName}
              value={newName}
              placeholder={t("lesson.selectedName")}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button
              disabled={!newName.trim()}
              onClick={() => void createFromSelection()}
            >
              {t("lesson.createSelected")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-2xl font-black">{value}</dd>
    </div>
  );
}

function compareCards(
  a: Card,
  b: Card,
  mode: SortMode,
  stats: Map<
    string,
    {
      errorCount: number;
      averageResponseTimeMs: number | null;
      correctCount: number;
    }
  >,
) {
  const as = stats.get(a.id);
  const bs = stats.get(b.id);
  const accuracy = (value: typeof as) =>
    value ? (calculateAccuracy(value) ?? 101) : 101;
  if (mode === "lowest") return accuracy(as) - accuracy(bs);
  if (mode === "highest") return accuracy(bs) - accuracy(as);
  if (mode === "errors") return (bs?.errorCount ?? 0) - (as?.errorCount ?? 0);
  if (mode === "slowest")
    return (
      (bs?.averageResponseTimeMs ?? -1) - (as?.averageResponseTimeMs ?? -1)
    );
  if (mode === "fastest")
    return (
      (as?.averageResponseTimeMs ?? Number.MAX_SAFE_INTEGER) -
      (bs?.averageResponseTimeMs ?? Number.MAX_SAFE_INTEGER)
    );
  return a.target.localeCompare(b.target);
}
