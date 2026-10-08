import { normalizeLanguageCode } from "../config/languages";

export function shouldShowJapaneseReading(
  enabled: boolean,
  targetLanguage: string,
  target: string,
): boolean {
  return Boolean(
    enabled &&
      normalizeLanguageCode(targetLanguage) === "ja" &&
      /[\p{Script=Han}]/u.test(target),
  );
}
