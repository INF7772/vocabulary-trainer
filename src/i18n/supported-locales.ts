import { languageRegistry } from "../config/languages";
import type { InterfaceLanguage } from "../domain";

export const interfaceLanguageCodes = languageRegistry.map(
  (language) => language.code,
) as InterfaceLanguage[];

export function interfaceLanguageForSystemLocale(
  locale: string | undefined,
): InterfaceLanguage {
  const detectedLanguage = locale?.split(/[-_]/u)[0].toLowerCase();
  return interfaceLanguageCodes.includes(detectedLanguage as InterfaceLanguage)
    ? (detectedLanguage as InterfaceLanguage)
    : "en";
}
