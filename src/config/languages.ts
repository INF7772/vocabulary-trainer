import type { LanguageCode } from "../domain";

export interface LanguageDefinition {
  code: LanguageCode;
  nameKey: string;
  englishName: string;
  preferredTtsLocale: string;
  aliases: readonly string[];
  sampleText: string;
}

export const languageRegistry: readonly LanguageDefinition[] = [
  {
    code: "de",
    nameKey: "languages.de",
    englishName: "German",
    preferredTtsLocale: "de-DE",
    aliases: ["deu", "ger"],
    sampleText: "Guten Tag",
  },
  {
    code: "en",
    nameKey: "languages.en",
    englishName: "English",
    preferredTtsLocale: "en-US",
    aliases: ["eng"],
    sampleText: "Hello",
  },
  {
    code: "es",
    nameKey: "languages.es",
    englishName: "Spanish",
    preferredTtsLocale: "es-ES",
    aliases: ["spa"],
    sampleText: "Hola",
  },
  {
    code: "fr",
    nameKey: "languages.fr",
    englishName: "French",
    preferredTtsLocale: "fr-FR",
    aliases: ["fra", "fre"],
    sampleText: "Bonjour",
  },
  {
    code: "it",
    nameKey: "languages.it",
    englishName: "Italian",
    preferredTtsLocale: "it-IT",
    aliases: ["ita"],
    sampleText: "Buongiorno",
  },
  {
    code: "ja",
    nameKey: "languages.ja",
    englishName: "Japanese",
    preferredTtsLocale: "ja-JP",
    aliases: ["jpn", "jp"],
    sampleText: "こんにちは",
  },
  {
    code: "ko",
    nameKey: "languages.ko",
    englishName: "Korean",
    preferredTtsLocale: "ko-KR",
    aliases: ["kor", "kr"],
    sampleText: "안녕하세요",
  },
  {
    code: "ru",
    nameKey: "languages.ru",
    englishName: "Russian",
    preferredTtsLocale: "ru-RU",
    aliases: ["rus"],
    sampleText: "Здравствуйте",
  },
  {
    code: "uk",
    nameKey: "languages.uk",
    englishName: "Ukrainian",
    preferredTtsLocale: "uk-UA",
    aliases: ["ukr", "ua"],
    sampleText: "Вітаю",
  },
  {
    code: "zh",
    nameKey: "languages.zh",
    englishName: "Chinese",
    preferredTtsLocale: "zh-CN",
    aliases: ["zho", "chi", "cmn"],
    sampleText: "你好",
  },
];

const byCode = new Map(
  languageRegistry.flatMap((language) => [
    [language.code, language] as const,
    ...language.aliases.map((alias) => [alias, language] as const),
  ]),
);

export function normalizeLanguageCode(value: string): LanguageCode {
  const normalized = value.trim().replace(/_/gu, "-").toLowerCase();
  const base = normalized.split("-")[0];
  return byCode.get(normalized)?.code ?? byCode.get(base)?.code ?? normalized;
}

export function findLanguage(value: string): LanguageDefinition | undefined {
  const normalized = normalizeLanguageCode(value);
  return languageRegistry.find((language) => language.code === normalized);
}

export function preferredTtsLocale(value: string): string {
  return findLanguage(value)?.preferredTtsLocale ?? value.trim();
}

export function isPlausibleLanguageTag(value: string): boolean {
  const normalized = value.trim().replace(/_/gu, "-");
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(normalized)) return false;
  try {
    return Intl.getCanonicalLocales(normalized).length === 1;
  } catch {
    return false;
  }
}

export function languageDisplayName(
  code: string,
  translate?: (key: string) => string,
): string {
  const language = findLanguage(code);
  if (!language) return code;
  const localized = translate?.(language.nameKey);
  return localized && localized !== language.nameKey
    ? localized
    : language.englishName;
}
