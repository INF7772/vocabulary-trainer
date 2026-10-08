import { useEffect, useState } from "react";

import {
  getMatchingVoices,
  isSpeechSynthesisSupported,
} from "../services/audio";

export function useVoices(locale: string): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    getMatchingVoices(locale),
  );

  useEffect(() => {
    if (!isSpeechSynthesisSupported()) {
      return;
    }

    const update = () => setVoices(getMatchingVoices(locale));
    const timer = window.setTimeout(update, 0);
    globalThis.speechSynthesis.addEventListener("voiceschanged", update);
    return () => {
      window.clearTimeout(timer);
      globalThis.speechSynthesis.removeEventListener("voiceschanged", update);
    };
  }, [locale]);

  return voices;
}
