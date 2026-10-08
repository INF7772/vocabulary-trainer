import {
  ArchiveRestore,
  ChevronDown,
  Database,
  Download,
  Languages,
  Sparkles,
  Settings2,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { LanguageInput } from "../components/LanguageInput";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { FormField, inputClassName } from "../components/ui/FormField";
import {
  findLanguage,
  isPlausibleLanguageTag,
  languageDisplayName,
  normalizeLanguageCode,
  preferredTtsLocale,
} from "../config/languages";
import { lessonsRepository, settingsRepository } from "../data";
import type {
  ApplicationSettings,
  InterfaceLanguage,
  LanguageAudioPreference,
  Lesson,
  ThemePreference,
} from "../domain";
import { interfaceLanguageCodes } from "../i18n/supported-locales";
import { useVoices } from "../hooks/useVoices";
import {
  KOKORO_JAPANESE_DOWNLOAD_ESTIMATE_MB,
  KOKORO_JAPANESE_PROVIDER_ID,
  KOKORO_JAPANESE_VOICES,
  isApplicationProviderSupported,
  japaneseProviderId,
  playCardAudio,
  prepareGeneratedAudioForCards,
} from "../services/audio";
import { getUserErrorKey } from "../services/errors";
import { syncLessonToLibrary } from "../services/lesson-library";
import {
  downloadBlob,
  exportFullBackup,
  restoreFullBackup,
} from "../services/portability";
import { requestPersistentStorage } from "../services/storage";
import {
  deleteTranslationPackage,
  getTranslationPackageStatus,
  installTranslationPackage,
  onTranslationPackageProgress,
  translationCapabilities,
  type TranslationPackageProgress,
  type TranslationPackageStatus,
} from "../services/translation-packages";
import { localTranslationProvider } from "../services/translator";
import {
  getDesktopStorageInfo,
  type DesktopStorageInfo,
} from "../services/desktop-shell";
import {
  deleteJapaneseVoicePackage,
  getJapaneseVoicePackageStatus,
  installJapaneseVoicePackage,
  openSystemVoiceSettings,
  supportsDownloadableVoicePackages,
  supportsSystemVoiceSettings,
  type VoicePackageProgress,
  type VoicePackageStatus,
} from "../services/voice-packages";

type Operation = "backup" | "restore" | "voice" | "save" | null;
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState<ApplicationSettings | null>(null);
  const [newLanguage, setNewLanguage] = useState("");
  const [newAudioLanguage, setNewAudioLanguage] = useState("");
  const [voicePackage, setVoicePackage] = useState<VoicePackageStatus | null>(null);
  const [voiceProgress, setVoiceProgress] = useState<VoicePackageProgress | null>(null);
  const [desktopStorage, setDesktopStorage] = useState<DesktopStorageInfo | null>(null);
  const [translationPackages, setTranslationPackages] = useState<Record<string, TranslationPackageStatus>>({});
  const [translationProgress, setTranslationProgress] = useState<Record<string, TranslationPackageProgress>>({});
  const [translationOperation, setTranslationOperation] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([
      settingsRepository.get(),
      getJapaneseVoicePackageStatus(),
      getDesktopStorageInfo(),
    ]).then(
      ([settings, packageStatus, desktopStorageInfo]) => {
        setForm(settings);
        setVoicePackage(packageStatus);
        setDesktopStorage(desktopStorageInfo);
      },
    );
  }, []);

  useEffect(() => {
    void Promise.all(
      translationCapabilities.map(async (capability) => [
        capability.id,
        await getTranslationPackageStatus(capability),
      ] as const),
    ).then((entries) => setTranslationPackages(Object.fromEntries(entries)));
    return onTranslationPackageProgress((progress) => {
      setTranslationProgress((current) => ({
        ...current,
        [progress.packageId]: progress,
      }));
    });
  }, []);

  async function installOfflineTranslation(packageId: string) {
    const capability = translationCapabilities.find((item) => item.id === packageId);
    if (!capability) return;
    setTranslationOperation(packageId);
    setStatus(null);
    try {
      const result = await installTranslationPackage(capability);
      setTranslationPackages((current) => ({ ...current, [packageId]: result }));
      setTranslationProgress((current) => {
        const next = { ...current };
        delete next[packageId];
        return next;
      });
    } catch {
      setStatus(t("settings.translationPackageFailed"));
    } finally {
      setTranslationOperation(null);
    }
  }

  async function removeOfflineTranslation(packageId: string) {
    const capability = translationCapabilities.find((item) => item.id === packageId);
    if (!capability) return;
    setTranslationOperation(packageId);
    try {
      const result = await deleteTranslationPackage(capability);
      await localTranslationProvider.clear(packageId);
      setTranslationPackages((current) => ({ ...current, [packageId]: result }));
    } catch {
      setStatus(t("settings.translationPackageFailed"));
    } finally {
      setTranslationOperation(null);
    }
  }

  function updateForm(input: Partial<ApplicationSettings>) {
    setForm((current) => (current ? { ...current, ...input } : current));
  }

  function updateAudio(language: string, input: Partial<LanguageAudioPreference>) {
    if (!form) return;
    const current = form.audioPreferences[language] ?? {
      targetLocale: preferredTtsLocale(language),
      speechRate: 1,
    };
    updateForm({
      audioPreferences: {
        ...form.audioPreferences,
        [language]: { ...current, ...input },
      },
    });
  }

  function addAudioLanguage() {
    if (!form || !isPlausibleLanguageTag(newAudioLanguage)) {
      setStatus(t("wizard.invalidLanguage"));
      return;
    }
    const language = normalizeLanguageCode(newAudioLanguage);
    updateAudio(language, {});
    setNewAudioLanguage("");
    setStatus(null);
  }

  function removeAudioLanguage(language: string) {
    if (!form) return;
    const audioPreferences = { ...form.audioPreferences };
    delete audioPreferences[language];
    updateForm({ audioPreferences });
  }

  function addTranslationLanguage() {
    if (!form || !isPlausibleLanguageTag(newLanguage)) {
      setStatus(t("wizard.invalidLanguage"));
      return;
    }
    const language = normalizeLanguageCode(newLanguage);
    updateForm({
      translationLanguages: [
        ...new Set([...form.translationLanguages, language]),
      ],
    });
    setNewLanguage("");
    setStatus(null);
  }

  function removeTranslationLanguage(language: string) {
    if (!form || form.translationLanguages.length === 1) return;
    const next = form.translationLanguages.filter((item) => item !== language);
    const nextVisible = form.defaultVisibleTranslationLanguages.filter(
      (item) => next.includes(item),
    );
    const selected = nextVisible.length > 0 ? nextVisible : [next[0]];
    updateForm({
      translationLanguages: next,
      defaultActiveTranslationLanguage: selected[0],
      defaultVisibleTranslationLanguages: selected,
    });
  }

  async function installVoicePackage() {
    if (!form) return;
    setOperation("voice");
    setVoiceProgress(null);
    setStatus(null);
    try {
      const installed = await installJapaneseVoicePackage(setVoiceProgress);
      setVoicePackage(installed);
      const japanesePreference = {
        ...(form.audioPreferences.ja ?? {
          targetLocale: preferredTtsLocale("ja"),
          speechRate: 1,
        }),
        targetLocale: preferredTtsLocale("ja"),
        fallbackProviderId: japaneseProviderId(KOKORO_JAPANESE_VOICES[0].id),
      };
      const audioPreferences = {
        ...form.audioPreferences,
        ja: japanesePreference,
      };
      updateForm({ audioPreferences });
      await settingsRepository.update({ audioPreferences });
      const japaneseLessons = (await lessonsRepository.list()).filter(
        (lesson) => normalizeLanguageCode(lesson.targetLanguage) === "ja",
      );
      for (const lesson of japaneseLessons) {
        await lessonsRepository.update(lesson.id, { tts: japanesePreference });
      }
      setDesktopStorage(await getDesktopStorageInfo());
      setStatus(t("audio.packageInstalled"));
    } catch {
      setStatus(t("audio.packageDownloadFailed"));
    } finally {
      setVoiceProgress(null);
      setOperation(null);
    }
  }

  async function deleteVoicePackage() {
    if (!form) return;
    setOperation("voice");
    try {
      setVoicePackage(await deleteJapaneseVoicePackage());
      const audioPreferences = Object.fromEntries(
          Object.entries(form.audioPreferences).map(([language, preference]) => [
            language,
            preference.fallbackProviderId?.startsWith(KOKORO_JAPANESE_PROVIDER_ID)
              ? { ...preference, fallbackProviderId: undefined }
              : preference,
          ]),
        );
      updateForm({ audioPreferences });
      await settingsRepository.update({ audioPreferences });
      const japaneseLessons = (await lessonsRepository.list()).filter(
        (lesson) => normalizeLanguageCode(lesson.targetLanguage) === "ja",
      );
      for (const lesson of japaneseLessons) {
        await lessonsRepository.update(lesson.id, {
          tts: {
            ...lesson.tts,
            fallbackProviderId: undefined,
          },
        });
      }
      setDesktopStorage(await getDesktopStorageInfo());
      setStatus(t("audio.packageDeleted"));
    } catch {
      setStatus(t("errors.storage"));
    } finally {
      setOperation(null);
    }
  }

  async function saveSettings() {
    if (!form) return;
    if (
      form.defaultTargetLanguage &&
      !isPlausibleLanguageTag(form.defaultTargetLanguage)
    ) {
      setStatus(t("wizard.invalidLanguage"));
      return;
    }
    setOperation("save");
    const normalizedTarget = form.defaultTargetLanguage
      ? normalizeLanguageCode(form.defaultTargetLanguage)
      : null;
    const saved = await settingsRepository.update({
      interfaceLanguage: form.interfaceLanguage,
      theme: form.theme,
      defaultTargetLanguage: normalizedTarget,
      translationLanguages: form.translationLanguages,
      defaultActiveTranslationLanguage: form.defaultActiveTranslationLanguage,
      defaultVisibleTranslationLanguages:
        form.defaultVisibleTranslationLanguages,
      useImages: form.useImages,
      showJapaneseReadings: form.showJapaneseReadings,
      maximumNewCardsPerDay: form.maximumNewCardsPerDay,
      audioPreferences: form.audioPreferences,
    });
    setForm(saved);
    await i18n.changeLanguage(saved.interfaceLanguage);
    const lessons = await lessonsRepository.list();
    for (const lesson of lessons) {
      const selected = saved.defaultVisibleTranslationLanguages.filter(
        (language) => lesson.translationLanguages.includes(language),
      );
      const visible = selected.length > 0
        ? selected
        : lesson.visibleTranslationLanguages;
      const updated = await lessonsRepository.update(lesson.id, {
        activeTranslationLanguage: visible[0],
        visibleTranslationLanguages: visible,
        useImages: saved.useImages,
        tts: saved.audioPreferences[lesson.targetLanguage] ?? lesson.tts,
      });
      await prepareGeneratedAudioForCards(
        await lessonsRepository.listCards(lesson.id),
        updated,
        (progress) =>
          setStatus(
            t("audio.preparingCards", {
              completed: progress.completed,
              total: progress.total,
            }),
          ),
      );
      await syncLessonToLibrary(updated.id);
    }
    setStatus(t("settings.saved"));
    setDesktopStorage(await getDesktopStorageInfo());
    setOperation(null);
  }

  async function previewVoice(languageCode: string) {
    if (!form) return;
    setAudioStatus(null);
    const language = findLanguage(languageCode);
    const audioPreference = form.audioPreferences[languageCode] ?? {
      targetLocale: preferredTtsLocale(languageCode),
      speechRate: 1,
    };
    const now = new Date().toISOString();
    const lesson: Lesson = {
      id: "settings-preview",
      name: "Preview",
      targetLanguage: languageCode,
      translationLanguages: form.translationLanguages,
      activeTranslationLanguage: form.defaultActiveTranslationLanguage,
      visibleTranslationLanguages: form.defaultVisibleTranslationLanguages,
      useImages: false,
      tts: audioPreference,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await playCardAudio(
        {
          id: "settings-preview",
          target: language?.sampleText ?? languageCode,
          targetLanguage: languageCode,
          translations: {},
          image: null,
          createdAt: now,
          updatedAt: now,
        },
        lesson,
        (next) =>
          setAudioStatus(
            next === "loading" ? t("audio.loadingProvider") : null,
          ),
      );
    } catch {
      setAudioStatus(t("audio.noVoice"));
    }
  }

  async function exportBackup() {
    setOperation("backup");
    setStatus(null);
    try {
      const blob = await exportFullBackup();
      downloadBlob(
        blob,
        `vocabulary-trainer-${new Date().toISOString().slice(0, 10)}.vtbackup`,
      );
      setStatus(t("settings.backupReady"));
    } catch (error) {
      setStatus(t(getUserErrorKey(error)));
    } finally {
      setOperation(null);
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !window.confirm(t("settings.restoreConfirm"))) return;
    setOperation("restore");
    setStatus(null);
    try {
      const result = await restoreFullBackup(file);
      await requestPersistentStorage();
      setDesktopStorage(await getDesktopStorageInfo());
      setForm(await settingsRepository.get());
      setStatus(
        t("settings.restored", {
          lessons: result.lessonCount,
          cards: result.cardCount,
        }),
      );
    } catch (error) {
      setStatus(t(getUserErrorKey(error)));
    } finally {
      setOperation(null);
    }
  }


  if (!form) return <p>{t("common.loading")}</p>;
  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description")}
      />
      {status ? (
        <p
          className="rounded-xl bg-sky-50 p-3 text-sky-900 dark:bg-sky-950 dark:text-sky-100"
          role="status"
        >
          {status}
        </p>
      ) : null}

      <SettingsSection defaultOpen icon={<Settings2 />} title={t("settings.general")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            htmlFor="settings-maximum-new"
            label={t("settings.maximumNewCardsPerDay")}
            hint={t("settings.maximumNewCardsPerDayBody")}
          >
            <input
              className={inputClassName}
              id="settings-maximum-new"
              min="0"
              max="50"
              type="number"
              value={form.maximumNewCardsPerDay}
              onChange={(event) =>
                updateForm({
                  maximumNewCardsPerDay: Math.max(
                    0,
                    Math.min(50, Number(event.target.value) || 0),
                  ),
                })
              }
            />
          </FormField>
          <FormField
            htmlFor="settings-interface"
            label={t("settings.interfaceLanguage")}
          >
            <select
              id="settings-interface"
              className={inputClassName}
              value={form.interfaceLanguage}
              onChange={(event) =>
                updateForm({
                  interfaceLanguage: event.target.value as InterfaceLanguage,
                })
              }
            >
              {interfaceLanguageCodes.map((language) => (
                <option key={language} value={language}>
                  {languageDisplayName(language, t)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField htmlFor="settings-theme" label={t("theme.label")}>
            <select
              id="settings-theme"
              className={inputClassName}
              value={form.theme}
              onChange={(event) =>
                updateForm({ theme: event.target.value as ThemePreference })
              }
            >
              {(["system", "light", "dark"] as const).map((theme) => (
                <option key={theme} value={theme}>
                  {t(`theme.${theme}`)}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Languages />} title={t("settings.languages")}>
        <div className="space-y-5">
          <FormField
            htmlFor="default-target"
            label={t("settings.defaultTarget")}
            hint={t("settings.noDefaultTarget")}
          >
            <LanguageInput
              id="default-target"
              value={form.defaultTargetLanguage ?? ""}
              onChange={(value) =>
                updateForm({ defaultTargetLanguage: value || null })
              }
            />
          </FormField>
          <fieldset>
            <legend className="font-semibold">
              {t("settings.translationDefaults")}
            </legend>
            <div className="mt-2 space-y-2">
              {form.translationLanguages.map((language) => (
                <div
                  key={language}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 font-semibold dark:border-slate-700 dark:bg-slate-800"
                >
                  <span>{languageDisplayName(language, t)}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={
                        translationOperation !== null ||
                        !translationPackages[translationCapabilities[0].id] ||
                        translationPackages[translationCapabilities[0].id]?.supported === false
                      }
                      className="rounded-lg p-2 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-30"
                      aria-label={
                        translationPackages[translationCapabilities[0].id]?.installed
                          ? t("settings.deleteTranslationPackage")
                          : t("settings.downloadTranslationPackage")
                      }
                      title={
                        translationPackages[translationCapabilities[0].id]?.installed
                          ? t("settings.translationInstalled")
                          : t("settings.translationDownloadSize", {
                              size: formatBytes(translationCapabilities[0].estimatedBytes),
                            })
                      }
                      onClick={() =>
                        void (translationPackages[translationCapabilities[0].id]?.installed
                          ? removeOfflineTranslation(translationCapabilities[0].id)
                          : installOfflineTranslation(translationCapabilities[0].id))
                      }
                    >
                      {translationPackages[translationCapabilities[0].id]?.installed ? (
                        <Trash2 size={16} />
                      ) : (
                        <Download size={16} />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={form.translationLanguages.length === 1}
                      className="rounded-lg p-2 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-30"
                      aria-label={t("settings.removeLanguage", { language })}
                      onClick={() => removeTranslationLanguage(language)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {translationProgress[translationCapabilities[0].id] ? (
              <div className="mt-3" role="status">
                <progress
                  className="w-full"
                  max={translationProgress[translationCapabilities[0].id].totalBytes}
                  value={translationProgress[translationCapabilities[0].id].downloadedBytes}
                />
                <p className="mt-1 text-sm">
                  {t("settings.translationDownloadProgress", {
                    percent: Math.min(
                      100,
                      Math.round(
                        translationProgress[translationCapabilities[0].id].downloadedBytes /
                          translationProgress[translationCapabilities[0].id].totalBytes * 100,
                      ),
                    ),
                  })}
                </p>
              </div>
            ) : null}
            <div className="mt-3 flex gap-2">
              <LanguageInput
                ariaLabel={t("settings.addLanguage")}
                value={newLanguage}
                onChange={setNewLanguage}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addTranslationLanguage}
              >
                {t("settings.addLanguage")}
              </Button>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 font-semibold">
              {t("settings.visibleTranslations")}
            </legend>
            <div className="flex flex-wrap gap-2">
              {form.translationLanguages.map((language) => (
                <label
                  key={language}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={form.defaultVisibleTranslationLanguages.includes(
                      language,
                    )}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [
                            ...new Set([
                              ...form.defaultVisibleTranslationLanguages,
                              language,
                            ]),
                          ]
                        : form.defaultVisibleTranslationLanguages.filter(
                            (item) => item !== language,
                          );
                      if (next.length === 0) return;
                      updateForm({
                        defaultActiveTranslationLanguage: next[0],
                        defaultVisibleTranslationLanguages: next,
                      });
                    }}
                  />
                  {language.toUpperCase()}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Volume2 />} title={t("settings.audio")}>
        <div className="space-y-5">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("audio.automaticBody")}
          </p>
          <h3 className="font-bold">{t("audio.languageVoices")}</h3>
          {Object.entries(form.audioPreferences).length ? (
            <div className="space-y-2">
              {Object.entries(form.audioPreferences).map(([language, preference]) => (
                <LanguageVoiceRow
                  key={language}
                  language={language}
                  preference={preference}
                  packageInstalled={Boolean(voicePackage?.installed)}
                  packageProgress={voiceProgress}
                  packageBusy={operation === "voice"}
                  onChange={(input) => updateAudio(language, input)}
                  onPreview={() => void previewVoice(language)}
                  onManageSystemVoices={() => void openSystemVoiceSettings()}
                  onInstallPackage={() => void installVoicePackage()}
                  onDeletePackage={() => void deleteVoicePackage()}
                  onRemove={() => removeAudioLanguage(language)}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
              {t("audio.noCustomLanguages")}
            </p>
          )}
          <div className="flex gap-2">
            <LanguageInput
              ariaLabel={t("audio.addLanguage")}
              value={newAudioLanguage}
              onChange={setNewAudioLanguage}
            />
            <Button type="button" variant="secondary" onClick={addAudioLanguage}>
              {t("audio.addLanguage")}
            </Button>
          </div>
          {audioStatus ? (
            <p role="status" className="text-sm font-semibold">
              {audioStatus}
            </p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection icon={<Sparkles />} title={t("settings.specialFeatures")}>
        <div className="space-y-3">
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input
            className="h-5 w-5 accent-sky-600"
            type="checkbox"
            checked={form.showJapaneseReadings}
            onChange={(event) => updateForm({ showJapaneseReadings: event.target.checked })}
          />
          <span>
            <strong className="block">{t("settings.showJapaneseReadings")}</strong>
            <span className="text-sm text-slate-600 dark:text-slate-300">{t("settings.showJapaneseReadingsBody")}</span>
          </span>
        </label>
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input
            className="h-5 w-5 accent-sky-600"
            type="checkbox"
            checked={form.useImages}
            onChange={(event) => updateForm({ useImages: event.target.checked })}
          />
          <span className="font-semibold">{t("settings.useImages")}</span>
        </label>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Database />} title={t("settings.storage")}>
        {desktopStorage ? (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {desktopStorage.portable
                ? t("settings.portableStorageBody")
                : t("settings.fallbackStorageBody")}
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-[11rem_1fr]">
              <dt className="font-semibold">{t("settings.dataLocation")}</dt>
              <dd className="break-all font-mono text-sm">{desktopStorage.root}</dd>
              <dt className="font-semibold">{t("settings.applicationData")}</dt>
              <dd>{desktopStorage.applicationBytes === null ? "—" : formatBytes(desktopStorage.applicationBytes)}</dd>
              <dt className="font-semibold">{t("settings.freeDiskSpace")}</dt>
              <dd>{desktopStorage.freeBytes === null ? "—" : formatBytes(desktopStorage.freeBytes)}</dd>
            </dl>
            {desktopStorage.migratedFrom ? (
              <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                {t("settings.storageMigrated")}
              </p>
            ) : null}
            {desktopStorage.warning ? (
              <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                {t("settings.portableStorageUnavailable")}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("settings.browserStorageBody")}
          </p>
        )}
        <hr className="my-5 border-slate-200 dark:border-slate-700" />
        <h3 className="font-bold">{t("settings.backup")}</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t("settings.backupBody")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={operation !== null}
            icon={<Download size={18} />}
            onClick={() => void exportBackup()}
          >
            {operation === "backup"
              ? t("settings.exporting")
              : t("settings.exportBackup")}
          </Button>
          <Button
            disabled={operation !== null}
            icon={<ArchiveRestore size={18} />}
            onClick={() => backupInput.current?.click()}
            variant="secondary"
          >
            {operation === "restore"
              ? t("settings.restoring")
              : t("settings.restoreBackup")}
          </Button>
          <input
            ref={backupInput}
            accept=".vtbackup,.zip,application/zip"
            className="sr-only"
            onChange={(event) => void restoreBackup(event)}
            type="file"
          />
        </div>
      </SettingsSection>

      <div className="flex justify-end">
        <Button
          disabled={operation !== null}
          onClick={() => void saveSettings()}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function SettingsSection({
  defaultOpen = false,
  icon,
  title,
  children,
}: {
  defaultOpen?: boolean;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  return (
    <details
      className="group rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-sky-700 dark:text-sky-300">{icon}</span>
        <h2 className="flex-1 text-xl font-bold">{title}</h2>
        <ChevronDown className="text-slate-400 transition-transform group-open:rotate-180" size={20} aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-200 p-5 dark:border-slate-800">
        {children}
      </div>
    </details>
  );
}

function LanguageVoiceRow({
  language,
  preference,
  packageInstalled,
  packageProgress,
  packageBusy,
  onChange,
  onPreview,
  onManageSystemVoices,
  onInstallPackage,
  onDeletePackage,
  onRemove,
}: {
  language: string;
  preference: LanguageAudioPreference;
  packageInstalled: boolean;
  packageProgress: VoicePackageProgress | null;
  packageBusy: boolean;
  onChange: (input: Partial<LanguageAudioPreference>) => void;
  onPreview: () => void;
  onManageSystemVoices: () => void;
  onInstallPackage: () => void;
  onDeletePackage: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const locale = preferredTtsLocale(language);
  const voices = useVoices(locale);
  const supportsJapanesePackage = isApplicationProviderSupported(
    KOKORO_JAPANESE_PROVIDER_ID,
    locale,
  );
  const selectedProviderId =
    preference.fallbackProviderId === KOKORO_JAPANESE_PROVIDER_ID
      ? japaneseProviderId(KOKORO_JAPANESE_VOICES[0].id)
      : preference.fallbackProviderId;
  const value = selectedProviderId
    ? `provider:${selectedProviderId}`
    : preference.voiceUri ?? "";

  return (
    <div className="grid min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)_auto] dark:border-slate-700">
      <span className="font-semibold">{languageDisplayName(language, t)}</span>
      <select
        aria-label={t("audio.voiceFor", { language: languageDisplayName(language, t) })}
        className={inputClassName}
        value={value}
        onChange={(event) => {
          const selected = event.target.value;
          onChange({
            targetLocale: locale,
            voiceUri: selected && !selected.startsWith("provider:") ? selected : undefined,
            fallbackProviderId: selected.startsWith("provider:")
              ? selected.slice("provider:".length)
              : undefined,
          });
        }}
      >
        <option value="">{t("audio.deviceAutomatic")}</option>
        {voices.map((voice) => (
          <option key={voice.voiceURI} value={voice.voiceURI}>
            {voice.name} ({voice.lang})
          </option>
        ))}
        {supportsJapanesePackage && packageInstalled
          ? KOKORO_JAPANESE_VOICES.map((voice) => (
              <option key={voice.id} value={`provider:${japaneseProviderId(voice.id)}`}>
                {t("audio.japaneseOfflineVoice")} — {voice.name}
              </option>
            ))
          : null}
      </select>
      <div className="flex justify-end gap-1">
        {supportsSystemVoiceSettings() ? (
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-slate-800"
            aria-label={t("audio.manageSystemVoices")}
            title={t("audio.manageSystemVoices")}
            onClick={onManageSystemVoices}
          >
            <Settings2 size={18} />
          </button>
        ) : null}
        {supportsJapanesePackage && supportsDownloadableVoicePackages() ? (
          <button
            type="button"
            disabled={packageBusy}
            className="rounded-lg p-2 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:hover:bg-slate-800"
            aria-label={packageInstalled ? t("audio.deletePackage") : t("audio.download")}
            title={
              packageInstalled
                ? t("audio.installed")
                : t("audio.downloadSize", { size: KOKORO_JAPANESE_DOWNLOAD_ESTIMATE_MB })
            }
            onClick={packageInstalled ? onDeletePackage : onInstallPackage}
          >
            {packageInstalled ? <Trash2 size={18} /> : <Download size={18} />}
          </button>
        ) : null}
        <button type="button" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("audio.preview")} onClick={onPreview}>
          <Volume2 size={18} />
        </button>
        <button type="button" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("settings.removeLanguage", { language })} onClick={onRemove}>
          <X size={18} />
        </button>
      </div>
      {supportsJapanesePackage && packageProgress ? (
        <div className="sm:col-span-3" role="status">
          <progress
            className="w-full"
            max={packageProgress.totalBytes}
            value={packageProgress.downloadedBytes}
          />
          <p className="mt-1 text-sm">
            {t("audio.downloadProgress", {
              percent: Math.min(
                100,
                Math.round(packageProgress.downloadedBytes / packageProgress.totalBytes * 100),
              ),
            })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}
