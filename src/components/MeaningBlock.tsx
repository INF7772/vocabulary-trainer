import type { Card } from "../domain";

import { CardImage } from "./CardImage";

export function MeaningBlock({
  card,
  translationLanguage,
  translationLanguages,
  compact = false,
  showImage = true,
}: {
  card: Card;
  translationLanguage: string;
  translationLanguages?: string[];
  compact?: boolean;
  showImage?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {showImage && card.image ? (
        <CardImage
          image={card.image}
          className={compact ? "aspect-[4/3] w-full" : "aspect-[16/10] w-full"}
          loading="eager"
        />
      ) : null}
      <div className={`${compact ? "px-3 py-2 text-sm" : "px-5 py-4 text-xl"} space-y-1 text-center font-semibold`}>
        {[...new Set(translationLanguages ?? [translationLanguage])].map(
          (language) => (
            <p key={language}>
              {(translationLanguages?.length ?? 1) > 1 ? (
                <span className="mr-2 text-xs font-bold uppercase text-slate-500">
                  {language}
                </span>
              ) : null}
              {card.translations[language]}
            </p>
          ),
        )}
      </div>
    </div>
  );
}
