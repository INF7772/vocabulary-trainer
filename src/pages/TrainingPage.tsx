import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  Check,
  Flag,
  Headphones,
  LibraryBig,
  Play,
  Settings2,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { FeedbackBanner } from "../components/FeedbackBanner";
import { HandwritingPad } from "../components/HandwritingPad";
import { KeyboardShortcutBadge } from "../components/KeyboardShortcutBadge";
import { MeaningBlock } from "../components/MeaningBlock";
import { PageHeader } from "../components/PageHeader";
import { PracticeViewport } from "../components/PracticeViewport";
import { TargetText } from "../components/TargetText";
import { Button } from "../components/ui/Button";
import { inputClassName } from "../components/ui/FormField";
import {
  acceptRejectedTrainingAnswer,
  answerTrainingChoice,
  answerTrainingTyping,
  correctUnknownCompletionDelta,
  createTrainingSession,
  giveUpTrainingQuestion,
  isAudioPromptTrainingExercise,
  isChoiceTrainingExercise,
  resumeTraining,
  reverseErrorDeltas,
  resolveTrainingSelection,
  shuffle,
  type Card,
  type GlobalCardStatistics,
  type Lesson,
  type PracticeCard,
  type StatisticsDelta,
  type HandwritingDrawing,
  type TrainingExerciseType,
  type TrainingQuickSelection,
  type TrainingState,
} from "../domain";
import {
  cardStudyMarkerRepository,
  lessonsRepository,
  statisticsRepository,
} from "../data";
import { playCardAudio } from "../services/audio";
import {
  compareHandwriting,
  type HandwritingComparison,
} from "../services/handwriting-comparison";
import {
  formatVisibleTranslations,
  markAmbiguousHandwritingMeanings,
  toPracticeCards,
} from "../services/lesson-data";
import { getUserErrorKey } from "../services/errors";
import {
  choiceShortcutIndex,
  isEditableKeyboardTarget,
} from "../utils/keyboard";

type CardOrder = "random" | "alphabetical" | "errors" | "slowest";
type Preset =
  | "new"
  | "errors"
  | "speed"
  | "dictation"
  | "learned"
  | "exam"
  | "custom";

interface TrainingItem {
  card: Card;
  lesson: Lesson;
  learned: boolean;
  markedForStudy: boolean;
  statistics?: GlobalCardStatistics;
}

const QUICK_SELECTIONS: TrainingQuickSelection[] = [
  "all",
  "new",
  "learned",
  "difficult",
  "low-accuracy",
  "recent-errors",
];

const EXERCISE_TYPES: TrainingExerciseType[] = [
  "meaning-choice",
  "word-choice",
  "audio-choice",
  "audio-typing",
  "meaning-typing",
];

