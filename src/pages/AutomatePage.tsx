import { ArrowLeft, Grid2X2, MousePointerClick, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { LessonReadinessPanel } from "../components/LessonReadinessPanel";
import { PageHeader } from "../components/PageHeader";
import { useLessonBundle } from "../hooks/useLessonBundle";
import { useAudioAvailability } from "../hooks/useAudioAvailability";
import { getLessonReadiness } from "../services/lesson-data";

export function AutomatePage() {
  const { lessonId } = useParams();
  const bundle = useLessonBundle(lessonId);
  const { t } = useTranslation();
  const audioAvailable = useAudioAvailability(bundle?.lesson);
  if (bundle === undefined) return <p>{t("common.loading")}</p>;
  if (!bundle) return <p>{t("notFound.title")}</p>;
  const { lesson, cards } = bundle;
  const ready =
    cards.length > 0 &&
    getLessonReadiness(cards, lesson, audioAvailable).length === 0;
  return (
    <div className="space-y-7">
      <Link
        className="inline-flex items-center gap-2 text-sm font-semibold"
        to={`/lessons/${lesson.id}`}
      >
        <ArrowLeft size={17} aria-hidden="true" />
        {t("common.back")}
      </Link>
      <PageHeader
        title={t("automate.title")}
        description={t("automate.body")}
      />
      {!ready ? (
        <LessonReadinessPanel lesson={lesson} cards={cards} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <ModeLink
            to={`/lessons/${lesson.id}/quick-choice`}
            icon={<MousePointerClick size={32} aria-hidden="true" />}
            title={t("automate.quick")}
            body={`${t("quick.mixed")} · 10 / 20 / 50 / ${t("quick.endless")}`}
          />
          <ModeLink
            to={`/lessons/${lesson.id}/chaos`}
            icon={<Grid2X2 size={32} aria-hidden="true" />}
            title={t("automate.chaos")}
            body={`${t("chaos.words")} ↔ ${t("chaos.meanings")}`}
          />
          <ModeLink
            to={`/practice?lesson=${lesson.id}`}
            icon={<SlidersHorizontal size={32} aria-hidden="true" />}
            title={t("training.title")}
            body={t("training.body")}
          />
        </div>
      )}
    </div>
  );
}

function ModeLink({
  to,
  icon,
  title,
  body,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm outline-none hover:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-800 dark:bg-slate-900"
      to={to}
    >
      <div className="text-sky-600 dark:text-sky-300">{icon}</div>
      <h2 className="mt-5 text-2xl font-black group-hover:text-sky-700 dark:group-hover:text-sky-300">
        {title}
      </h2>
      <p className="mt-2 text-slate-600 dark:text-slate-300">{body}</p>
    </Link>
  );
}
