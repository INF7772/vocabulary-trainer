import { ArrowLeft, Flag, RotateCcw, Volume2 } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { FeedbackBanner } from "../components/FeedbackBanner";
import { HandwritingPad } from "../components/HandwritingPad";
import { KeyboardShortcutBadge } from "../components/KeyboardShortcutBadge";
import { LessonReadinessPanel } from "../components/LessonReadinessPanel";
import { MeaningBlock } from "../components/MeaningBlock";
import { PracticeViewport } from "../components/PracticeViewport";
import { TargetText } from "../components/TargetText";
import { Button } from "../components/ui/Button";
import { inputClassName } from "../components/ui/FormField";
import {
  acceptRejectedLearnAnswer,
  answerLearnChoice,
  answerLearnTyping,
  correctUnknownCompletionDelta,
  createLearnSession,
  giveUpLearnQuestion,
  resumeLearnSession,
  reverseErrorDeltas,
  shouldSubmitTypingAnswer,
  type HandwritingDrawing,
  type LearnSessionState,
  type LearnTransition,
  type StatisticsDelta,
} from "../domain";
import { cardStudyMarkerRepository, learnSessionsRepository } from "../data";
import { useLessonBundle } from "../hooks/useLessonBundle";
import { useAudioAvailability } from "../hooks/useAudioAvailability";
import { playCardAudio } from "../services/audio";
import {
  compareHandwriting,
  type HandwritingComparison,
} from "../services/handwriting-comparison";
import {
  formatVisibleTranslations,
  getLessonReadiness,
  toPracticeCards,
} from "../services/lesson-data";
import {
  choiceShortcutIndex,
  isEditableKeyboardTarget,
} from "../utils/keyboard";

interface VisibleFeedback {
  kind: "success" | "error";
  text: string;
  answer?: string;
}

interface HandwritingDecision {
  isCorrect: boolean;
  corrected: boolean;
}

