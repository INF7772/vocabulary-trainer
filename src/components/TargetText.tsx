import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

import { settingsRepository } from "../data";
import { generateJapaneseReading } from "../services/japanese-readings";
import { shouldShowJapaneseReading } from "../utils/japanese-readings";

export function TargetText({
  target,
  pronunciationText,
  targetLanguage,
}: {
  target: string;
  pronunciationText?: string;
  targetLanguage: string;
}) {
  const settings = useLiveQuery(() => settingsRepository.get(), []);
  const [generatedReading, setGeneratedReading] = useState("");
  const showReading = shouldShowJapaneseReading(
    Boolean(settings?.showJapaneseReadings),
    targetLanguage,
    target,
  );
  const reading = pronunciationText?.trim() || generatedReading;

  useEffect(() => {
    let active = true;
    if (!showReading || pronunciationText?.trim()) return () => { active = false; };
    void generateJapaneseReading(target)
      .then((value) => {
        if (active) setGeneratedReading(value);
      })
      .catch((error) => {
        console.error("Japanese reading generation failed.", error);
        if (active) setGeneratedReading("");
      });
    return () => { active = false; };
  }, [pronunciationText, showReading, target]);

  if (!showReading || !reading) return <>{target}</>;

  return (
    <ruby>
      {target}
      <rp>(</rp>
      <rt className="text-[0.55em] font-medium">{reading}</rt>
      <rp>)</rp>
    </ruby>
  );
}
