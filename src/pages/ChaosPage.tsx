import { ArrowLeft, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { FeedbackBanner } from "../components/FeedbackBanner";
import { MeaningBlock } from "../components/MeaningBlock";
import { TargetText } from "../components/TargetText";
import { LessonReadinessPanel } from "../components/LessonReadinessPanel";
import { Button } from "../components/ui/Button";
import {
  acceptChaosMismatch,
  correctUnknownCompletionDelta,
  createChaosRound,
  createChaosRoundPlan,
  giveUpChaosPair,
  reverseErrorDeltas,
  selectChaosItem,
  type ChaosRoundState,
  type ChaosSide,
  type StatisticsDelta,
} from "../domain";
import { statisticsRepository } from "../data";
import { useLessonBundle } from "../hooks/useLessonBundle";
import { useAudioAvailability } from "../hooks/useAudioAvailability";
import { playCardAudio } from "../services/audio";
import { getLessonReadiness, toPracticeCards } from "../services/lesson-data";

export function ChaosPage() {
  const { lessonId } = useParams();
  const bundle = useLessonBundle(lessonId);
  const { t } = useTranslation();
  const practiceCards = useMemo(
    () => (bundle ? toPracticeCards(bundle.cards, bundle.lesson) : []),
    [bundle],
  );
  const [roundPlans, setRoundPlans] = useState<string[][]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [round, setRound] = useState<ChaosRoundState | null>(null);
  const [feedback, setFeedback] = useState<"match" | "mismatch" | "unknown" | null>(null);
  const [rejectedMatch, setRejectedMatch] = useState<{
    wordCardId: string;
    meaningCardId: string;
    statisticsDeltas: StatisticsDelta[];
  } | null>(null);
  const [gaveUpPair, setGaveUpPair] = useState<{
    stateBefore: ChaosRoundState;
    cardId: string;
    statisticsDeltas: StatisticsDelta[];
  } | null>(null);
  const [revealedCardId, setRevealedCardId] = useState<string | null>(null);
  const audioAvailable = useAudioAvailability(bundle?.lesson);
  const cardsById = useMemo(
    () => new Map(bundle?.cards.map((card) => [card.id, card]) ?? []),
    [bundle],
  );

  useEffect(() => {
    if (!bundle || roundPlans.length > 0) return;
    const size = window.matchMedia("(max-width: 639px)").matches ? 6 : 10;
    const plans = createChaosRoundPlan(practiceCards, size);
    // Initialize a round only after the live lesson catalog has loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoundPlans(plans);
    if (plans[0]) setRound(makeRound(plans[0], practiceCards));
  }, [bundle, practiceCards, roundPlans.length]);
  if (bundle === undefined) return <p>{t("common.loading")}</p>;
  if (!bundle) return <p>{t("notFound.title")}</p>;
  const { lesson, cards } = bundle;
  const ready =
    cards.length > 0 &&
    getLessonReadiness(cards, lesson, audioAvailable).length === 0;

  async function select(side: ChaosSide, cardId: string) {
    if (!round) return;
    const transition = selectChaosItem(round, side, cardId);
    setRound(transition.state);
    await statisticsRepository.applyDeltas(transition.statisticsDeltas);
    if (transition.playAudioCardId) {
      const card = cardsById.get(transition.playAudioCardId);
      if (card) void playCardAudio(card, lesson).catch(() => undefined);
    }
    if (transition.interaction === "correct-match") {
      setFeedback("match");
      setRejectedMatch(null);
      setRevealedCardId(null);
      setGaveUpPair(null);
    }
    if (transition.interaction === "incorrect-match") {
      setFeedback("mismatch");
      setRevealedCardId(null);
      setGaveUpPair(null);
      if (
        transition.attemptedWordCardId &&
        transition.attemptedMeaningCardId
      ) {
        setRejectedMatch({
          wordCardId: transition.attemptedWordCardId,
          meaningCardId: transition.attemptedMeaningCardId,
          statisticsDeltas: transition.statisticsDeltas,
        });
      }
    }
    if (
      transition.interaction === "selected" ||
      transition.interaction === "selection-replaced"
    ) {
      setFeedback(null);
      setRejectedMatch(null);
      setRevealedCardId(null);
      setGaveUpPair(null);
    }
  }

  async function acceptRejectedMatch() {
    if (!round || !rejectedMatch) return;
    const transition = acceptChaosMismatch(
      round,
      rejectedMatch.wordCardId,
      rejectedMatch.meaningCardId,
    );
    await statisticsRepository.applyDeltas([
      ...reverseErrorDeltas(rejectedMatch.statisticsDeltas),
      ...transition.statisticsDeltas,
    ]);
    setRound(transition.state);
    setRejectedMatch(null);
    setRevealedCardId(null);
    setFeedback("match");
  }

  async function giveUp() {
    if (!round || round.status !== "active") return;
    const stateBefore = round;
    const transition = giveUpChaosPair(round);
    await statisticsRepository.applyDeltas(transition.statisticsDeltas);
    setRound(transition.state);
    setRejectedMatch(null);
    setRevealedCardId(transition.revealedCardId ?? null);
    if (transition.revealedCardId) {
      setGaveUpPair({
        stateBefore,
        cardId: transition.revealedCardId,
        statisticsDeltas: transition.statisticsDeltas,
      });
    }
    setFeedback("unknown");
    if (transition.playAudioCardId) {
      const card = cardsById.get(transition.playAudioCardId);
      if (card) void playCardAudio(card, lesson).catch(() => undefined);
    }
  }

  async function acceptGaveUpPair() {
    if (!gaveUpPair) return;
    const transition = acceptChaosMismatch(
      gaveUpPair.stateBefore,
      gaveUpPair.cardId,
      gaveUpPair.cardId,
    );
    const unknownErrorCount = gaveUpPair.statisticsDeltas.reduce(
      (total, delta) => total + delta.errorCount,
      0,
    );
    await statisticsRepository.applyDeltas([
      correctUnknownCompletionDelta(gaveUpPair.cardId, unknownErrorCount),
    ]);
    setRound(transition.state);
    setRejectedMatch(null);
    setGaveUpPair(null);
    setRevealedCardId(null);
    setFeedback("match");
  }

  function nextRound() {
    const index = roundIndex + 1;
    const plan = roundPlans[index];
    if (!plan) return;
    setRoundIndex(index);
    setRound(makeRound(plan, practiceCards));
    setFeedback(null);
    setRejectedMatch(null);
    setGaveUpPair(null);
    setRevealedCardId(null);
  }
  function restart() {
    const size = window.matchMedia("(max-width: 639px)").matches ? 6 : 10;
    const plans = createChaosRoundPlan(practiceCards, size);
    setRoundPlans(plans);
    setRoundIndex(0);
    setRound(plans[0] ? makeRound(plans[0], practiceCards) : null);
    setFeedback(null);
    setRejectedMatch(null);
    setGaveUpPair(null);
    setRevealedCardId(null);
  }

  if (!ready)
    return (
      <div className="space-y-5">
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
  if (!round) return <p>{t("common.loading")}</p>;
  const allComplete =
    round.status === "completed" && roundIndex === roundPlans.length - 1;
  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold"
          to={`/lessons/${lesson.id}/automate`}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          {t("common.back")}
        </Link>
        <Button
          variant="ghost"
          onClick={restart}
          icon={<RotateCcw size={17} aria-hidden="true" />}
        >
          {t("learn.restart")}
        </Button>
      </header>
      <div className="text-center">
        <h1 className="text-3xl font-black">{t("chaos.title")}</h1>
        <p className="mt-1 font-semibold text-slate-500">
          {t("chaos.round", {
            current: roundIndex + 1,
            total: roundPlans.length,
          })}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ChaosColumn title={t("chaos.words")}>
          {round.wordCardIds.map((cardId) => {
            const card = cardsById.get(cardId)!;
            return (
              <ChaosButton
                key={cardId}
                selected={
                  round.selection?.side === "word" &&
                  round.selection.cardId === cardId
                }
                completed={round.completedWordCardIds.includes(cardId)}
                onClick={() => void select("word", cardId)}
              >
                <span className="text-xl font-black"><TargetText {...card} /></span>
                {card.pronunciationText ? (
                  <span className="block text-sm text-slate-500">
                    {card.pronunciationText}
                  </span>
                ) : null}
              </ChaosButton>
            );
          })}
        </ChaosColumn>
        <ChaosColumn title={t("chaos.meanings")}>
          {round.meaningCardIds.map((cardId) => {
            const card = cardsById.get(cardId)!;
            return (
              <ChaosButton
                key={cardId}
                selected={
                  round.selection?.side === "meaning" &&
                  round.selection.cardId === cardId
                }
                completed={round.completedMeaningCardIds.includes(cardId)}
                onClick={() => void select("meaning", cardId)}
              >
                <MeaningBlock
                  compact
                  card={card}
                    translationLanguage={lesson.activeTranslationLanguage}
                    translationLanguages={lesson.visibleTranslationLanguages}
                  showImage={lesson.useImages}
                />
              </ChaosButton>
            );
          })}
        </ChaosColumn>
      </div>
      {feedback ? (
        <div className="mx-auto max-w-xl">
          <FeedbackBanner
            kind={feedback === "match" ? "success" : "error"}
            text={
              feedback === "match"
                ? t("chaos.matched")
                : feedback === "unknown"
                  ? t("learn.dontKnow")
                  : t("chaos.mismatch")
            }
          />
          {revealedCardId ? (
            <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-center dark:border-sky-800 dark:bg-sky-950">
              <p className="text-2xl font-black"><TargetText {...cardsById.get(revealedCardId)!} /></p>
              <div className="mt-2 font-semibold">
                <MeaningBlock
                  compact
                  card={cardsById.get(revealedCardId)!}
                  translationLanguage={lesson.activeTranslationLanguage}
                  translationLanguages={lesson.visibleTranslationLanguages}
                  showImage={lesson.useImages}
                />
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {round.status === "active" ? (
              <Button variant="secondary" onClick={() => void giveUp()}>
                {t("learn.dontKnow")}
              </Button>
            ) : null}
            {rejectedMatch && feedback === "mismatch" ? (
              <Button variant="secondary" onClick={() => void acceptRejectedMatch()}>
                {t("learn.iWasCorrect")}
              </Button>
            ) : null}
            {gaveUpPair && feedback === "unknown" ? (
              <Button variant="secondary" onClick={() => void acceptGaveUpPair()}>
                {t("learn.iWasCorrect")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {!feedback && round.status === "active" ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void giveUp()}>
            {t("learn.dontKnow")}
          </Button>
        </div>
      ) : null}
      {round.status === "completed" ? (
        <div className="flex justify-center">
          {allComplete ? (
            <section className="rounded-2xl bg-emerald-50 p-5 text-center dark:bg-emerald-950">
              <h2 className="text-2xl font-black">{t("chaos.complete")}</h2>
              <Button className="mt-4" onClick={restart}>
                {t("learn.restart")}
              </Button>
            </section>
          ) : (
            <Button onClick={nextRound}>{t("chaos.nextRound")}</Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function makeRound(ids: string[], cards: ReturnType<typeof toPracticeCards>) {
  const allowed = new Set(ids);
  return createChaosRound(
    cards.filter((card) => allowed.has(card.id)),
    ids.length,
  );
}
function ChaosColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-slate-100 p-3 dark:bg-slate-900">
      <h2 className="mb-3 text-center text-sm font-bold uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}
function ChaosButton({
  selected,
  completed,
  onClick,
  children,
}: {
  selected: boolean;
  completed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={completed}
      aria-pressed={selected}
      className={`min-h-20 overflow-hidden rounded-2xl border bg-white p-2 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-slate-950 ${selected ? "border-sky-500 ring-2 ring-sky-500" : "border-slate-200 dark:border-slate-700"} ${completed ? "pointer-events-none opacity-25" : "hover:border-sky-400"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
