import { ArrowLeft, PenTool, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { FeedbackBanner } from "../components/FeedbackBanner";
import { HandwritingPad } from "../components/HandwritingPad";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import {
  advanceHandwritingPractice,
  answerHandwritingPractice,
  createHandwritingPractice,
  currentHandwritingCardId,
  type Card,
  type HandwritingDrawing,
  type Lesson,
} from "../domain";
import { statisticsRepository } from "../data";
import { useLessonBundle } from "../hooks/useLessonBundle";
import {
  compareHandwriting,
  type HandwritingComparison,
} from "../services/handwriting-comparison";
import {
  formatVisibleTranslations,
  resolveLessonContentType,
  toPracticeCards,
} from "../services/lesson-data";

export function HandwritingPracticePage() {
  const { lessonId } = useParams();
  const { t } = useTranslation();
  const bundle = useLessonBundle(lessonId);

  if (bundle === undefined) return <p>{t("common.loading")}</p>;
  if (!bundle) return <p>{t("notFound.title")}</p>;
  const contentType = resolveLessonContentType(bundle.lesson, bundle.cards);

  if (contentType !== "symbols" || bundle.cards.length === 0) {
    return (
      <div className="space-y-5">
        <BackLink lessonId={bundle.lesson.id} />
        <p>
          {t(
            contentType === "symbols" ? "lesson.noCards" : "notFound.title",
          )}
        </p>
      </div>
    );
  }

  const revision = bundle.cards.map((card) => card.id).join(":");
  return (
    <HandwritingPractice
      cards={bundle.cards}
      key={`${bundle.lesson.id}:${revision}`}
      lesson={bundle.lesson}
    />
  );
}

function HandwritingPractice({
  cards,
  lesson,
}: {
  cards: Card[];
  lesson: Lesson;
}) {
  const { t } = useTranslation();
  const [session, setSession] = useState(() =>
    createHandwritingPractice(cards.map((card) => card.id)),
  );
  const [drawing, setDrawing] = useState<HandwritingDrawing>([]);
  const [comparison, setComparison] = useState<HandwritingComparison | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const cardsById = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  );
  const practiceCardsById = useMemo(
    () =>
      new Map(
        toPracticeCards(cards, lesson).map((card) => [card.id, card]),
      ),
    [cards, lesson],
  );

  function restart() {
    setSession(createHandwritingPractice(cards.map((card) => card.id)));
    resetQuestion();
  }

  function resetQuestion() {
    setDrawing([]);
    setComparison(null);
    setStatus(null);
  }

  async function decide(correct: boolean) {
    if (session.decision !== null || saving) return;
    const transition = answerHandwritingPractice(session, correct);
    setSaving(true);
    setStatus(null);
    try {
      await statisticsRepository.applyDeltas([transition.statisticsDelta]);
      setSession(transition.state);
    } catch {
      setStatus(t("errors.storage"));
    } finally {
      setSaving(false);
    }
  }

  function next() {
    if (session.decision === null) return;
    setSession(advanceHandwritingPractice(session));
    resetQuestion();
  }

  if (session.status === "completed") {
    const accuracy = Math.round(
      (session.correctCount / session.cardIds.length) * 100,
    );
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-emerald-300 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <PenTool
          className="mx-auto text-emerald-600"
          size={42}
          aria-hidden="true"
        />
        <h1 className="mt-4 text-3xl font-black">{t("learn.complete")}</h1>
        <p className="mt-3 text-lg font-semibold">
          {t("lesson.accuracy")}: {accuracy}% · {session.correctCount} /{" "}
          {session.cardIds.length}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700"
            to={`/lessons/${lesson.id}`}
          >
            {t("common.back")}
          </Link>
          <Button
            icon={<RotateCcw size={18} aria-hidden="true" />}
            onClick={restart}
          >
            {t("learn.restart")}
          </Button>
        </div>
      </section>
    );
  }

  const currentCard = cardsById.get(currentHandwritingCardId(session));
  if (!currentCard) return <p>{t("notFound.title")}</p>;
  const currentPracticeCard = practiceCardsById.get(currentCard.id);
  const hasInk = drawing.some((stroke) => stroke.length > 0);
  const decided = session.decision !== null;

  return (
    <div className="space-y-5">
      <BackLink lessonId={lesson.id} />
      <PageHeader
        eyebrow={`${session.currentIndex + 1} / ${session.cardIds.length}`}
        title={t("handwriting.practice")}
        description={lesson.name}
      />
      <p className="mx-auto max-w-2xl text-center text-sm text-slate-600 dark:text-slate-300">
        {t("handwriting.strictHint")}
      </p>
      {status ? (
        <p
          className="rounded-xl bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200"
          role="status"
        >
          {status}
        </p>
      ) : null}
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <p className="whitespace-pre-line text-center text-xl font-bold">
          {formatVisibleTranslations(currentCard, lesson)}
        </p>
        <p className="mt-2 text-center text-sm font-semibold text-slate-500">
          {t("handwriting.drawPrompt")}
        </p>

        {!comparison ? (
          <div className="mt-5">
            <HandwritingPad drawing={drawing} onChange={setDrawing} />
            <div className="mt-4 flex justify-center">
              <Button
                disabled={!hasInk}
                onClick={() =>
                  setComparison(
                    compareHandwriting(
                      drawing,
                      currentPracticeCard?.acceptedDrawingTargets ?? [
                        currentCard.target,
                      ],
                    ),
                  )
                }
              >
                {t("handwriting.showAnswer")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <FeedbackBanner
              kind={comparison.isMatch ? "success" : "error"}
              text={t(
                comparison.isMatch
                  ? "handwriting.autoMatch"
                  : "handwriting.autoMismatch",
                { score: Math.round(comparison.score * 100) },
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-center text-sm font-bold">
                  {t("handwriting.yourDrawing")}
                </p>
                <HandwritingPad disabled drawing={drawing} />
              </div>
              <div>
                <p className="mb-2 text-center text-sm font-bold">
                  {t("handwriting.reference")}
                </p>
                <div className="grid aspect-square w-full place-items-center rounded-3xl border-2 border-slate-300 bg-white text-8xl font-medium text-slate-950 shadow-inner dark:border-slate-600 dark:bg-slate-950 dark:text-white">
                  {currentCard.target}
                </div>
              </div>
            </div>

            {decided ? (
              <>
                <FeedbackBanner
                  kind={session.decision ? "success" : "error"}
                  text={t(
                    session.decision
                      ? "handwriting.correctedMatch"
                      : "handwriting.correctedMismatch",
                  )}
                />
                <div className="flex justify-center">
                  <Button onClick={next}>{t("common.next")}</Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  disabled={saving}
                  onClick={() => void decide(true)}
                  variant={comparison.isMatch ? "primary" : "secondary"}
                >
                  {comparison.isMatch
                    ? t("handwriting.confirmMatch")
                    : t("handwriting.systemWrongMatch")}
                </Button>
                <Button
                  disabled={saving}
                  onClick={() => void decide(false)}
                  variant={comparison.isMatch ? "secondary" : "primary"}
                >
                  {comparison.isMatch
                    ? t("handwriting.systemWrongMismatch")
                    : t("handwriting.confirmMismatch")}
                </Button>
                <Button
                  disabled={saving}
                  onClick={resetQuestion}
                  variant="ghost"
                >
                  {t("handwriting.tryAgain")}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function BackLink({ lessonId }: { lessonId: string }) {
  const { t } = useTranslation();
  return (
    <Link
      className="inline-flex items-center gap-2 text-sm font-semibold"
      to={`/lessons/${lessonId}`}
    >
      <ArrowLeft size={17} aria-hidden="true" />
      {t("common.back")}
    </Link>
  );
}
