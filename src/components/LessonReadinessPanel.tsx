import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Card, Lesson } from "../domain";
import { useAudioAvailability } from "../hooks/useAudioAvailability";
import { getLessonReadiness } from "../services/lesson-data";

export function LessonReadinessPanel({
  lesson,
  cards,
}: {
  lesson: Lesson;
  cards: readonly Card[];
}) {
  const { t } = useTranslation();
  const readiness = getLessonReadiness(
    cards,
    lesson,
    useAudioAvailability(lesson),
  );

  if (cards.length > 0 && readiness.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" />
        <div>
          <h2 className="font-bold">{t("readiness.title")}</h2>
          <p className="mt-1 text-sm">
            {cards.length === 0
              ? t("readiness.empty")
              : t("readiness.count", { count: readiness.length })}
          </p>
          {cards.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {readiness.map(
                ({ card, issues, missingTranslationLanguages }) => {
                const labels = issues.map((issue) =>
                  issue === "missing-translation"
                    ? `${t("card.missingTranslation")}: ${missingTranslationLanguages.join(", ").toUpperCase()}`
                    : t("card.audioUnavailable"),
                );
                return (
                  <li key={card.id}>
                    <Link
                      className="font-semibold underline"
                      to={`/lessons/${lesson.id}/cards/${card.id}`}
                    >
                      {card.target}
                    </Link>
                    {" — "}
                    {labels.join(", ")}
                  </li>
                );
                },
              )}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
