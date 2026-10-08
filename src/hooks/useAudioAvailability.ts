import type { Lesson } from "../domain";
import { isApplicationProviderSupported } from "../services/audio";
import { useVoices } from "./useVoices";

export function useAudioAvailability(lesson: Lesson | undefined): boolean {
  const voices = useVoices(lesson?.tts.targetLocale ?? "");
  return Boolean(
    lesson &&
      (voices.length > 0 ||
        isApplicationProviderSupported(
          lesson.tts.fallbackProviderId,
          lesson.tts.targetLocale,
        )),
  );
}
