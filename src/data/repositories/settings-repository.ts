import type {
  ApplicationSettings,
  InterfaceLanguage,
  ThemePreference,
} from "../../domain";
import {
  interfaceLanguageCodes,
  interfaceLanguageForSystemLocale,
} from "../../i18n/supported-locales";
import type { VocabularyTrainerDatabase } from "../database";
import { type Clock, systemClock } from "./shared";

export type UpdateSettingsInput = Partial<
  Pick<
    ApplicationSettings,
    | "interfaceLanguage"
    | "theme"
    | "defaultTargetLanguage"
    | "translationLanguages"
    | "defaultActiveTranslationLanguage"
    | "defaultVisibleTranslationLanguages"
    | "useImages"
    | "showJapaneseReadings"
    | "maximumNewCardsPerDay"
    | "audioPreferences"
  >
>;

export class SettingsRepository {
  constructor(
    private readonly db: VocabularyTrainerDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  async get(): Promise<ApplicationSettings> {
    const settings = await this.db.settings.get("application");
    return settings ? withSettingsDefaults(settings) : this.createDefaults();
  }

  async update(input: UpdateSettingsInput): Promise<ApplicationSettings> {
    const current = await this.get();
    const updated = withSettingsDefaults({
      ...current,
      ...input,
      id: "application",
      createdAt: current.createdAt,
      updatedAt: this.clock(),
    });

    await this.db.settings.put(updated);
    return updated;
  }

  async reset(): Promise<ApplicationSettings> {
    const settings = this.createDefaults();

    await this.db.settings.put(settings);
    return settings;
  }

  private createDefaults(): ApplicationSettings {
    const now = this.clock();
    return {
      id: "application",
      interfaceLanguage: detectInterfaceLanguage(),
      theme: "dark",
      defaultTargetLanguage: null,
      translationLanguages: ["en"],
      defaultActiveTranslationLanguage: "en",
      defaultVisibleTranslationLanguages: ["en"],
      useImages: true,
      showJapaneseReadings: false,
      maximumNewCardsPerDay: 10,
      audioPreferences: {},
      createdAt: now,
      updatedAt: now,
    };
  }
}

export function withSettingsDefaults(
  settings: Pick<
    ApplicationSettings,
    "id" | "interfaceLanguage" | "theme" | "createdAt" | "updatedAt"
  > &
    Partial<ApplicationSettings>,
): ApplicationSettings {
  const translationLanguages = settings.translationLanguages?.length
    ? [...new Set(settings.translationLanguages)]
    : ["en"];
  const defaultActiveTranslationLanguage = translationLanguages.includes(
    settings.defaultActiveTranslationLanguage ?? "",
  )
    ? settings.defaultActiveTranslationLanguage!
    : translationLanguages[0];
  const configuredVisible = settings.defaultVisibleTranslationLanguages ?? [
    defaultActiveTranslationLanguage,
  ];
  const defaultVisibleTranslationLanguages = [
    ...new Set(
      [defaultActiveTranslationLanguage, ...configuredVisible].filter(
        (language) => translationLanguages.includes(language),
      ),
    ),
  ];
  return {
    ...settings,
    id: "application",
    defaultTargetLanguage: settings.defaultTargetLanguage ?? null,
    translationLanguages,
    defaultActiveTranslationLanguage,
    defaultVisibleTranslationLanguages,
    useImages: settings.useImages ?? true,
    showJapaneseReadings: settings.showJapaneseReadings ?? false,
    maximumNewCardsPerDay: Math.max(
      0,
      Math.min(50, Math.floor(settings.maximumNewCardsPerDay ?? 10)),
    ),
    audioPreferences: settings.audioPreferences ?? {},
  } as ApplicationSettings;
}

function detectInterfaceLanguage(): InterfaceLanguage {
  return interfaceLanguageForLocale(globalThis.navigator?.language);
}

export function interfaceLanguageForLocale(
  locale: string | undefined,
): InterfaceLanguage {
  return interfaceLanguageForSystemLocale(locale);
}

export { interfaceLanguageCodes };

export const themePreferences: ThemePreference[] = ["system", "light", "dark"];
