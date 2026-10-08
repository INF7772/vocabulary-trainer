import { ArrowLeft, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { FeedbackBanner } from "../components/FeedbackBanner";
import { KeyboardShortcutBadge } from "../components/KeyboardShortcutBadge";
import { LessonReadinessPanel } from "../components/LessonReadinessPanel";
import { MeaningBlock } from "../components/MeaningBlock";
import { PracticeViewport } from "../components/PracticeViewport";
import { TargetText } from "../components/TargetText";
import { Button } from "../components/ui/Button";
import {
  acceptRejectedQuickChoiceAnswer,
  answerQuickChoice,
  correctUnknownCompletionDelta,
  createQuickChoiceSession,
  giveUpQuickChoiceQuestion,
  resumeQuickChoiceSession,
  reverseErrorDeltas,
  stopQuickChoice,
  type QuickChoiceLength,
  type QuickChoiceMode,
  type QuickChoiceState,
  type StatisticsDelta,
} from "../domain";
import { statisticsRepository } from "../data";
import { useLessonBundle } from "../hooks/useLessonBundle";
import { useAudioAvailability } from "../hooks/useAudioAvailability";
import { playCardAudio } from "../services/audio";
import {
  formatVisibleTranslations,
  getLessonReadiness,
  toPracticeCards,
} from "../services/lesson-data";
import {
  choiceShortcutIndex,
  isEditableKeyboardTarget,
} from "../utils/keyboard";

export function QuickChoicePage() {
  const { lessonId } = useParams();
  const bundle = useLessonBundle(lessonId);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<QuickChoiceMode>("mixed");
  const [length, setLength] = useState<QuickChoiceLength>(10);
  const [session, setSession] = useState<QuickChoiceState | null>(null);
  const [pendingSession, setPendingSession] =
    useState<QuickChoiceState | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "incorrect" | "gave-up" | null>(
    null,
  );
  const [rejectedAnswer, setRejectedAnswer] = useState<{
    kind: "rejected" | "gave-up";
    stateBefore: QuickChoiceState;
    statisticsDeltas: StatisticsDelta[];
  } | null>(null);
  const [locked, setLocked] = useState(false);
  const audioAvailable = useAudioAvailability(bundle?.lesson);
  const [selectedWrongCardId, setSelectedWrongCardId] = useState<string | null>(
    null,
  );
  const practiceCards = useMemo(
    () => (bundle ? toPracticeCards(bundle.cards, bundle.lesson) : []),
    [bundle],
  );
  const cardsById = useMemo(
    () => new Map(bundle?.cards.map((card) => [card.id, card]) ?? []),
    [bundle],
  );

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (locked && pendingSession && event.key === "Enter") {
        if (!isEditableKeyboardTarget(event.target)) {
          event.preventDefault();
          continueToNextQuestion();
        }
        return;
      }
      const question = session?.currentQuestion;
      if (!question || locked) return;
      if (event.key === "Escape") {
        setSession((value) => (value ? stopQuickChoice(value) : null));
        navigate(`/lessons/${lessonId}/automate`);
      }
      if (
        event.code === "Space" &&
        document.activeElement?.tagName !== "BUTTON" &&
        bundle
      ) {
        event.preventDefault();
        const card = cardsById.get(question.cardId);
        if (card)
          void playCardAudio(card, bundle.lesson).catch(() => undefined);
      }
      const shortcutIndex = choiceShortcutIndex(event);
      if (shortcutIndex !== null) {
        const cardId = question.optionCardIds[shortcutIndex];
        if (cardId) {
          event.preventDefault();
          void answer(cardId);
        }
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
    // `answer` deliberately observes the same session snapshot as this listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session,
    pendingSession,
    locked,
    bundle,
    cardsById,
    lessonId,
    navigate,
  ]);

  if (bundle === undefined) return <p>{t("common.loading")}</p>;
  if (!bundle) return <p>{t("notFound.title")}</p>;
  const { lesson, cards } = bundle;
  const ready =
    cards.length > 0 &&
    getLessonReadiness(cards, lesson, audioAvailable).length === 0;

  async function answer(cardId: string) {
    if (!session || locked) return;
    const stateBefore = session;
    setRejectedAnswer(null);
    const transition = answerQuickChoice(session, practiceCards, cardId);
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
    setLocked(true);
    setFeedback(transition.feedback);
    const card = cardsById.get(transition.answeredCardId);
    if (card) void playCardAudio(card, lesson).catch(() => undefined);
    setPendingSession(transition.state);
    await persistence;
  }

  async function acceptRejectedAnswer() {
    if (!rejectedAnswer || (locked && rejectedAnswer.kind !== "gave-up")) {
      return;
    }
    const corrected = acceptRejectedQuickChoiceAnswer(
      rejectedAnswer.stateBefore,
      practiceCards,
    );
    setRejectedAnswer(null);
    const persistence = statisticsRepository.applyDeltas(
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
    setLocked(true);
    setFeedback("correct");
    setPendingSession(corrected.state);
    const card = cardsById.get(corrected.answeredCardId);
    if (card) void playCardAudio(card, lesson).catch(() => undefined);
    await persistence;
  }

  async function giveUp() {
    if (!session || locked) return;
    const stateBefore = session;
    setRejectedAnswer(null);
    const transition = giveUpQuickChoiceQuestion(session, practiceCards);
    const persistence = statisticsRepository.applyDeltas(
      transition.statisticsDeltas,
    );
    setLocked(true);
    setFeedback("gave-up");
    setPendingSession(transition.state);
    const card = cardsById.get(transition.answeredCardId);
    if (card) void playCardAudio(card, lesson).catch(() => undefined);
    await persistence;
    setRejectedAnswer({
      kind: "gave-up",
      stateBefore,
      statisticsDeltas: transition.statisticsDeltas,
    });
  }

  function continueToNextQuestion() {
    if (!pendingSession) return;
    setSession(resumeQuickChoiceSession(pendingSession));
    setPendingSession(null);
    setFeedback(null);
    setSelectedWrongCardId(null);
    setRejectedAnswer(null);
    setLocked(false);
  }

  if (!ready)
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold"
          to={`/lessons/${lesson.id}/automate`}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          {t("common.back")}
        </Link>
        <LessonReadinessPanel lesson={lesson} cards={cards} />
      </div>
    );

  if (!session)
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold"
          to={`/lessons/${lesson.id}/automate`}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          {t("common.back")}
        </Link>
        <h1 className="text-3xl font-black">{t("quick.title")}</h1>
        <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <fieldset>
            <legend className="mb-3 font-bold">{t("quick.mode")}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["mixed", t("quick.mixed")],
                  ["meaning-to-word", t("quick.meaningWord")],
                  ["word-to-meaning", t("quick.wordMeaning")],
                ] as const
              ).map(([value, label]) => (
                <ChoiceLabel
                  key={value}
                  checked={mode === value}
                  label={label}
                  onChange={() => setMode(value)}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 font-bold">{t("quick.length")}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([10, 20, 50, "endless"] as const).map((value) => (
                <ChoiceLabel
                  key={value}
                  checked={length === value}
                  label={
                    value === "endless" ? t("quick.endless") : String(value)
                  }
                  onChange={() => setLength(value)}
                />
              ))}
            </div>
          </fieldset>
          <Button
            className="w-full"
            onClick={() =>
              setSession(createQuickChoiceSession(practiceCards, mode, length))
            }
          >
            {t("quick.start")}
          </Button>
        </section>
      </div>
    );

  if (session.status !== "active" || !session.currentQuestion)
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-emerald-300 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <h1 className="text-3xl font-black">{t("quick.complete")}</h1>
        <Link
          className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700"
          to={`/lessons/${lesson.id}`}
        >
          {t("common.back")}
        </Link>
      </section>
    );
  const question = session.currentQuestion;
  const expected = cardsById.get(question.cardId)!;
  const options = question.optionCardIds
    .map((id) => cardsById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-center justify-between">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold"
          to={`/lessons/${lesson.id}/automate`}
        >
          <ArrowLeft size={17} />
          {t("quick.title")}
        </Link>
        <Button
          variant="ghost"
          onClick={() => {
            setSession(stopQuickChoice(session));
            navigate(`/lessons/${lesson.id}`);
          }}
        >
          {t("quick.stop")}
        </Button>
      </header>
      <p className="text-center font-semibold">
        {session.length === "endless"
          ? t("learn.question", { number: session.completedQuestionCount + 1 })
          : t("quick.progress", {
              current: session.completedQuestionCount + 1,
              total: session.length,
            })}
      </p>
      <PracticeViewport>
      <main className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {question.exerciseType === "meaning-to-word" ? (
          <>
            <MeaningBlock
              card={expected}
              translationLanguage={lesson.activeTranslationLanguage}
              translationLanguages={lesson.visibleTranslationLanguages}
              showImage={lesson.useImages}
            />
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {options.map((card, index) => (
                <Option
                  key={card.id}
                  index={index}
                  label={`${index + 1}. ${card.target}`}
                  disabled={locked || selectedWrongCardId === card.id}
                  wrong={selectedWrongCardId === card.id}
                  onClick={() => void answer(card.id)}
                >
                  <TargetText {...card} />
                </Option>
              ))}
            </div>
          </>
        ) : (
          <>
            <h1 className="mb-5 text-center text-4xl font-black">
              <TargetText {...expected} />
            </h1>
            <div className="grid gap-3 sm:grid-cols-2">
              {options.map((card, index) => (
                <button
                  aria-label={`${index + 1}. ${formatVisibleTranslations(card, lesson, ", ")}`}
                  key={card.id}
                  disabled={locked || selectedWrongCardId === card.id}
                  className={`relative rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${selectedWrongCardId === card.id ? "ring-2 ring-red-500 opacity-70" : ""}`}
                  onClick={() => void answer(card.id)}
                >
                  <span className="absolute left-2 top-2 z-10">
                    <KeyboardShortcutBadge number={index + 1} />
                  </span>
                  <span className="sr-only">{index + 1}</span>
                  <MeaningBlock
                    compact
                    card={card}
                    translationLanguage={lesson.activeTranslationLanguage}
                    translationLanguages={lesson.visibleTranslationLanguages}
                    showImage={lesson.useImages}
                  />
                </button>
              ))}
            </div>
          </>
        )}
        {feedback ? (
          <div className="mt-4 space-y-3">
            <FeedbackBanner
              kind={feedback === "correct" ? "success" : "error"}
              text={
                feedback === "correct"
                  ? t("learn.correct")
                  : feedback === "gave-up"
                    ? t("learn.answer", { answer: expected.target })
                    : t("learn.incorrect")
              }
            />
            {feedback === "correct" || feedback === "gave-up" ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-center dark:border-sky-800 dark:bg-sky-950">
                <p className="text-2xl font-black"><TargetText {...expected} /></p>
                <p className="mt-2 font-semibold">
                  {formatVisibleTranslations(expected, lesson, " · ")}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 flex justify-center">
          <Button
            variant="ghost"
            onClick={() =>
              void playCardAudio(expected, lesson).catch(() => undefined)
            }
            icon={<Volume2 size={18} />}
          >
            {t("learn.replay")}
          </Button>
          {!locked && !pendingSession ? (
            <Button variant="secondary" onClick={() => void giveUp()}>
              {t("learn.dontKnow")}
            </Button>
          ) : null}
          {rejectedAnswer &&
          (feedback === "incorrect" || rejectedAnswer.kind === "gave-up") ? (
            <Button variant="secondary" onClick={() => void acceptRejectedAnswer()}>
              {t("learn.iWasCorrect")}
            </Button>
          ) : null}
          {pendingSession ? (
            <Button onClick={continueToNextQuestion}>
              {t("common.next")}
            </Button>
          ) : null}
        </div>
      </main>
      </PracticeViewport>
    </div>
  );
}

function ChoiceLabel({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border p-3 ${checked ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-slate-200 dark:border-slate-700"}`}
    >
      <input type="radio" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
function Option({
  index,
  disabled,
  onClick,
  children,
  wrong = false,
  label,
}: {
  index: number;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
  wrong?: boolean;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      className={`min-h-14 rounded-xl border px-4 text-left text-lg font-bold outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${wrong ? "border-red-500 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-100" : "border-slate-300 hover:border-sky-500 dark:border-slate-700"}`}
      onClick={onClick}
    >
      <span className="mr-3"><KeyboardShortcutBadge number={index + 1} /></span>
      {children}
    </button>
  );
}