export function TrainingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialLessonId = searchParams.get("lesson");
  const initialLanguage = searchParams.get("language");
  const initialSelection = searchParams.get("selection") as
    | TrainingQuickSelection
    | null;
  const data = useLiveQuery(async () => {
    const [lessons, statistics, studyMarkers] = await Promise.all([
      lessonsRepository.list(),
      statisticsRepository.list(),
      cardStudyMarkerRepository.list(),
    ]);
    const sources = await Promise.all(
      lessons.map(async (lesson) => ({
        lesson,
        cards: await lessonsRepository.listCards(lesson.id),
        progress: await lessonsRepository.listProgress(lesson.id),
      })),
    );
    return { sources, statistics, studyMarkers };
  }, []);

  const composing = useRef(false);
  const [lessonIds, setLessonIds] = useState<Set<string>>(
    new Set(initialLessonId ? [initialLessonId] : []),
  );
  const [excludedInitialLessonIds, setExcludedInitialLessonIds] = useState<
    Set<string>
  >(new Set());
  const [preset, setPreset] = useState<Preset>("custom");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [activeSelections, setActiveSelections] = useState<
    Set<TrainingQuickSelection>
  >(
    new Set(
      initialSelection && QUICK_SELECTIONS.includes(initialSelection)
        ? [initialSelection]
        : ["all"],
    ),
  );
  const [manuallyIncludedCardIds, setManuallyIncludedCardIds] = useState<
    Set<string>
  >(new Set());
  const [manuallyExcludedCardIds, setManuallyExcludedCardIds] = useState<
    Set<string>
  >(new Set());
  const [accuracyLimit, setAccuracyLimit] = useState(80);
  const [order, setOrder] = useState<CardOrder>("random");
  const [exerciseTypes, setExerciseTypes] = useState<Set<TrainingExerciseType>>(
    new Set(["meaning-choice", "word-choice", "meaning-typing"]),
  );
  const [wordLimit, setWordLimit] = useState(20);
  const [playAudioAfterAnswer, setPlayAudioAfterAnswer] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cardSearch, setCardSearch] = useState("");
  const [sessionCards, setSessionCards] = useState<TrainingItem[]>([]);
  const [session, setSession] = useState<TrainingState | null>(null);
  const [pendingSession, setPendingSession] =
    useState<TrainingState | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "incorrect" | "gave-up" | null>(
    null,
  );
  const [rejectedAnswer, setRejectedAnswer] = useState<{
    kind: "rejected" | "gave-up";
    stateBefore: TrainingState;
    statisticsDeltas: StatisticsDelta[];
  } | null>(null);
  const [selectedWrongCardId, setSelectedWrongCardId] = useState<string | null>(
    null,
  );
  const [answerText, setAnswerText] = useState("");
  const [drawing, setDrawing] = useState<HandwritingDrawing>([]);
  const [drawingReview, setDrawingReview] = useState(false);
  const [handwritingComparison, setHandwritingComparison] =
    useState<HandwritingComparison | null>(null);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [newLessonName, setNewLessonName] = useState("");
  const [creatingLesson, setCreatingLesson] = useState(false);

  const effectiveLessonIds = useMemo(() => {
    const result = new Set(lessonIds);
    if (initialLanguage) {
      for (const { lesson } of data?.sources ?? []) {
        if (
          lesson.targetLanguage === initialLanguage &&
          !excludedInitialLessonIds.has(lesson.id)
        ) {
          result.add(lesson.id);
        }
      }
    }
    return result;
  }, [data, excludedInitialLessonIds, initialLanguage, lessonIds]);
  const selectedSources = useMemo(
    () =>
      data?.sources.filter(({ lesson }) => effectiveLessonIds.has(lesson.id)) ?? [],
    [data, effectiveLessonIds],
  );
  const targetLanguage = selectedSources[0]?.lesson.targetLanguage;
  const statisticsByCard = useMemo(
    () => new Map(data?.statistics.map((item) => [item.cardId, item]) ?? []),
    [data],
  );
  const markedCardIds = useMemo(
    () => new Set(data?.studyMarkers.map((item) => item.cardId) ?? []),
    [data],
  );
  const availableItems = useMemo(() => {
    const byCard = new Map<string, TrainingItem>();
    for (const source of selectedSources) {
      const progress = new Map(
        source.progress.map((item) => [item.cardId, item]),
      );
      for (const card of source.cards) {
        const existing = byCard.get(card.id);
        const learned = progress.get(card.id)?.learned ?? false;
        if (existing) {
          existing.learned ||= learned;
          continue;
        }
        byCard.set(card.id, {
          card,
          lesson: source.lesson,
          learned,
          markedForStudy: markedCardIds.has(card.id),
          statistics: statisticsByCard.get(card.id),
        });
      }
    }
    return [...byCard.values()];
  }, [markedCardIds, selectedSources, statisticsByCard]);
  const selectedCardIds = useMemo(
    () =>
      resolveTrainingSelection({
        cards: availableItems.map((item) => ({
          cardId: item.card.id,
          learned: item.learned,
          markedForStudy: item.markedForStudy,
          statistics: item.statistics,
        })),
        activeSelections,
        manuallyIncludedCardIds,
        manuallyExcludedCardIds,
        accuracyLimit,
        nowMs,
      }),
    [
      accuracyLimit,
      activeSelections,
      availableItems,
      manuallyExcludedCardIds,
      manuallyIncludedCardIds,
      nowMs,
    ],
  );
  const selectedItems = useMemo(() => {
    const items = availableItems.filter((item) =>
      selectedCardIds.has(item.card.id),
    );
    return [...items].sort((left, right) => {
      if (order === "errors") {
        return (
          (right.statistics?.errorCount ?? 0) -
          (left.statistics?.errorCount ?? 0)
        );
      }
      if (order === "slowest") {
        return (
          (right.statistics?.averageResponseTimeMs ?? 0) -
          (left.statistics?.averageResponseTimeMs ?? 0)
        );
      }
      if (order === "alphabetical") {
        return left.card.target.localeCompare(right.card.target);
      }
      return 0;
    });
  }, [availableItems, order, selectedCardIds]);
  const visibleCardPickerItems = useMemo(() => {
    const query = cardSearch.trim().toLocaleLowerCase();
    if (!query) return availableItems;
    return availableItems.filter(
      ({ card, lesson }) =>
        card.target.toLocaleLowerCase().includes(query) ||
        formatVisibleTranslations(card, lesson)
          .toLocaleLowerCase()
          .includes(query),
    );
  }, [availableItems, cardSearch]);
  const practiceCards = useMemo<PracticeCard[]>(
    () =>
      markAmbiguousHandwritingMeanings(
        sessionCards.flatMap(({ card, lesson }) =>
          toPracticeCards([card], lesson),
        ),
      ),
    [sessionCards],
  );
  const sessionItemsById = useMemo(
    () => new Map(sessionCards.map((item) => [item.card.id, item])),
    [sessionCards],
  );
  const activeQuestion = session?.currentQuestion;

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeQuestion || !isAudioPromptTrainingExercise(activeQuestion.exerciseType)) {
      return;
    }
    const item = sessionItemsById.get(activeQuestion.cardId);
    if (!item) return;
    void playCardAudio(item.card, item.lesson).catch(() => {
      setStatus(t("training.audioFailed"));
    });
  }, [activeQuestion?.sequence, activeQuestion, sessionItemsById, t]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (locked && pendingSession && event.key === "Enter") {
        if (!isEditableKeyboardTarget(event.target)) {
          event.preventDefault();
          continueToNextQuestion();
        }
        return;
      }
      if (!session?.currentQuestion || locked) return;
      if (event.key === "Escape") {
        setSession(null);
        return;
      }
      if (
        event.code === "Space" &&
        !isEditableKeyboardTarget(event.target)
      ) {
        event.preventDefault();
        void replayAudio();
      }
      if (isChoiceTrainingExercise(session.currentQuestion.exerciseType)) {
        const index = choiceShortcutIndex(event);
        const cardId =
          index === null
            ? undefined
            : session.currentQuestion.optionCardIds[index];
        if (cardId) {
          event.preventDefault();
          void submitChoice(cardId);
        }
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
    // Handlers intentionally observe the same session snapshot as the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, pendingSession, session]);

  if (!data) return <p>{t("common.loading")}</p>;
  if (data.sources.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("training.title")} description={t("training.noLessons")} />
        <Link className="font-bold text-sky-700 dark:text-sky-300" to="/lessons/new">
          {t("home.createFirst")}
        </Link>
      </div>
    );
  }

  function toggleLesson(lesson: Lesson, checked: boolean) {
    setLessonIds((current) => {
      const next = new Set(current);
      if (checked) next.add(lesson.id);
      else next.delete(lesson.id);
      return next;
    });
    setExcludedInitialLessonIds((current) => {
      const next = new Set(current);
      if (checked) next.delete(lesson.id);
      else next.add(lesson.id);
      return next;
    });
    setSession(null);
  }

  function applyPreset(nextPreset: Preset) {
    setPreset(nextPreset);
    setCustomizeOpen(nextPreset === "custom");
    switch (nextPreset) {
      case "new":
        setActiveSelections(new Set(["new"]));
        setExerciseTypes(
          new Set(["meaning-choice", "word-choice", "meaning-typing"]),
        );
        setOrder("random");
        setWordLimit(20);
        break;
      case "errors":
        setActiveSelections(new Set(["difficult", "recent-errors"]));
        setExerciseTypes(new Set(["meaning-choice", "meaning-typing"]));
        setOrder("errors");
        setWordLimit(20);
        break;
      case "speed":
        setActiveSelections(new Set(["learned"]));
        setExerciseTypes(new Set(["meaning-choice", "word-choice"]));
        setOrder("random");
        setWordLimit(50);
        break;
      case "dictation":
        setActiveSelections(new Set(["all"]));
        setExerciseTypes(new Set(["audio-typing"]));
        setOrder("random");
        setWordLimit(20);
        break;
      case "learned":
        setActiveSelections(new Set(["learned"]));
        setExerciseTypes(
          new Set(["meaning-choice", "word-choice", "audio-choice"]),
        );
        setOrder("random");
        setWordLimit(20);
        break;
      case "exam":
        setActiveSelections(new Set(["all"]));
        setExerciseTypes(new Set(["audio-typing", "meaning-typing"]));
        setOrder("random");
        setWordLimit(50);
        break;
      case "custom":
        break;
    }
  }

  function toggleQuickSelection(selection: TrainingQuickSelection) {
    setPreset("custom");
    setActiveSelections((current) => {
      if (selection === "all") {
        return current.has("all") ? new Set() : new Set(["all"]);
      }
      const next = new Set(current);
      next.delete("all");
      if (next.has(selection)) next.delete(selection);
      else next.add(selection);
      return next;
    });
  }

  function setCardSelected(cardId: string, checked: boolean) {
    setPreset("custom");
    setManuallyIncludedCardIds((current) => {
      const next = new Set(current);
      if (checked) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
    setManuallyExcludedCardIds((current) => {
      const next = new Set(current);
      if (checked) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function toggleExercise(type: TrainingExerciseType, checked: boolean) {
    setPreset("custom");
    setExerciseTypes((current) => {
      const next = new Set(current);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  function startTraining() {
    if (effectiveLessonIds.size === 0 || selectedItems.length === 0) return;
    const selectedExercises = EXERCISE_TYPES.filter((type) =>
      exerciseTypes.has(type),
    );
    if (selectedExercises.length === 0) return;
    const ordered = order === "random" ? shuffle(selectedItems) : selectedItems;
    const chosen = ordered.slice(0, Math.min(wordLimit, ordered.length));
    setSessionCards(availableItems);
    const allPracticeCards = markAmbiguousHandwritingMeanings(
      availableItems.flatMap(({ card, lesson }) =>
        toPracticeCards([card], lesson),
      ),
    );
    setSession(
      createTrainingSession(
        markAmbiguousHandwritingMeanings(
          chosen.flatMap(({ card, lesson }) =>
            toPracticeCards([card], lesson),
          ),
        ),
        selectedExercises,
        {
          randomizeDeck: order === "random",
          choiceCandidates: allPracticeCards,
        },
      ),
    );
    setPendingSession(null);
    setFeedback(null);
    setSelectedWrongCardId(null);
    setRejectedAnswer(null);
    setAnswerText("");
    setDrawing([]);
    setDrawingReview(false);
    setHandwritingComparison(null);
    setLocked(false);
    setStatus(null);
  }

  async function submitChoice(cardId: string) {
    if (!session || locked) return;
    const stateBefore = session;
    setRejectedAnswer(null);
    const transition = answerTrainingChoice(session, practiceCards, cardId);
    const persistence = statisticsRepository.applyDeltas(
      transition.statisticsDeltas,
    );
    if (transition.feedback === "incorrect") {
      setSession(transition.state);
      setSelectedWrongCardId(cardId);
      setFeedback("incorrect");
      await persistence;
      setRejectedAnswer({
        kind: "rejected",
        stateBefore,
        statisticsDeltas: transition.statisticsDeltas,
      });
      return;
    }
    completeAnswer(transition.state, transition.answeredCardId);
    await persistence;
  }

  async function submitTyping(answer = answerText) {
    if (!session || locked || composing.current || !answer) return;
    const stateBefore = session;
    setRejectedAnswer(null);
    const transition = answerTrainingTyping(
      session,
      practiceCards,
      answer,
    );
    const persistence = statisticsRepository.applyDeltas(
      transition.statisticsDeltas,
    );
    if (transition.feedback === "incorrect") {
      setSession(transition.state);
      setFeedback("incorrect");
      await persistence;
      setRejectedAnswer({
        kind: "rejected",
        stateBefore,
        statisticsDeltas: transition.statisticsDeltas,
      });
      return;
    }
    completeAnswer(transition.state, transition.answeredCardId);
    await persistence;
  }

  function completeAnswer(
    next: TrainingState,
    cardId: string,
    result: "correct" | "gave-up" = "correct",
  ) {
    setLocked(true);
    setFeedback(result);
    setRejectedAnswer(null);
    setPendingSession(next);
    const item = sessionItemsById.get(cardId);
    if (
      item &&
      playAudioAfterAnswer &&
      !isAudioPromptTrainingExercise(
        session?.currentQuestion?.exerciseType ?? "meaning-choice",
      )
    ) {
      void playCardAudio(item.card, item.lesson).catch(() => undefined);
    }
  }

  async function acceptRejectedAnswer() {
    if (!rejectedAnswer || (locked && rejectedAnswer.kind !== "gave-up")) {
      return;
    }
    const corrected = acceptRejectedTrainingAnswer(
      rejectedAnswer.stateBefore,
      practiceCards,
    );
    setRejectedAnswer(null);
    await statisticsRepository.applyDeltas(
      rejectedAnswer.kind === "gave-up"
        ? [
            correctUnknownCompletionDelta(
              corrected.answeredCardId,
              rejectedAnswer.statisticsDeltas.reduce(
                (total, delta) => total + delta.errorCount,
                0,
              ),
            ),
          ]
        : [
            ...reverseErrorDeltas(rejectedAnswer.statisticsDeltas),
            ...corrected.statisticsDeltas,
          ],
    );
    completeAnswer(corrected.state, corrected.answeredCardId);
  }

  async function giveUp() {
    if (!session || locked) return;
    const stateBefore = session;
    setRejectedAnswer(null);
    const transition = giveUpTrainingQuestion(session, practiceCards);
    await statisticsRepository.applyDeltas(transition.statisticsDeltas);
    completeAnswer(
      transition.state,
      transition.answeredCardId,
      "gave-up",
    );
    setRejectedAnswer({
      kind: "gave-up",
      stateBefore,
      statisticsDeltas: transition.statisticsDeltas,
    });
  }

  function continueToNextQuestion() {
    if (!pendingSession) return;
    setSession(resumeTraining(pendingSession));
    setPendingSession(null);
    setFeedback(null);
    setSelectedWrongCardId(null);
    setRejectedAnswer(null);
    setAnswerText("");
    setDrawing([]);
    setDrawingReview(false);
    setHandwritingComparison(null);
    setLocked(false);
    setStatus(null);
  }

  async function replayAudio() {
    const cardId = session?.currentQuestion?.cardId;
    const item = cardId ? sessionItemsById.get(cardId) : undefined;
    if (!item) return;
    setStatus(null);
    try {
      await playCardAudio(item.card, item.lesson);
    } catch {
      setStatus(t("training.audioFailed"));
    }
  }

  async function createLessonFromSelection() {
    const chosen = availableItems.filter(({ card }) =>
      selectedCardIds.has(card.id),
    );
    const base = chosen[0]?.lesson;
    if (!base || !newLessonName.trim()) return;
    setCreatingLesson(true);
    setStatus(null);
    try {
      const possibleLanguages = [
        ...new Set(
          selectedSources.flatMap(({ lesson }) => lesson.translationLanguages),
        ),
      ];
      const completeLanguages = possibleLanguages.filter((language) =>
        chosen.every(({ card }) => card.translations[language]?.trim()),
      );
      const translationLanguages = completeLanguages.length
        ? completeLanguages
        : base.translationLanguages;
      const activeTranslationLanguage = translationLanguages.includes(
        base.activeTranslationLanguage,
      )
        ? base.activeTranslationLanguage
        : (translationLanguages[0] as string);
      const created = await lessonsRepository.create({
        name: newLessonName.trim(),
        targetLanguage: base.targetLanguage,
        translationLanguages,
        activeTranslationLanguage,
        visibleTranslationLanguages: translationLanguages,
        useImages: base.useImages,
        tts: base.tts,
      });
      for (const { card } of chosen) {
        await lessonsRepository.addCard(created.id, card.id);
      }
      navigate(`/lessons/${created.id}?review=1`);
    } catch (error) {
      setStatus(t(getUserErrorKey(error)));
      setCreatingLesson(false);
    }
  }

  if (!session) {
    const choiceNeedsMoreCards =
      [...exerciseTypes].some(isChoiceTrainingExercise) &&
      availableItems.length < 2;
    const canStart =
      effectiveLessonIds.size > 0 &&
      selectedItems.length > 0 &&
      exerciseTypes.size > 0 &&
      !choiceNeedsMoreCards;
    const effectiveWordLimit = Math.min(wordLimit, selectedItems.length);
    const plannedExerciseCount = effectiveWordLimit * exerciseTypes.size;
    return (
      <div className="space-y-7">
        <Link className="inline-flex items-center gap-2 text-sm font-semibold" to="/">
          <ArrowLeft size={17} aria-hidden="true" /> {t("common.back")}
        </Link>
        <PageHeader title={t("training.title")} description={t("training.body")} />

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xl font-black">{t("training.presets")}</h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {(["new", "errors", "dictation", "custom"] as const).map((value) => (
              <ChoiceTile
                key={value}
                checked={preset === value}
                label={t(`training.preset.${value}`)}
                type="radio"
                onChange={() => applyPreset(value)}
              />
            ))}
          </div>
          <details className="rounded-xl border border-slate-200 dark:border-slate-700">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-slate-600 dark:text-slate-300 [&::-webkit-details-marker]:hidden">
              {t("common.moreActions")}
            </summary>
            <div className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-3 dark:border-slate-700">
              {(["speed", "learned", "exam"] as const).map((value) => (
                <ChoiceTile
                  key={value}
                  checked={preset === value}
                  label={t(`training.preset.${value}`)}
                  type="radio"
                  onChange={() => applyPreset(value)}
                />
              ))}
            </div>
          </details>
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xl font-black">{t("training.sources")}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("training.sameLanguageHint")}
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {data.sources.map(({ lesson, cards }) => {
              const checked = effectiveLessonIds.has(lesson.id);
              const incompatible = Boolean(
                targetLanguage && lesson.targetLanguage !== targetLanguage,
              );
              return (
                <ChoiceTile
                  key={lesson.id}
                  checked={checked}
                  disabled={!checked && incompatible}
                  label={`${lesson.name} · ${lesson.targetLanguage.toUpperCase()} · ${cards.length}`}
                  onChange={() => toggleLesson(lesson, !checked)}
                />
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl border border-sky-200 bg-sky-50 p-5 dark:border-sky-900 dark:bg-sky-950 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black">{t("training.sessionSummary")}</h2>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
              {t("training.sessionPlan", {
                selected: selectedItems.length,
                words: effectiveWordLimit,
                formats: exerciseTypes.size,
              })}
            </p>
          </div>
          <Button
            variant="secondary"
            icon={<Settings2 size={18} aria-hidden="true" />}
            onClick={() => setCustomizeOpen((value) => !value)}
          >
            {customizeOpen
              ? t("training.hideSettings")
              : t("training.customize")}
          </Button>
        </section>

        {customizeOpen ? (
          <>
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-xl font-black">{t("training.cards")}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("training.quickSelectionBody")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {QUICK_SELECTIONS.map((value) => (
                <ChoiceTile
                  key={value}
                  checked={activeSelections.has(value)}
                  label={t(`training.filterOption.${value}`)}
                  onChange={() => toggleQuickSelection(value)}
                />
              ))}
            </div>
            {activeSelections.has("low-accuracy") ? (
              <label className="block text-sm font-semibold">
                {t("training.accuracyBelow", { value: accuracyLimit })}
                <input
                  className="mt-3 w-full accent-sky-600"
                  min="10"
                  max="100"
                  step="5"
                  type="range"
                  value={accuracyLimit}
                  onChange={(event) => setAccuracyLimit(Number(event.target.value))}
                />
              </label>
            ) : null}
            <label className="block text-sm font-semibold">
              {t("training.order")}
              <select
                className={`${inputClassName} mt-2`}
                value={order}
                onChange={(event) => {
                  setPreset("custom");
                  setOrder(event.target.value as CardOrder);
                }}
              >
                {(["random", "alphabetical", "errors", "slowest"] as const).map((value) => (
                  <option key={value} value={value}>{t(`training.orderOption.${value}`)}</option>
                ))}
              </select>
            </label>
            <p className="rounded-xl bg-sky-50 p-3 font-bold text-sky-900 dark:bg-sky-950 dark:text-sky-100">
              {t("training.cardCount", { count: selectedItems.length })}
            </p>
          </section>

          <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-xl font-black">{t("training.exercises")}</h2>
            <div className="grid gap-2">
              {EXERCISE_TYPES.map((type) => (
                <ChoiceTile
                  key={type}
                  checked={exerciseTypes.has(type)}
                  label={t(`training.exercise.${type}`)}
                  onChange={() => toggleExercise(type, !exerciseTypes.has(type))}
                />
              ))}
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-semibold" htmlFor="training-word-count">
                {t("training.wordCount")}
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3">
                <input
                  aria-label={t("training.wordCount")}
                  className="w-full accent-sky-600"
                  disabled={selectedItems.length === 0}
                  id="training-word-count"
                  min="1"
                  max={Math.max(1, selectedItems.length)}
                  type="range"
                  value={Math.min(wordLimit, Math.max(1, selectedItems.length))}
                  onChange={(event) => {
                    setPreset("custom");
                    setWordLimit(Number(event.target.value));
                  }}
                />
                <input
                  aria-label={t("training.wordCount")}
                  className={inputClassName}
                  disabled={selectedItems.length === 0}
                  min="1"
                  max={Math.max(1, selectedItems.length)}
                  type="number"
                  value={Math.min(wordLimit, Math.max(1, selectedItems.length))}
                  onChange={(event) => {
                    setPreset("custom");
                    setWordLimit(Math.max(1, Number(event.target.value) || 1));
                  }}
                />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t("training.plannedExercises", {
                  words: effectiveWordLimit,
                  exercises: plannedExerciseCount,
                })}
              </p>
            </div>
            <p className="rounded-xl bg-slate-50 p-3 text-sm font-semibold dark:bg-slate-800">
              {t("training.imagesAlways")}
            </p>
            <ChoiceTile
              checked={playAudioAfterAnswer}
              label={t("training.playAudio")}
              onChange={() => setPlayAudioAfterAnswer((value) => !value)}
            />
          </section>
        </div>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">{t("training.manualSelection")}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">{t("training.manualSelectionBody")}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold dark:bg-slate-800">
              {t("training.selectedCount", { count: selectedCardIds.size })}
            </span>
          </div>
          <input
            className={inputClassName}
            placeholder={t("training.searchCards")}
            value={cardSearch}
            onChange={(event) => setCardSearch(event.target.value)}
          />
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {visibleCardPickerItems.map(({ card, lesson, learned, markedForStudy }) => (
              <label key={card.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <input
                  className="mt-1 h-5 w-5 accent-sky-600"
                  type="checkbox"
                  checked={selectedCardIds.has(card.id)}
                  onChange={(event) => setCardSelected(card.id, event.target.checked)}
                />
                <span className="min-w-0">
                  <strong><TargetText {...card} /></strong>
                  <span className="ml-2 text-sm text-slate-500">{formatVisibleTranslations(card, lesson, " · ")}</span>
                  {learned ? <span className="ml-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">{t("lesson.learned")}</span> : null}
                  {markedForStudy ? <span className="ml-2 text-xs font-bold text-amber-700 dark:text-amber-300">{t("training.difficultMarked")}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              className={inputClassName}
              placeholder={t("lesson.selectedName")}
              value={newLessonName}
              onChange={(event) => setNewLessonName(event.target.value)}
            />
            <Button
              disabled={creatingLesson || selectedCardIds.size === 0 || !newLessonName.trim()}
              variant="secondary"
              icon={<LibraryBig size={18} aria-hidden="true" />}
              onClick={() => void createLessonFromSelection()}
            >
              {t("lesson.createSelected")}
            </Button>
          </div>
        </section>
          </>
        ) : null}

        {status ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">{status}</p> : null}
        {choiceNeedsMoreCards ? <p role="alert" className="text-sm font-semibold text-amber-700 dark:text-amber-300">{t("training.needTwoCards")}</p> : null}
        <section className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <Button className="w-full" disabled={!canStart} icon={<Play size={18} aria-hidden="true" />} onClick={startTraining}>
            {t("training.start")}
          </Button>
        </section>
      </div>
    );
  }

  if (session.status !== "active" || !session.currentQuestion) {
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-emerald-300 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <Check className="mx-auto text-emerald-600" size={40} aria-hidden="true" />
        <h1 className="mt-4 text-3xl font-black">{t("training.complete")}</h1>
        <p className="mt-2">{t("training.completedCount", { count: session.completedQuestionCount })}</p>
        <Button className="mt-6" onClick={() => setSession(null)}>{t("training.backToBuilder")}</Button>
      </section>
    );
  }

  const question = session.currentQuestion;
  const expectedItem = sessionItemsById.get(question.cardId)!;
  const expectedPractice = practiceCards.find(
    (card) => card.id === question.cardId,
  );
  const kanaChoice = Boolean(
    expectedPractice?.isKanaStudy &&
      isChoiceTrainingExercise(question.exerciseType),
  );
  const romajiTyping = Boolean(expectedPractice?.acceptedTypingAnswers?.length);
  const handwriting = Boolean(
    expectedPractice?.requiresHandwriting &&
      !isChoiceTrainingExercise(question.exerciseType),
  );
  const options = question.optionCardIds
    .map((id) => sessionItemsById.get(id))
    .filter((item): item is TrainingItem => Boolean(item));
  const typing = !isChoiceTrainingExercise(question.exerciseType);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex items-center justify-between gap-3">
        <strong>{t("training.title")}</strong>
        <Button variant="ghost" onClick={() => setSession(null)}>{t("quick.stop")}</Button>
      </header>
      <p className="text-center font-semibold">
        {t("quick.progress", {
          current: session.completedQuestionCount + 1,
          total: session.totalQuestionCount,
        })}
      </p>
      <PracticeViewport>
        <main className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {question.exerciseType === "meaning-choice" || question.exerciseType === "meaning-typing" ? (
            <MeaningBlock
              card={expectedItem.card}
              translationLanguage={expectedItem.lesson.activeTranslationLanguage}
              translationLanguages={expectedItem.lesson.visibleTranslationLanguages}
              showImage
            />
          ) : null}
          {question.exerciseType === "word-choice" ? (
            <h1 className="mb-6 text-center text-4xl font-black"><TargetText {...expectedItem.card} /></h1>
          ) : null}
          {isAudioPromptTrainingExercise(question.exerciseType) ? (
            <div className="mb-6 rounded-3xl bg-sky-50 p-8 text-center dark:bg-sky-950">
              <Headphones className="mx-auto text-sky-600 dark:text-sky-300" size={52} aria-hidden="true" />
              <p className="mt-3 font-bold">{t("training.listenPrompt")}</p>
              <Button className="mt-4" variant="secondary" icon={<Volume2 size={18} />} onClick={() => void replayAudio()}>{t("learn.replay")}</Button>
            </div>
          ) : null}

          {isChoiceTrainingExercise(question.exerciseType) ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {options.map((item, index) => {
                const targetOption =
                  question.exerciseType === "meaning-choice" ||
                  (kanaChoice && question.exerciseType === "audio-choice");
                return targetOption ? (
                  <button
                    key={item.card.id}
                    aria-label={`${index + 1}. ${item.card.target}`}
                    disabled={locked || selectedWrongCardId === item.card.id}
                    className={`${kanaChoice ? "relative min-h-28 text-center text-5xl font-medium" : "min-h-14 px-4 text-left text-lg font-bold"} rounded-2xl border outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${selectedWrongCardId === item.card.id ? "border-red-500 bg-red-50 dark:bg-red-950" : "border-slate-300 hover:border-sky-500 dark:border-slate-700"}`}
                    onClick={() => void submitChoice(item.card.id)}
                  >
                    <span className={kanaChoice ? "absolute left-2 top-2" : "mr-3"}><KeyboardShortcutBadge number={index + 1} /></span>
                    <TargetText {...item.card} />
                  </button>
                ) : (
                  <button
                    key={item.card.id}
                    aria-label={`${index + 1}. ${formatVisibleTranslations(item.card, item.lesson, ", ")}`}
                    disabled={locked || selectedWrongCardId === item.card.id}
                    className={`relative rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${selectedWrongCardId === item.card.id ? "ring-2 ring-red-500 opacity-70" : ""}`}
                    onClick={() => void submitChoice(item.card.id)}
                  >
                    <span className="absolute left-2 top-2 z-10"><KeyboardShortcutBadge number={index + 1} /></span>
                    <MeaningBlock
                      compact
                      card={item.card}
                      translationLanguage={item.lesson.activeTranslationLanguage}
                      translationLanguages={item.lesson.visibleTranslationLanguages}
                      showImage
                    />
                  </button>
                );
              })}
            </div>
          ) : null}

          {typing && handwriting ? (
            <div className="mt-5 space-y-4">
              <p className="text-center font-semibold">{t("handwriting.drawPrompt")}</p>
              <HandwritingPad
                disabled={drawingReview || locked}
                drawing={drawing}
                onChange={setDrawing}
              />
              {!drawingReview ? (
                <Button
                  className="w-full"
                  disabled={!drawing.some((stroke) => stroke.length > 0)}
                  onClick={() => {
                    setHandwritingComparison(
                      compareHandwriting(
                        drawing,
                        expectedPractice?.acceptedDrawingTargets ?? [
                          expectedItem.card.target,
                        ],
                      ),
                    );
                    setDrawingReview(true);
                  }}
                  type="button"
                >
                  {t("handwriting.showAnswer")}
                </Button>
              ) : !locked ? (
                <div className="space-y-3">
                  {handwritingComparison ? (
                    <FeedbackBanner
                      kind={handwritingComparison.isMatch ? "success" : "error"}
                      text={t(
                        handwritingComparison.isMatch
                          ? "handwriting.autoMatch"
                          : "handwriting.autoMismatch",
                        { score: Math.round(handwritingComparison.score * 100) },
                      )}
                    />
                  ) : null}
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-center dark:border-sky-800 dark:bg-sky-950">
                    <p className="text-sm font-semibold">{t("handwriting.compare")}</p>
                    <p className="mt-2 text-7xl font-medium"><TargetText {...expectedItem.card} /></p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button onClick={() => void submitTyping(expectedItem.card.target)} type="button" variant={handwritingComparison?.isMatch ? "primary" : "secondary"}>
                      {handwritingComparison?.isMatch ? t("handwriting.confirmMatch") : t("handwriting.systemWrongMatch")}
                    </Button>
                    <Button onClick={() => void giveUp()} type="button" variant={handwritingComparison?.isMatch ? "secondary" : "primary"}>
                      {handwritingComparison?.isMatch ? t("handwriting.systemWrongMismatch") : t("handwriting.confirmMismatch")}
                    </Button>
                  </div>
                  <div className="flex justify-center">
                    <Button onClick={() => { setDrawing([]); setDrawingReview(false); setHandwritingComparison(null); }} type="button" variant="ghost">
                      {t("handwriting.tryAgain")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {typing && !handwriting ? (
            <form
              className="mt-5 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void submitTyping();
              }}
            >
              <input
                autoFocus
                className={`${inputClassName} text-center text-xl font-bold`}
                disabled={locked}
                placeholder={romajiTyping ? t("learn.typeJapaneseRomaji") : t("learn.typeAnswer")}
                value={answerText}
                onChange={(event) => setAnswerText(event.target.value)}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
              />
              <Button className="w-full" disabled={!answerText || locked} type="submit">{t("learn.submit")}</Button>
            </form>
          ) : null}

          {typing && !handwriting && romajiTyping ? (
            <p className="mt-2 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
              {t("learn.romajiHint")}
            </p>
          ) : null}

          {feedback ? (
            <div className="mt-4 space-y-3">
              <FeedbackBanner
                kind={feedback === "correct" ? "success" : "error"}
                text={
                  feedback === "correct"
                    ? t("learn.correct")
                    : feedback === "gave-up"
                      ? t("learn.answer", { answer: expectedItem.card.target })
                      : t("learn.incorrect")
                }
              />
              {feedback === "correct" || feedback === "gave-up" ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-center dark:border-sky-800 dark:bg-sky-950">
                  <p className="text-2xl font-black"><TargetText {...expectedItem.card} /></p>
                  <p className="mt-2 font-semibold">{formatVisibleTranslations(expectedItem.card, expectedItem.lesson, " · ")}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <Button
            className="mt-4 w-full"
            variant="ghost"
            icon={<Flag size={18} aria-hidden="true" />}
            onClick={() =>
              void cardStudyMarkerRepository.setMarked(
                expectedItem.card.id,
                !markedCardIds.has(expectedItem.card.id),
              )
            }
          >
            {markedCardIds.has(expectedItem.card.id)
              ? t("training.unmarkDifficult")
              : t("training.markDifficult")}
          </Button>
          {!locked && !pendingSession ? (
            <Button className="mt-4 w-full" variant="secondary" onClick={() => void giveUp()}>
              {t("learn.dontKnow")}
            </Button>
          ) : null}
          {rejectedAnswer &&
          (feedback === "incorrect" || rejectedAnswer.kind === "gave-up") ? (
            <Button className="mt-3 w-full" variant="secondary" onClick={() => void acceptRejectedAnswer()}>
              {t("learn.iWasCorrect")}
            </Button>
          ) : null}
          {status ? <p className="mt-3 text-center text-sm font-semibold text-amber-700 dark:text-amber-300" role="status">{status}</p> : null}
          {pendingSession ? <Button className="mt-4 w-full" onClick={continueToNextQuestion}>{t("common.next")}</Button> : null}
        </main>
      </PracticeViewport>
    </div>
  );
}

function ChoiceTile({
  checked,
  disabled = false,
  label,
  onChange,
  type = "checkbox",
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
  type?: "checkbox" | "radio";
}) {
  return (
    <label className={`flex min-h-12 items-center gap-3 rounded-xl border p-3 font-semibold ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"} ${checked ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-slate-200 dark:border-slate-700"}`}>
      <input type={type} checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );
}