export function LearnPage() {
  const { lessonId } = useParams();
  const bundle = useLessonBundle(lessonId);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const todayMode = searchParams.get("today") === "1";
  const requestedCardIds = useMemo(
    () =>
      new Set(
        (searchParams.get("cards") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    [searchParams],
  );
  const autostarted = useRef(false);
  const [session, setSession] = useState<LearnSessionState | null>(null);
  const [pendingSession, setPendingSession] =
    useState<LearnSessionState | null>(null);
  const [savedSession, setSavedSession] = useState<LearnSessionState | null>(
    null,
  );
  const [checkedResume, setCheckedResume] = useState(todayMode);
  const [typing, setTyping] = useState("");
  const [drawing, setDrawing] = useState<HandwritingDrawing>([]);
  const [drawingReview, setDrawingReview] = useState(false);
  const [handwritingComparison, setHandwritingComparison] =
    useState<HandwritingComparison | null>(null);
  const [handwritingDecision, setHandwritingDecision] =
    useState<HandwritingDecision | null>(null);
  const [showDrawingGuide, setShowDrawingGuide] = useState(true);
  const [feedback, setFeedback] = useState<VisibleFeedback | null>(null);
  const [selectedWrongCardId, setSelectedWrongCardId] = useState<string | null>(
    null,
  );
  const [rejectedAnswer, setRejectedAnswer] = useState<{
    kind: "rejected" | "gave-up";
    stateBefore: LearnSessionState;
    statisticsDeltas: StatisticsDelta[];
  } | null>(null);
  const [locked, setLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);
  const audioAvailable = useAudioAvailability(bundle?.lesson);
  const practiceCards = useMemo(
    () => (bundle ? toPracticeCards(bundle.cards, bundle.lesson) : []),
    [bundle],
  );
  const cardsById = useMemo(
    () => new Map(bundle?.cards.map((card) => [card.id, card]) ?? []),
    [bundle],
  );
  const markedCardIds = useMemo(
    () => new Set(bundle?.studyMarkers.map((item) => item.cardId) ?? []),
    [bundle],
  );

  useEffect(() => {
    if (!lessonId || checkedResume) return;
    void learnSessionsRepository.getLatestForLesson(lessonId).then((saved) => {
      if (saved?.status === "active") setSavedSession(saved);
      setCheckedResume(true);
    });
  }, [lessonId, checkedResume]);

  useEffect(() => {
    if (
      searchParams.get("autostart") !== "1" ||
      !todayMode ||
      !bundle ||
      !checkedResume ||
      session ||
      autostarted.current
    ) {
      return;
    }
    autostarted.current = true;
    void start();
    // The initial URL selection deliberately owns this one-time start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, checkedResume, searchParams, session, todayMode]);

  useEffect(() => {
    const question = session?.currentQuestion;
    if (!question || locked) return;
    const update = () =>
      setElapsed(Math.max(0, Date.now() - question.startedAtMs));
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [session?.currentQuestion, locked]);

  useEffect(() => {
    function keydown(event: globalThis.KeyboardEvent) {
      if (locked && pendingSession && event.key === "Enter") {
        if (!isEditableKeyboardTarget(event.target)) {
          event.preventDefault();
          void continueToNextQuestion();
        }
        return;
      }
      if (!session?.currentQuestion || locked) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (window.confirm(t("learn.leaveConfirm")))
          navigate(`/lessons/${lessonId}`);
        return;
      }
      if (
        event.code === "Space" &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        event.preventDefault();
        const card = cardsById.get(session.currentQuestion.cardId);
        if (card && bundle) {
          setAudioStatus(null);
          void playCardAudio(card, bundle.lesson, (status) =>
            setAudioStatus(
              status === "loading" ? t("audio.loadingProvider") : null,
            ),
          ).catch(() => setAudioStatus(t("audio.noVoice")));
        }
        return;
      }
      const shortcutIndex = choiceShortcutIndex(event);
      if (
        session.currentQuestion.exerciseType !== "meaning-to-typing" &&
        shortcutIndex !== null
      ) {
        const cardId =
          session.currentQuestion.optionCardIds[shortcutIndex];
        if (cardId) {
          event.preventDefault();
          void choose(cardId);
        }
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
    // `choose` deliberately observes the same session snapshot as this listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session,
    pendingSession,
    locked,
    cardsById,
    bundle,
    lessonId,
    navigate,
    t,
  ]);

  if (bundle === undefined || !checkedResume)
    return <p>{t("common.loading")}</p>;
  if (!bundle) return <p>{t("notFound.title")}</p>;
  const { lesson, cards, progress } = bundle;
  const readiness = getLessonReadiness(
    todayMode
      ? cards.filter((card) => requestedCardIds.has(card.id))
      : cards,
    lesson,
    audioAvailable,
  );

  async function start(restart = false) {
    const learned = new Set(
      progress.filter((item) => item.learned).map((item) => item.cardId),
    );
    const next = createLearnSession({
      id: crypto.randomUUID(),
      lessonId: lesson.id,
      cards: practiceCards,
      newCardIds: practiceCards
        .filter(
          (card) =>
            (restart || !learned.has(card.id)) &&
            (!todayMode || requestedCardIds.has(card.id)),
        )
        .map((card) => card.id),
    });
    if (restart) {
      await learnSessionsRepository.restartLesson(next);
    } else {
      await learnSessionsRepository.save(next);
    }
    setTyping("");
    setDrawing([]);
    setDrawingReview(false);
    setHandwritingComparison(null);
    setHandwritingDecision(null);
    setFeedback(null);
    setPendingSession(null);
    setSelectedWrongCardId(null);
    setRejectedAnswer(null);
    setSavedSession(null);
    setSession(next);
  }

  async function resume() {
    if (!savedSession) return;
    const next = resumeLearnSession(savedSession, practiceCards);
    await learnSessionsRepository.save(next);
    setTyping("");
    setDrawing([]);
    setDrawingReview(false);
    setHandwritingComparison(null);
    setHandwritingDecision(null);
    setFeedback(null);
    setPendingSession(null);
    setSelectedWrongCardId(null);
    setRejectedAnswer(null);
    setSavedSession(null);
    setSession(next);
  }

  async function handleTransition(
    transition: LearnTransition,
    stateBeforeRejectedAnswer?: LearnSessionState,
  ) {
    const persistence = learnSessionsRepository.commitTransition(transition);
    const answerCard = cardsById.get(transition.answeredCardId);
    if (transition.feedback === "incorrect") {
      setSession(transition.state);
      setFeedback({ kind: "error", text: t("learn.incorrect") });
      await persistence;
      if (stateBeforeRejectedAnswer) {
        setRejectedAnswer({
          kind: "rejected",
          stateBefore: stateBeforeRejectedAnswer,
          statisticsDeltas: transition.statisticsDeltas,
        });
      }
      return;
    }
    setRejectedAnswer(null);
    setLocked(true);
    const completedDelta = transition.statisticsDeltas.find(
      (delta) =>
        delta.cardId === transition.answeredCardId &&
        delta.completedQuestions > 0,
    );
    if (completedDelta) setElapsed(completedDelta.responseTimeMs);
    setFeedback({
      kind: "success",
      text:
        transition.feedback === "correct"
          ? t("learn.correct")
          : t("learn.answer", { answer: answerCard?.target ?? "" }),
      answer: answerCard?.target,
    });
    (document.activeElement as HTMLElement | null)?.blur();
    if (answerCard) {
      setAudioStatus(null);
      void playCardAudio(answerCard, lesson, (status) =>
        setAudioStatus(
          status === "loading" ? t("audio.loadingProvider") : null,
        ),
      ).catch(() => setAudioStatus(t("audio.noVoice")));
    }
    setPendingSession(transition.state);
    await persistence;
  }

  async function continueToNextQuestion(completedSession = pendingSession) {
    if (!completedSession) return;
    const next = resumeLearnSession(completedSession, practiceCards);
    await learnSessionsRepository.save(next);
    setTyping("");
    setDrawing([]);
    setDrawingReview(false);
    setHandwritingComparison(null);
    setHandwritingDecision(null);
    setSession(next);
    setPendingSession(null);
    setFeedback(null);
    setSelectedWrongCardId(null);
    setRejectedAnswer(null);
    setLocked(false);
  }

  async function choose(cardId: string) {
    if (!session || locked) return;
    const stateBefore = session;
    setRejectedAnswer(null);
    const transition = answerLearnChoice(session, practiceCards, cardId);
    if (transition.feedback === "incorrect") setSelectedWrongCardId(cardId);
    await handleTransition(transition, stateBefore);
  }

  async function submitTyping(event?: FormEvent) {
    event?.preventDefault();
    if (!session || locked || !typing) return;
    const stateBefore = session;
    setRejectedAnswer(null);
    await handleTransition(
      answerLearnTyping(session, practiceCards, typing),
      stateBefore,
    );
  }

  async function submitDrawingAndContinue(target: string) {
    if (!session || !handwritingDecision || locked) return;
    const transition = handwritingDecision.isCorrect
      ? answerLearnTyping(session, practiceCards, target)
      : giveUpLearnQuestion(session, practiceCards);
    await handleTransition(transition);
    await continueToNextQuestion(transition.state);
  }

  async function acceptRejectedAnswer() {
    if (!rejectedAnswer || (locked && rejectedAnswer.kind !== "gave-up")) {
      return;
    }
    const corrected = acceptRejectedLearnAnswer(
      rejectedAnswer.stateBefore,
      practiceCards,
    );
    setRejectedAnswer(null);
    const statisticsDeltas =
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
          ];
    await handleTransition({
      ...corrected,
      statisticsDeltas,
    });
  }

  async function giveUp() {
    if (!session || locked) return;
    const stateBefore = session;
    const transition = giveUpLearnQuestion(session, practiceCards);
    await handleTransition(transition);
    setRejectedAnswer({
      kind: "gave-up",
      stateBefore,
      statisticsDeltas: transition.statisticsDeltas,
    });
  }

  if (cards.length === 0 || readiness.length > 0)
    return (
      <div className="space-y-5">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold"
          to={todayMode ? "/today" : `/lessons/${lesson.id}`}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          {t("common.back")}
        </Link>
        <LessonReadinessPanel lesson={lesson} cards={cards} />
      </div>
    );

  if (savedSession && !session)
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-7 text-center dark:border-slate-800 dark:bg-slate-900">
        <RotateCcw
          className="mx-auto text-sky-600"
          size={38}
          aria-hidden="true"
        />
        <h1 className="mt-4 text-2xl font-black">{t("learn.resumeTitle")}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          {t("learn.resumeBody")}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button onClick={() => void resume()}>{t("learn.resume")}</Button>
          <Button variant="secondary" onClick={() => void start(true)}>
            {t("learn.restart")}
          </Button>
        </div>
      </section>
    );

  if (!session)
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-7 text-center dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-3xl font-black">{t("learn.title")}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">{lesson.name}</p>
        <Button className="mt-6" onClick={() => void start()}>
          {t("lesson.learn")}
        </Button>
      </section>
    );

  if (session.status === "completed" || !session.currentQuestion)
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-emerald-300 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <h1 className="text-3xl font-black">{t("learn.complete")}</h1>
        <p className="mt-3">{t("learn.completeBody")}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700"
            to={todayMode ? "/today" : `/lessons/${lesson.id}`}
          >
            {todayMode ? t("today.continue") : t("common.back")}
          </Link>
          {!todayMode ? (
            <Button onClick={() => void start(true)}>{t("learn.restart")}</Button>
          ) : null}
        </div>
      </section>
    );

  const question = session.currentQuestion;
  const expected = cardsById.get(question.cardId)!;
  const expectedPractice = practiceCards.find(
    (card) => card.id === question.cardId,
  );
  const kanaChoice = Boolean(
    expectedPractice?.isKanaStudy &&
      question.exerciseType === "meaning-to-word",
  );
  const romajiTyping = Boolean(expectedPractice?.acceptedTypingAnswers?.length);
  const handwriting = Boolean(
    expectedPractice?.requiresHandwriting &&
      question.exerciseType === "meaning-to-typing",
  );
  const acceptedDrawingTargets = expectedPractice?.acceptedDrawingTargets ?? [
    expected.target,
  ];
  const optionCards = question.optionCardIds
    .map((id) => cardsById.get(id))
    .filter((card): card is NonNullable<typeof card> => Boolean(card));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold"
          to={todayMode ? "/today" : `/lessons/${lesson.id}`}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          {lesson.name}
        </Link>
        {!todayMode ? <Button
          variant="ghost"
          onClick={() => void start(true)}
          icon={<RotateCcw size={17} aria-hidden="true" />}
        >
          {t("learn.restart")}
        </Button> : null}
      </header>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Status
          text={t("learn.batch", { number: session.currentBatch?.number ?? 0 })}
        />
        <Status text={t("learn.stage", { stage: question.stage })} />
        <Status
          text={t("learn.learned", { count: session.learnedCardIds.length })}
        />
        <Status
          testId="question-timer"
          text={`${(elapsed / 1000).toFixed(1)} s`}
        />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className="h-full bg-sky-500 transition-[width]"
          style={{
            width: `${Math.max(4, ((session.currentBatch?.nextPrimaryIndex ?? 0) / Math.max(1, session.currentBatch?.stageCardOrder.length ?? 1)) * 100)}%`,
          }}
        />
      </div>
      <PracticeViewport>
      <main className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <p className="mb-5 text-center text-sm font-semibold text-slate-500">
          {question.source === "delayed-retry"
            ? t("common.retry")
            : t("learn.question", { number: question.sequence })}
        </p>
        {question.exerciseType === "meaning-to-word" ? (
          <>
            <MeaningBlock
              card={expected}
              translationLanguage={lesson.activeTranslationLanguage}
              translationLanguages={lesson.visibleTranslationLanguages}
              showImage={lesson.useImages}
            />
            <div className={`mt-5 grid gap-3 ${kanaChoice ? "grid-cols-2 sm:grid-cols-4" : "sm:grid-cols-2"}`}>
              {optionCards.map((card, index) => {
                const wrong = selectedWrongCardId === card.id;
                return (
                  <button
                    aria-label={`${index + 1}. ${card.target}`}
                    disabled={locked || wrong}
                    key={card.id}
                    className={`${kanaChoice ? "relative min-h-28 text-center text-5xl font-medium" : "min-h-14 px-4 text-left text-lg font-bold"} rounded-2xl border outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${wrong ? "border-red-500 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-100" : "border-slate-300 hover:border-sky-500 hover:bg-sky-50 dark:border-slate-700 dark:hover:bg-slate-800"}`}
                    onClick={() => void choose(card.id)}
                  >
                    <span className={kanaChoice ? "absolute left-2 top-2" : "mr-3"}>
                      <KeyboardShortcutBadge number={index + 1} />
                    </span>
                    <TargetText {...card} />
                    {wrong ? (
                      <span className="ml-2 text-sm">
                        — {t("learn.incorrect")}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        {question.exerciseType === "word-to-meaning" ? (
          <>
            <div className="mb-5 text-center">
              <h1 className="text-4xl font-black"><TargetText {...expected} /></h1>
              {expected.pronunciationText ? (
                <p className="mt-1 text-slate-500">
                  {expected.pronunciationText}
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {optionCards.map((card, index) => {
                const wrong = selectedWrongCardId === card.id;
                return (
                  <button
                    aria-label={`${index + 1}. ${formatVisibleTranslations(card, lesson, ", ")}`}
                    disabled={locked || wrong}
                    key={card.id}
                    className={`relative rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${wrong ? "ring-2 ring-red-500 opacity-70" : ""}`}
                    onClick={() => void choose(card.id)}
                  >
                    <span className="absolute left-2 top-2 z-10">
                      <KeyboardShortcutBadge number={index + 1} />
                    </span>
                    <span className="sr-only">
                      {index + 1}
                      {wrong ? ` — ${t("learn.incorrect")}` : ""}
                    </span>
                    <MeaningBlock
                      compact
                      card={card}
                          translationLanguage={lesson.activeTranslationLanguage}
                          translationLanguages={lesson.visibleTranslationLanguages}
                      showImage={lesson.useImages}
                    />
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        {question.exerciseType === "meaning-to-typing" && handwriting ? (
          <div className="space-y-5">
            <MeaningBlock
              card={expected}
              translationLanguage={lesson.activeTranslationLanguage}
              translationLanguages={lesson.visibleTranslationLanguages}
              showImage={lesson.useImages}
            />
            <p className="text-center font-semibold">
              {t("handwriting.drawPrompt")}
            </p>
            {!drawingReview ? (
              <div className="flex justify-center">
                <Button
                  onClick={() => setShowDrawingGuide((value) => !value)}
                  type="button"
                  variant="ghost"
                >
                  {t(
                    showDrawingGuide
                      ? "handwriting.hideGuide"
                      : "handwriting.showGuide",
                  )}
                </Button>
              </div>
            ) : null}
            <HandwritingPad
              disabled={drawingReview || locked}
              drawing={drawing}
              guide={showDrawingGuide && !drawingReview ? expected.target : undefined}
              onChange={setDrawing}
            />
            {!drawingReview ? (
              <div className="flex justify-center">
                <Button
                  disabled={!drawing.some((stroke) => stroke.length > 0)}
                  onClick={() => {
                    const comparison = compareHandwriting(
                      drawing,
                      acceptedDrawingTargets,
                    );
                    setHandwritingComparison(comparison);
                    setHandwritingDecision({
                      isCorrect: comparison.isMatch,
                      corrected: false,
                    });
                    setDrawingReview(true);
                  }}
                  type="button"
                >
                  {t("handwriting.checkAnswer")}
                </Button>
              </div>
            ) : handwritingDecision ? (
              <div className="space-y-4">
                {handwritingComparison ? (
                  <FeedbackBanner
                    kind={handwritingDecision.isCorrect ? "success" : "error"}
                    text={t(
                      handwritingDecision.corrected
                        ? handwritingDecision.isCorrect
                          ? "handwriting.correctedMatch"
                          : "handwriting.correctedMismatch"
                        : handwritingDecision.isCorrect
                          ? "handwriting.autoMatch"
                          : "handwriting.autoMismatch",
                      { score: Math.round(handwritingComparison.score * 100) },
                    )}
                  />
                ) : null}
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-center dark:border-sky-800 dark:bg-sky-950">
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {t("handwriting.compare")}
                  </p>
                  <p className="mt-2 text-7xl font-medium"><TargetText {...expected} /></p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    onClick={() =>
                      setHandwritingDecision((current) =>
                        current
                          ? {
                              isCorrect: !current.isCorrect,
                              corrected: true,
                            }
                          : current,
                      )
                    }
                    type="button"
                    variant="secondary"
                  >
                    {handwritingDecision.isCorrect
                      ? t("handwriting.systemWrongMismatch")
                      : t("handwriting.systemWrongMatch")}
                  </Button>
                  <Button
                    disabled={locked}
                    onClick={() =>
                      void submitDrawingAndContinue(expected.target)
                    }
                    type="button"
                  >
                    {t("common.next")}
                  </Button>
                </div>
                <div className="flex justify-center">
                  <Button onClick={() => { setDrawing([]); setDrawingReview(false); setHandwritingComparison(null); setHandwritingDecision(null); }} type="button" variant="ghost">
                    {t("handwriting.tryAgain")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {question.exerciseType === "meaning-to-typing" && !handwriting ? (
          <>
            <MeaningBlock
              card={expected}
              translationLanguage={lesson.activeTranslationLanguage}
              translationLanguages={lesson.visibleTranslationLanguages}
              showImage={lesson.useImages}
            />
            <form
              className="mt-5 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => void submitTyping(event)}
            >
              <label className="sr-only" htmlFor="typing-answer">
                {romajiTyping ? t("learn.typeJapaneseRomaji") : t("learn.typeAnswer")}
              </label>
              <input
                autoFocus
                autoComplete="off"
                id="typing-answer"
                className={inputClassName}
                disabled={locked}
                value={typing}
                placeholder={romajiTyping ? t("learn.typeJapaneseRomaji") : t("learn.typeAnswer")}
                onChange={(e) => setTyping(e.target.value)}
                onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                  if (
                    shouldSubmitTypingAnswer({
                      key: event.key,
                      isComposing: event.nativeEvent.isComposing,
                      keyCode: event.keyCode,
                    })
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    void submitTyping();
                  }
                }}
              />
              <Button disabled={!typing || locked} type="submit">
                {t("learn.submit")}
              </Button>
            </form>
            {romajiTyping ? (
              <p className="mt-2 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                {t("learn.romajiHint")}
              </p>
            ) : null}
          </>
        ) : null}
        {feedback ? (
          <div className="mt-4 space-y-3">
            <FeedbackBanner kind={feedback.kind} text={feedback.text} />
            {feedback.answer ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-center dark:border-sky-800 dark:bg-sky-950">
                <p className="text-2xl font-black"><TargetText {...expected} /></p>
                {expected.pronunciationText ? (
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {expected.pronunciationText}
                  </p>
                ) : null}
                <p className="mt-2 font-semibold">
                  {formatVisibleTranslations(expected, lesson, " · ")}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        {audioStatus ? (
          <p className="mt-3 text-center text-sm font-semibold" role="status">
            {audioStatus}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="ghost"
            icon={<Flag size={18} aria-hidden="true" />}
            onClick={() => void cardStudyMarkerRepository.setMarked(
              expected.id,
              !markedCardIds.has(expected.id),
            )}
          >
            {markedCardIds.has(expected.id)
              ? t("training.unmarkDifficult")
              : t("training.markDifficult")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setAudioStatus(null);
              void playCardAudio(expected, lesson, (status) =>
                setAudioStatus(
                  status === "loading" ? t("audio.loadingProvider") : null,
                ),
              ).catch(() => setAudioStatus(t("audio.noVoice")));
            }}
            icon={<Volume2 size={18} aria-hidden="true" />}
          >
            {t("learn.replay")}
          </Button>
          {!locked && !pendingSession && !(handwriting && drawingReview) ? (
            <Button
              type="button"
              variant="secondary"
              disabled={locked}
              onClick={() => {
                setRejectedAnswer(null);
                void giveUp();
              }}
            >
              {t("learn.dontKnow")}
            </Button>
          ) : null}
          {rejectedAnswer &&
          (feedback?.kind === "error" || rejectedAnswer.kind === "gave-up") ? (
            <Button
              type="button"
              variant="secondary"
              disabled={locked && rejectedAnswer.kind !== "gave-up"}
              onClick={() => void acceptRejectedAnswer()}
            >
              {t("learn.iWasCorrect")}
            </Button>
          ) : null}
          {pendingSession && !(handwriting && drawingReview) ? (
            <Button type="button" onClick={() => void continueToNextQuestion()}>
              {t("common.next")}
            </Button>
          ) : null}
        </div>
      </main>
      </PracticeViewport>
    </div>
  );
}

function Status({ text, testId }: { text: string; testId?: string }) {
  return (
    <div
      className="rounded-xl bg-slate-100 px-3 py-2 text-center font-semibold dark:bg-slate-800"
      data-testid={testId}
    >
      {text}
    </div>
  );
}
