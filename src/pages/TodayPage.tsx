import { ArrowLeft, Check, Flag, Volume2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { FeedbackBanner } from "../components/FeedbackBanner";
import { HandwritingPad } from "../components/HandwritingPad";
import { MeaningBlock } from "../components/MeaningBlock";
import { TargetText } from "../components/TargetText";
import { Button } from "../components/ui/Button";
import { inputClassName } from "../components/ui/FormField";
import {
  type HandwritingDrawing,
  isExactTypingMatch,
  type ReviewRating,
  type SrsPreview,
} from "../domain";
import {
  cardStudyMarkerRepository,
  srsRepository,
  statisticsRepository,
} from "../data";
import { playCardAudio } from "../services/audio";
import {
  compareHandwriting,
  type HandwritingComparison,
} from "../services/handwriting-comparison";
import { japaneseRomajiReading } from "../services/kana-study-reading";
import { formatVisibleTranslations } from "../services/lesson-data";
import { loadTodayPlan, type TodayCardItem, type TodayPlanData } from "../services/today";

export function TodayPage() {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<TodayPlanData | null>(null);
  const [remainingReviews, setRemainingReviews] = useState<TodayCardItem[]>([]);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [preview, setPreview] = useState<SrsPreview[]>([]);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedRating, setSelectedRating] = useState<ReviewRating | null>(null);
  const [manualCorrect, setManualCorrect] = useState(false);
  const [revealedAsUnknown, setRevealedAsUnknown] = useState(false);
  const [drawing, setDrawing] = useState<HandwritingDrawing>([]);
  const [handwritingComparison, setHandwritingComparison] =
    useState<HandwritingComparison | null>(null);
  const [handwritingCorrect, setHandwritingCorrect] = useState<boolean | null>(null);
  const startedAt = useRef(0);
  const current = remainingReviews[0];
  const currentCardId = current?.card.id;
  const handwriting = Boolean(current?.requiresHandwriting);
  const kanaChoice = Boolean(!handwriting && current?.kanaOptions.length);
  const romajiAnswer = useMemo(
    () => current
      ? japaneseRomajiReading(
          current.card.pronunciationText?.trim() ?? "",
          current.card.targetLanguage,
        ) ?? japaneseRomajiReading(
          current.card.target,
          current.card.targetLanguage,
        )
      : null,
    [current],
  );
  const correct = useMemo(
    () => Boolean(
      current &&
        (isExactTypingMatch(answer, current.card.target) ||
          (romajiAnswer && isExactTypingMatch(answer, romajiAnswer))),
    ),
    [answer, current, romajiAnswer],
  );

  useEffect(() => {
    void loadTodayPlan().then((loaded) => {
      setPlan(loaded);
      setRemainingReviews(loaded.reviewItems);
      startedAt.current = nowMs();
    });
  }, []);

  useEffect(() => {
    if (currentCardId) {
      void srsRepository.preview(currentCardId).then(setPreview);
    }
  }, [currentCardId]);

  const drawingHasInk = drawing.some((stroke) => stroke.length > 0);

  function reveal(event?: FormEvent, unknown = false) {
    event?.preventDefault();
    setRevealedAsUnknown(unknown);
    if (handwriting) {
      if (unknown) {
        setHandwritingComparison(null);
        setHandwritingCorrect(false);
      } else {
        const result = compareHandwriting(
          drawing,
          current?.acceptedDrawingTargets ?? [],
        );
        setHandwritingComparison(result);
        setHandwritingCorrect(result.isMatch);
      }
    }
    setRevealed(true);
    playAnswerAudio();
  }

  function selectKana(glyph: string) {
    setAnswer(glyph);
    setRevealedAsUnknown(false);
    setRevealed(true);
    playAnswerAudio();
  }

  function playAnswerAudio() {
    if (!current) return;
    setAudioStatus(null);
    void playCardAudio(current.card, current.lesson, (status) =>
      setAudioStatus(status === "loading" ? t("audio.loadingProvider") : null),
    ).catch(() => setAudioStatus(t("audio.noVoice")));
  }

  async function rate(rating: ReviewRating) {
    if (!current || saving) return;
    setSaving(true);
    const responseTimeMs = Math.max(0, nowMs() - startedAt.current);
    await Promise.all([
      srsRepository.review(current.card.id, rating),
      statisticsRepository.applyDeltas([
        {
          cardId: current.card.id,
          correctCount: rating === "again" ? 0 : 1,
          errorCount: rating === "again" ? 1 : 0,
          completedQuestions: 1,
          responseTimeMs,
        },
      ]),
    ]);
    setAnswer("");
    setRevealed(false);
    setPreview([]);
    setSelectedRating(null);
    setManualCorrect(false);
    setRevealedAsUnknown(false);
    setDrawing([]);
    setHandwritingComparison(null);
    setHandwritingCorrect(null);
    startedAt.current = nowMs();
    setRemainingReviews((items) => items.slice(1));
    setSaving(false);
  }

  async function toggleDifficult() {
    if (!current) return;
    await cardStudyMarkerRepository.setMarked(
      current.card.id,
      !current.manuallyDifficult,
    );
    setRemainingReviews((items) =>
      items.map((item, index) =>
        index === 0
          ? { ...item, manuallyDifficult: !item.manuallyDifficult }
          : item,
      ),
    );
  }

  if (!plan) return <p>{t("common.loading")}</p>;

  if (!current) {
    const nextGroup = plan.newGroups[0];
    if (nextGroup) {
      const cardIds = nextGroup.cards.map((card) => card.id).join(",");
      return (
        <section className="mx-auto max-w-2xl rounded-3xl border border-sky-200 bg-white p-8 text-center shadow-sm dark:border-sky-900 dark:bg-slate-900">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-sky-600">{t("today.newMaterial")}</p>
          <h1 className="mt-3 text-3xl font-black">{nextGroup.lesson.name}</h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300">
            {t("today.newMaterialBody", { count: nextGroup.cards.length })}
          </p>
          <Link
            className="mt-7 inline-flex min-h-12 items-center rounded-xl bg-slate-950 px-6 font-bold text-white dark:bg-sky-400 dark:text-slate-950"
            to={`/lessons/${nextGroup.lesson.id}/learn?today=1&autostart=1&cards=${encodeURIComponent(cardIds)}`}
          >
            {t("today.startNew")}
          </Link>
        </section>
      );
    }
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-emerald-300 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <h1 className="text-3xl font-black">{t("today.complete")}</h1>
        <p className="mt-3">{t("today.completeBody")}</p>
        <Link className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-emerald-400 px-5 font-bold" to="/">
          {t("today.backToLessons")}
        </Link>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-center justify-between gap-4">
        <Link className="inline-flex items-center gap-2 text-sm font-semibold" to="/">
          <ArrowLeft size={17} aria-hidden="true" /> {t("today.title")}
        </Link>
        <span className="text-sm font-semibold text-slate-500">
          {t("today.remaining", { count: remainingReviews.length })}
        </span>
      </header>
      <main className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <p className="mb-5 text-center text-sm font-semibold text-slate-500">
          {handwriting
            ? t("handwriting.drawPrompt")
            : kanaChoice
              ? t("today.kanaChoicePrompt")
              : t("today.typePrompt")}
        </p>
        <MeaningBlock
          card={current.card}
          translationLanguage={current.lesson.activeTranslationLanguage}
          translationLanguages={current.lesson.visibleTranslationLanguages}
          showImage={current.lesson.useImages}
        />
        {!revealed ? (
          <form className="mt-6 space-y-3" onSubmit={reveal}>
            {handwriting ? (
              <div className="space-y-4">
                <HandwritingPad drawing={drawing} onChange={setDrawing} />
                <div className="flex flex-wrap justify-center gap-2">
                  <Button disabled={!drawingHasInk} type="submit">
                    {t("handwriting.showAnswer")}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => reveal(undefined, true)}>
                    {t("learn.dontKnow")}
                  </Button>
                </div>
              </div>
            ) : kanaChoice ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {current.kanaOptions.map((glyph) => {
                  const selected = answer === glyph;
                  return (
                    <button
                      aria-label={glyph}
                      aria-pressed={selected}
                      className={`min-h-28 rounded-2xl border text-center text-5xl font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-sky-500 ${
                        selected
                          ? "border-sky-500 bg-sky-100 ring-2 ring-sky-400 dark:bg-sky-950"
                          : "border-slate-300 bg-white hover:border-sky-400 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
                      }`}
                      key={glyph}
                      onClick={() => selectKana(glyph)}
                      type="button"
                    >
                      {glyph}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                autoFocus
                autoComplete="off"
                className={inputClassName}
                value={answer}
                placeholder={romajiAnswer ? t("learn.typeJapaneseRomaji") : t("today.yourAnswer")}
                onChange={(event) => setAnswer(event.target.value)}
              />
            )}
            {!handwriting && !kanaChoice && romajiAnswer ? (
              <p className="text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                {t("learn.romajiHint")}
              </p>
            ) : null}
            {!handwriting ? <div className="flex flex-wrap justify-center gap-2">
              {!kanaChoice ? <Button disabled={!answer.trim()} type="submit">{t("today.check")}</Button> : null}
              <Button type="button" variant="secondary" onClick={() => reveal(undefined, true)}>{t("learn.dontKnow")}</Button>
            </div> : null}
          </form>
        ) : (
          <div className="mt-6 space-y-5">
            {handwriting && handwritingCorrect !== null ? (
              <FeedbackBanner
                kind={handwritingCorrect ? "success" : "error"}
                text={handwritingComparison
                  ? t(
                      handwritingCorrect === handwritingComparison.isMatch
                        ? handwritingCorrect
                          ? "handwriting.autoMatch"
                          : "handwriting.autoMismatch"
                        : handwritingCorrect
                          ? "handwriting.correctedMatch"
                          : "handwriting.correctedMismatch",
                      { score: Math.round(handwritingComparison.score * 100) },
                    )
                  : t("handwriting.notDrawn")}
              />
            ) : null}
            {answer.trim() ? (
              <FeedbackBanner
                kind={correct || manualCorrect ? "success" : "error"}
                text={correct || manualCorrect ? t("today.answerCorrect") : t("today.answerDifferent")}
              />
            ) : null}
            {answer.trim() && !correct && !manualCorrect && !revealedAsUnknown ? (
              <div className="flex justify-center">
                <Button type="button" variant="secondary" onClick={() => setManualCorrect(true)}>
                  {t("learn.iWasCorrect")}
                </Button>
              </div>
            ) : null}
            {!handwriting && revealedAsUnknown && !manualCorrect ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setManualCorrect(true)}
                >
                  {t("learn.iWasCorrect")}
                </Button>
              </div>
            ) : null}
            {!handwriting && revealedAsUnknown && manualCorrect ? (
              <FeedbackBanner kind="success" text={t("today.answerCorrect")} />
            ) : null}
            {handwriting ? (
              <div className="grid gap-4 sm:grid-cols-2 sm:items-center">
                <div>
                  <p className="mb-2 text-center text-sm font-bold">{t("handwriting.yourDrawing")}</p>
                  <HandwritingPad disabled drawing={drawing} />
                </div>
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-center dark:border-sky-800 dark:bg-sky-950">
                  <p className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{t("handwriting.reference")}</p>
                  <p className="text-7xl font-black"><TargetText {...current.card} /></p>
                  {current.card.pronunciationText ? <p className="mt-1 text-slate-600 dark:text-slate-300">{current.card.pronunciationText}</p> : null}
                  <p className="mt-2 font-semibold">{formatVisibleTranslations(current.card, current.lesson, " · ")}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-center dark:border-sky-800 dark:bg-sky-950">
                <p className="text-3xl font-black"><TargetText {...current.card} /></p>
                {current.card.pronunciationText ? <p className="mt-1 text-slate-600 dark:text-slate-300">{current.card.pronunciationText}</p> : null}
                <p className="mt-2 font-semibold">{formatVisibleTranslations(current.card, current.lesson, " · ")}</p>
              </div>
            )}
            {handwriting ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setHandwritingCorrect(true)} type="button" variant={handwritingCorrect ? "primary" : "secondary"}>
                  {handwritingComparison?.isMatch ? t("handwriting.confirmMatch") : t("handwriting.systemWrongMatch")}
                </Button>
                <Button onClick={() => setHandwritingCorrect(false)} type="button" variant={handwritingCorrect === false ? "primary" : "secondary"}>
                  {handwritingComparison?.isMatch ? t("handwriting.systemWrongMismatch") : t("handwriting.confirmMismatch")}
                </Button>
                <Button onClick={() => { setDrawing([]); setRevealed(false); setHandwritingComparison(null); setHandwritingCorrect(null); }} type="button" variant="ghost">
                  {t("handwriting.tryAgain")}
                </Button>
              </div>
            ) : null}
            <div className="space-y-2 text-center">
              <p className="font-bold">{t("today.howWell")}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("today.ratingHint")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              {(["easy", "good", "hard", "again"] as const).map((rating) => {
                const selected = selectedRating === rating;
                return (
                  <button
                    aria-pressed={selected}
                    className={`relative min-h-20 rounded-2xl border px-4 py-4 text-center text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-sky-500 ${
                      selected
                        ? "border-sky-400 bg-sky-400 text-slate-950 shadow-lg shadow-sky-500/20"
                        : "border-slate-300 bg-white hover:border-sky-400 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-sky-700 dark:hover:bg-slate-800"
                    }`}
                    disabled={saving || (handwriting && handwritingCorrect === null)}
                    key={rating}
                    onClick={() => setSelectedRating(rating)}
                    type="button"
                  >
                    {selected ? (
                      <Check className="absolute right-2 top-2" size={17} aria-hidden="true" />
                    ) : null}
                    {t(`today.rating.${rating}`)}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4 sm:flex-row dark:bg-slate-950">
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                {selectedRating
                  ? t("today.nextReview", {
                      interval: formatInterval(
                        preview.find((item) => item.rating === selectedRating)?.intervalMs,
                        t,
                      ),
                    })
                  : t("today.selectRating")}
              </p>
              <Button
                className="w-full sm:w-auto"
                disabled={!selectedRating || saving}
                onClick={() => selectedRating && void rate(selectedRating)}
                type="button"
              >
                {t("today.nextTask")}
              </Button>
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" variant="ghost" icon={<Flag size={18} />} onClick={() => void toggleDifficult()}>
            {current.manuallyDifficult ? t("training.unmarkDifficult") : t("training.markDifficult")}
          </Button>
          <Button type="button" variant="ghost" icon={<Volume2 size={18} />} onClick={playAnswerAudio}>
            {t("learn.replay")}
          </Button>
        </div>
        {audioStatus ? <p className="mt-3 text-center text-sm font-semibold" role="status">{audioStatus}</p> : null}
      </main>
    </div>
  );
}

function formatInterval(milliseconds: number | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (milliseconds === undefined) return "";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return t("today.intervalMinutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("today.intervalHours", { count: hours });
  return t("today.intervalDays", { count: Math.round(hours / 24) });
}

function nowMs(): number {
  return Date.now();
}
