import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, CalendarCheck2, Flag, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { loadTodayPlan } from "../services/today";

export function TodayOverview() {
  const { t } = useTranslation();
  const plan = useLiveQuery(() => loadTodayPlan(), []);
  if (!plan) return <p>{t("common.loading")}</p>;
  const total = plan.dueCount + plan.newCount;

  return (
    <section className="overflow-hidden rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-indigo-50 shadow-sm dark:border-sky-900 dark:from-sky-950 dark:via-slate-900 dark:to-indigo-950">
      <div className="p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">
              {t("today.title")}
            </p>
            <h2 className="mt-2 text-3xl font-black">
              {total > 0 ? t("today.ready") : t("today.complete")}
            </h2>
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              {total > 0
                ? t("today.estimate", { minutes: plan.estimatedMinutes })
                : t("today.completeBody")}
            </p>
          </div>
          {total > 0 ? (
            <Link
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 font-bold text-white hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
              to="/today"
            >
              {t("today.continue")} <ArrowRight size={19} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <Metric icon={<CalendarCheck2 />} label={t("today.reviews")} value={plan.dueCount} />
          <Metric icon={<Flag />} label={t("today.difficult")} value={plan.difficultCount} />
          <Metric icon={<Sparkles />} label={t("today.newCards")} value={plan.newCount} />
        </div>
      </div>
      {plan.lessonQueue.length > 0 ? (
        <details className="border-t border-sky-100 bg-white/60 px-6 py-4 dark:border-sky-900 dark:bg-slate-950/30">
          <summary className="cursor-pointer font-bold">{t("today.materialQueue")}</summary>
          <div className="mt-4 space-y-3">
            {plan.lessonQueue.map(({ lesson, introducedCount, cardCount }, index) => (
              <div className="flex items-center gap-3" key={lesson.id}>
                <span className="min-w-0 flex-1 truncate font-semibold">{index + 1}. {lesson.name}</span>
                <span className="text-sm text-slate-500">{introducedCount}/{cardCount}</span>
                <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <span
                    className="block h-full bg-sky-500"
                    style={{ width: `${cardCount ? (introducedCount / cardCount) * 100 : 0}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/80 p-4 dark:bg-slate-900/80">
      <span className="text-sky-600 dark:text-sky-300">{icon}</span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <strong className="text-2xl">{value}</strong>
    </div>
  );
}
