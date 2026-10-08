import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  Download,
  Languages,
  MessageSquareText,
  Shapes,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { LanguageCombobox } from "../components/LanguageCombobox";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { inputClassName } from "../components/ui/FormField";
import {
  languageDisplayName,
  languageRegistry,
  normalizeLanguageCode,
  preferredTtsLocale,
} from "../config/languages";
import {
  cardsRepository,
  database,
  lessonsRepository,
  settingsRepository,
} from "../data";
import type { LessonContentType } from "../domain";
import {
  alignTranslationLines,
  parseNonEmptyLines,
} from "../services/lesson-data";
import {
  canUseKanaStudyReadings,
  kanaStudyReading,
} from "../services/kana-study-reading";
import { requestPersistentStorage } from "../services/storage";
import {
  deleteTranslationPackage,
  findTranslationCapability,
  getTranslationPackageStatus,
  installTranslationPackage,
  onTranslationPackageProgress,
  type TranslationCapability,
  type TranslationPackageProgress,
  type TranslationPackageStatus,
} from "../services/translation-packages";
import {
  localTranslationProvider,
  TranslationTimeoutError,
  type TranslationProgress,
} from "../services/translator";

const VOCABULARY_STEPS = [1, 2, 3, 4, 5, 6] as const;
const SYMBOL_STEPS = [1, 2, 4, 6] as const;

export function LessonWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [contentType, setContentType] = useState<LessonContentType>("vocabulary");
  const [name, setName] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [translationLanguages, setTranslationLanguages] = useState<string[]>(["en"]);
  const [defaultActiveTranslation, setDefaultActiveTranslation] = useState("en");
  const [activeEditorLanguage, setActiveEditorLanguage] = useState("en");
  const [useImages, setUseImages] = useState(true);
  const [audioPreferences, setAudioPreferences] = useState<Record<string, {
    targetLocale: string;
    voiceUri?: string;
    speechRate: number;
    fallbackProviderId?: string;
  }>>({});
  const [initialized, setInitialized] = useState(false);
  const [wordText, setWordText] = useState("");
  const [translations, setTranslations] = useState<Record<string, string[]>>({});
  const [existingCount, setExistingCount] = useState(0);
  const [packageStatuses, setPackageStatuses] = useState<Record<string, TranslationPackageStatus>>({});
  const [packageProgress, setPackageProgress] = useState<Record<string, TranslationPackageProgress>>({});
  const [installingPackageId, setInstallingPackageId] = useState<string | null>(null);
  const [pendingTranslation, setPendingTranslation] = useState<{ language: string; index: number | null } | null>(null);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const [translationState, setTranslationState] = useState<"loadingModel" | "translating" | "finished" | "kanaReadingsReady" | "timedOut" | "failed" | "unavailable" | null>(null);
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const words = useMemo(() => parseNonEmptyLines(wordText), [wordText]);
  const normalized = words.map((word) => word.normalize("NFC"));
  const hasDuplicates = new Set(normalized).size !== normalized.length;
  const bulkImport = alignTranslationLines(words, bulkText);
  const bulkLines = bulkImport.values;
  const wizardSteps: readonly number[] = contentType === "symbols"
    ? SYMBOL_STEPS
    : VOCABULARY_STEPS;
  const stepIndex = wizardSteps.indexOf(step);

  useEffect(() => {
    void settingsRepository.get().then((settings) => {
      const target = settings.defaultTargetLanguage ?? "";
      const selected = settings.translationLanguages.filter(
        (language) => language !== normalizeLanguageCode(target),
      );
      const fallbackLanguage =
        languageRegistry.find(
          (language) => language.code !== normalizeLanguageCode(target),
        )?.code ?? "en";
      const configured = selected.length ? selected : [fallbackLanguage];
      const active = configured.includes(settings.defaultActiveTranslationLanguage)
        ? settings.defaultActiveTranslationLanguage
        : configured[0]!;
      setTargetLanguage(target);
      setTranslationLanguages(configured);
      setDefaultActiveTranslation(active);
      setActiveEditorLanguage(active);
      setUseImages(settings.useImages);
      setAudioPreferences(settings.audioPreferences);
      setInitialized(true);
    });
  }, []);

  useEffect(() => {
    if (step < 4 || words.length === 0) return;
    let live = true;
    void Promise.all(
      words.map((word) => cardsRepository.findByTarget(targetLanguage, word)),
    ).then((matches) => {
      if (live) setExistingCount(matches.filter(Boolean).length);
    });
    return () => {
      live = false;
    };
  }, [step, words, targetLanguage]);

  useEffect(
    () => onTranslationPackageProgress((progress) => {
      setPackageProgress((current) => ({ ...current, [progress.packageId]: progress }));
    }),
    [],
  );

  useEffect(() => {
    if (!targetLanguage) return;
    const capabilities = translationLanguages.flatMap((language) => {
      const capability = findTranslationCapability(targetLanguage, language);
      return capability ? [capability] : [];
    });
    void Promise.all(
      capabilities.map(async (capability) => [
        capability.id,
        await getTranslationPackageStatus(capability),
      ] as const),
    ).then((statuses) => {
      setPackageStatuses((current) => ({
        ...current,
        ...Object.fromEntries(statuses),
      }));
    });
  }, [targetLanguage, translationLanguages]);

  function canContinue() {
    if (step === 1) return Boolean(name.trim());
    if (step === 2) return Boolean(targetLanguage);
    if (step === 3) return translationLanguages.length > 0;
    if (step === 4) return words.length > 0 && !hasDuplicates;
    return true;
  }

  function changeTargetLanguage(value: string) {
    const target = normalizeLanguageCode(value);
    setTargetLanguage(target);
    const next = translationLanguages.filter((language) => language !== target);
    setTranslationLanguages(next);
    if (!next.includes(activeEditorLanguage)) setActiveEditorLanguage(next[0] ?? "");
  }

  function toggleTranslationLanguage(language: string, selected: boolean) {
    const next = selected
      ? [...new Set([...translationLanguages, language])]
      : translationLanguages.filter((item) => item !== language);
    setTranslationLanguages(next);
    if (!next.includes(activeEditorLanguage)) setActiveEditorLanguage(next[0] ?? "");
  }

  function advance() {
    if (!canContinue()) return;
    if (step === 4 && contentType !== "symbols") {
      setTranslations((current) =>
        Object.fromEntries(
          translationLanguages.map((language) => [
            language,
            Array.from({ length: words.length }, (_, index) => current[language]?.[index] ?? ""),
          ]),
        ),
      );
      if (!translationLanguages.includes(activeEditorLanguage)) {
        setActiveEditorLanguage(translationLanguages[0]!);
      }
    }
    const nextStep = wizardSteps[stepIndex + 1];
    if (nextStep) setStep(nextStep);
  }

  function goBack() {
    const previousStep = wizardSteps[stepIndex - 1];
    if (previousStep) setStep(previousStep);
  }

  async function downloadPackage(capability: TranslationCapability, continuePending = false) {
    setInstallingPackageId(capability.id);
    setTranslationState(null);
    try {
      const status = await installTranslationPackage(capability);
      setPackageStatuses((current) => ({ ...current, [capability.id]: status }));
      setPackageProgress((current) => {
        const next = { ...current };
        delete next[capability.id];
        return next;
      });
      if (continuePending && pendingTranslation) {
        const pending = pendingTranslation;
        setPendingTranslation(null);
        await runTranslation(pending.language, pending.index);
      }
    } catch {
      setTranslationState("failed");
    } finally {
      setInstallingPackageId(null);
    }
  }

  async function removePackage(capability: TranslationCapability) {
    const status = await deleteTranslationPackage(capability);
    await localTranslationProvider.clear(capability.id);
    setPackageStatuses((current) => ({ ...current, [capability.id]: status }));
  }

  async function requestTranslation(language: string, index: number | null) {
    const capability = findTranslationCapability(targetLanguage, language);
    if (!capability) {
      setTranslationState("unavailable");
      return;
    }
    const current = translations[language] ?? Array(words.length).fill("");
    const sourceTexts = index === null
      ? current.some((value) => !value.trim())
        ? words.filter((_, itemIndex) => !current[itemIndex]?.trim())
        : words
      : [words[index]!];
    if (canUseKanaStudyReadings(sourceTexts, targetLanguage)) {
      await runTranslation(language, index, true);
      return;
    }
    const status = packageStatuses[capability.id] ?? await getTranslationPackageStatus(capability);
    setPackageStatuses((current) => ({ ...current, [capability.id]: status }));
    if (!status.installed) {
      setPendingTranslation({ language, index });
      return;
    }
    await runTranslation(language, index);
  }

  async function runTranslation(
    language: string,
    index: number | null,
    kanaOnly = false,
  ) {
    const capability = findTranslationCapability(targetLanguage, language);
    if (!capability) return;
    const current = translations[language] ?? Array(words.length).fill("");
    let indexes = index === null
      ? current.map((value, itemIndex) => value.trim() ? -1 : itemIndex).filter((itemIndex) => itemIndex >= 0)
      : [index];
    if (index === null && indexes.length === 0) {
      if (!globalThis.confirm(t("wizard.confirmOverwrite"))) return;
      indexes = words.map((_, itemIndex) => itemIndex);
    }
    setTranslationState("loadingModel");
    setTranslationProgress(null);
    try {
      const result = await localTranslationProvider.translate(
        indexes.map((itemIndex) => words[itemIndex]!),
        capability,
        (progress) => {
          setTranslationProgress(progress);
        },
        () => setTranslationState("translating"),
      );
      setTranslations((all) => {
        const next = [...(all[language] ?? Array(words.length).fill(""))];
        indexes.forEach((itemIndex, resultIndex) => {
          next[itemIndex] = result[resultIndex] ?? "";
        });
        return { ...all, [language]: next };
      });
      setTranslationState(kanaOnly ? "kanaReadingsReady" : "finished");
    } catch (error) {
      console.error("Local translation failed.", error);
      setTranslationState(
        error instanceof TranslationTimeoutError ? "timedOut" : "failed",
      );
    }
  }

  function applyBulkPaste() {
    if (!bulkImport.valid) return;
    setTranslations((current) => ({ ...current, [activeEditorLanguage]: bulkLines }));
    setBulkText("");
    setBulkPasteOpen(false);
  }

  async function generate() {
    if (!canContinue()) return;
    setGenerating(true);
    setGenerationFailed(false);
    try {
      const internalSymbolLanguage = translationLanguages[0] ??
        languageRegistry.find(
          (language) => language.code !== normalizeLanguageCode(targetLanguage),
        )?.code ?? "en";
      const lessonTranslationLanguages = contentType === "symbols"
        ? [internalSymbolLanguage]
        : translationLanguages;
      const activeTranslation = lessonTranslationLanguages.includes(defaultActiveTranslation)
        ? defaultActiveTranslation
        : lessonTranslationLanguages[0]!;
      const lesson = await database.transaction(
        "rw",
        [
          database.lessons,
          database.cards,
          database.lessonMemberships,
          database.lessonProgress,
          database.generatedTtsAudio,
        ],
        async () => {
          const normalizedTargetLanguage = normalizeLanguageCode(targetLanguage);
          const audio = audioPreferences[normalizedTargetLanguage];
          const created = await lessonsRepository.create({
            name: name.trim(),
            contentType,
            targetLanguage: normalizedTargetLanguage,
            translationLanguages: lessonTranslationLanguages,
            activeTranslationLanguage: activeTranslation,
            visibleTranslationLanguages: [...lessonTranslationLanguages],
            useImages,
            tts: audio ?? {
              targetLocale: preferredTtsLocale(normalizedTargetLanguage),
              speechRate: 1,
            },
          });
          for (let index = 0; index < words.length; index += 1) {
            const studyReading = kanaStudyReading(
              words[index]!,
              normalizedTargetLanguage,
            );
            const cardTranslations = Object.fromEntries(
              lessonTranslationLanguages.flatMap((language) => {
                const value =
                  translations[language]?.[index]?.trim() ||
                  studyReading ||
                  (contentType === "symbols" ? words[index]! : "");
                return value ? [[language, value]] : [];
              }),
            );
            const result = await cardsRepository.createOrReuse({
              target: words[index]!,
              targetLanguage: normalizedTargetLanguage,
              translations: cardTranslations,
            });
            if (!result.created && Object.keys(cardTranslations).length) {
              await cardsRepository.update(result.card.id, {
                translations: { ...result.card.translations, ...cardTranslations },
              });
            }
            await lessonsRepository.addCard(created.id, result.card.id, index);
          }
          return created;
        },
      );
      void requestPersistentStorage();
      // The detail screen owns offline preparation and shows its progress.
      // Navigating immediately makes the successfully committed Lesson visible
      // instead of keeping the creation button disabled during long TTS work.
      navigate(`/lessons/${lesson.id}?review=1`);
    } catch (error) {
      console.error("Lesson creation failed.", error);
      setGenerationFailed(true);
    } finally {
      setGenerating(false);
    }
  }

  if (!initialized) return <p>{t("common.loading")}</p>;

  const activeCapability = findTranslationCapability(targetLanguage, activeEditorLanguage);
  const pendingCapability = pendingTranslation
    ? findTranslationCapability(targetLanguage, pendingTranslation.language)
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <PageHeader title={t("wizard.title")} description={t("wizard.step", { current: stepIndex + 1, total: wizardSteps.length })} />
      <ol className={`grid gap-1 ${contentType === "symbols" ? "grid-cols-4" : "grid-cols-6"}`} aria-label={t("wizard.step", { current: stepIndex + 1, total: wizardSteps.length })}>
        {wizardSteps.map((wizardStep, index) => (
          <li key={wizardStep} aria-current={wizardStep === step ? "step" : undefined} className={`h-2 rounded-full ${index <= stepIndex ? "bg-sky-500" : "bg-slate-200 dark:bg-slate-700"}`} />
        ))}
      </ol>
      <section className="min-h-72 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {step === 1 ? (
          <NameStep
            contentType={contentType}
            name={name}
            onChange={setName}
            onTypeChange={(value) => {
              setContentType(value);
              if (value === "symbols") setUseImages(false);
            }}
          />
        ) : null}
        {step === 2 ? (
          <div>
            <label className="mb-2 block font-semibold" htmlFor="target-language">{t("wizard.targetLanguage")}</label>
            <LanguageCombobox key={targetLanguage || "target-language"} id="target-language" value={targetLanguage} onChange={changeTargetLanguage} />
          </div>
        ) : null}
        {step === 3 ? (
          <fieldset>
            <legend className="mb-4 text-xl font-bold">{t("wizard.translationLanguages")}</legend>
            <div className="space-y-2">
              {languageRegistry.filter((language) => language.code !== targetLanguage).map((language) => {
                const selected = translationLanguages.includes(language.code);
                const capability = findTranslationCapability(targetLanguage, language.code);
                const status = capability ? packageStatuses[capability.id] : null;
                return (
                  <div key={language.code} className={`rounded-xl border p-3 ${selected ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40" : "border-slate-200 dark:border-slate-700"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="flex min-h-10 flex-1 items-center gap-3 font-semibold">
                        <input type="checkbox" checked={selected} onChange={(event) => toggleTranslationLanguage(language.code, event.target.checked)} />
                        <span>{languageDisplayName(language.code, t)}</span>
                      </label>
                      <PackageState
                        capability={capability}
                        status={status}
                        progress={capability ? packageProgress[capability.id] : undefined}
                        installing={capability?.id === installingPackageId}
                        onDownload={downloadPackage}
                        onDelete={removePackage}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        {step === 4 ? (
          <div>
            <label className="mb-2 block font-semibold" htmlFor="target-words">{contentType === "symbols" ? t("wizard.symbols") : t("wizard.words")}</label>
            <textarea autoFocus id="target-words" rows={10} className={inputClassName} value={wordText} onChange={(event) => setWordText(event.target.value)} />
            <p className="mt-2 text-sm text-slate-500">{contentType === "symbols" ? t("wizard.symbolsHint") : t("wizard.wordsHint")} {t(contentType === "symbols" ? "wizard.symbolCount" : "wizard.wordCount", { count: words.length })}</p>
            {hasDuplicates ? <p className="mt-2 text-sm text-red-600">{t("wizard.duplicates")}</p> : null}
            {existingCount > 0 ? <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">{t("wizard.existing", { count: existingCount })}</p> : null}
          </div>
        ) : null}
        {step === 5 ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold">{t("wizard.translations")}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("wizard.translationTableHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("wizard.translationLanguages")}>
              {translationLanguages.map((language) => (
                <button key={language} role="tab" aria-selected={activeEditorLanguage === language} className={`rounded-xl px-4 py-2 font-semibold ${activeEditorLanguage === language ? "bg-sky-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => setActiveEditorLanguage(language)} type="button">
                  {languageDisplayName(language, t)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setBulkPasteOpen((value) => !value)}>{t("wizard.pasteTranslationList")}</Button>
              <Button type="button" variant="secondary" disabled={!activeCapability || translationState === "loadingModel" || translationState === "translating"} onClick={() => void requestTranslation(activeEditorLanguage, null)} icon={<Languages size={18} aria-hidden="true" />}>{t("wizard.autoTranslateAll")}</Button>
            </div>
            {bulkPasteOpen ? (
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <label className="font-semibold" htmlFor="bulk-translations">{t("wizard.pasteTranslationList")}</label>
                <textarea id="bulk-translations" className={`${inputClassName} mt-2`} rows={6} value={bulkText} onChange={(event) => setBulkText(event.target.value)} />
                <p className={`mt-2 text-sm ${bulkLines.length && bulkLines.length !== words.length ? "text-red-600" : "text-slate-500"}`}>
                  {t("wizard.lineCount", { actual: bulkLines.length, expected: words.length })}
                </p>
                <Button className="mt-3" disabled={!bulkImport.valid} onClick={applyBulkPaste}>{t("wizard.applyPaste")}</Button>
              </div>
            ) : null}
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="hidden grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.4fr)_auto] gap-3 bg-slate-100 px-4 py-3 text-sm font-bold sm:grid dark:bg-slate-800">
                <span>{t("wizard.original")}</span>
                <span>{t("wizard.translationFor", { language: languageDisplayName(activeEditorLanguage, t) })}</span>
                <span className="sr-only">{t("wizard.autoTranslateWord")}</span>
              </div>
              {words.map((word, index) => (
                <div key={`${word}-${index}`} className="grid gap-2 border-t border-slate-200 p-3 first:border-t-0 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.4fr)_auto] sm:items-center dark:border-slate-700">
                  <strong>{word}</strong>
                  <input aria-label={`${word} — ${languageDisplayName(activeEditorLanguage, t)}`} className={inputClassName} value={translations[activeEditorLanguage]?.[index] ?? ""} onChange={(event) => setTranslations((current) => {
                    const next = [...(current[activeEditorLanguage] ?? Array(words.length).fill(""))];
                    next[index] = event.target.value;
                    return { ...current, [activeEditorLanguage]: next };
                  })} />
                  <Button type="button" variant="ghost" disabled={!activeCapability || translationState === "loadingModel" || translationState === "translating"} onClick={() => void requestTranslation(activeEditorLanguage, index)}>{t("wizard.autoTranslateWord")}</Button>
                </div>
              ))}
            </div>
            {translationState ? <TranslationState state={translationState} progress={translationProgress} /> : null}
          </div>
        ) : null}
        {step === 6 ? (
          <div>
            <Check className="text-emerald-600" size={36} aria-hidden="true" />
            <h2 className="mt-3 text-2xl font-bold">{t("wizard.review")}</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-300">{t(contentType === "symbols" ? "wizard.symbolReviewBody" : "wizard.reviewBody")}</p>
            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              <Summary label={t("wizard.name")} value={name} />
              <Summary label={t("wizard.contentType")} value={t(`wizard.contentTypes.${contentType}`)} />
              <Summary label={t("wizard.targetLanguage")} value={languageDisplayName(targetLanguage, t)} />
              <Summary label={t("lesson.cards")} value={String(words.length)} />
              {contentType !== "symbols" ? <Summary label={t("wizard.translationLanguages")} value={translationLanguages.map((language) => languageDisplayName(language, t)).join(", ")} /> : null}
            </dl>
          </div>
        ) : null}
      </section>
      <div className="flex justify-between gap-3">
        {step === 1 ? <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold" to="/"><ArrowLeft size={18} aria-hidden="true" />{t("common.cancel")}</Link> : <Button variant="ghost" onClick={goBack} icon={<ArrowLeft size={18} aria-hidden="true" />}>{t("common.back")}</Button>}
        {stepIndex < wizardSteps.length - 1 ? <Button disabled={!canContinue()} onClick={advance} icon={<ArrowRight size={18} aria-hidden="true" />}>{t("common.continue")}</Button> : <Button disabled={generating} onClick={() => void generate()}>{generating ? t("wizard.generating") : t("wizard.generate")}</Button>}
      </div>
      {generationFailed ? (
        <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-200" role="alert">
          {t("errors.generic")}
        </p>
      ) : null}
      {pendingTranslation && pendingCapability ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="translation-package-title">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h2 className="text-xl font-bold" id="translation-package-title">{t("wizard.packageMissingTitle")}</h2>
            <p className="mt-3">{t("wizard.packageMissingBody", { source: languageDisplayName(targetLanguage, t), target: languageDisplayName(pendingTranslation.language, t) })}</p>
            <p className="mt-2 font-semibold">{t("wizard.packageSize", { size: formatMegabytes(pendingCapability.estimatedBytes) })}</p>
            {packageProgress[pendingCapability.id] ? <ProgressBar progress={packageProgress[pendingCapability.id]!} /> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" disabled={installingPackageId === pendingCapability.id} onClick={() => setPendingTranslation(null)}>{t("common.cancel")}</Button>
              <Button disabled={installingPackageId === pendingCapability.id} onClick={() => void downloadPackage(pendingCapability, true)} icon={<Download size={18} aria-hidden="true" />}>{installingPackageId === pendingCapability.id ? t("wizard.downloadingPackage") : t("wizard.downloadPackage")}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NameStep({
  contentType,
  name,
  onChange,
  onTypeChange,
}: {
  contentType: LessonContentType;
  name: string;
  onChange: (value: string) => void;
  onTypeChange: (value: Exclude<LessonContentType, "phrases">) => void;
}) {
  const { t } = useTranslation();
  const choices = [
    { type: "vocabulary" as const, icon: BookOpenText },
    { type: "symbols" as const, icon: Shapes },
  ];
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-3 text-xl font-bold">{t("wizard.whatToLearn")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {choices.map(({ type, icon: Icon }) => (
            <button
              aria-pressed={contentType === type}
              className={`rounded-2xl border p-4 text-left transition ${contentType === type ? "border-sky-500 bg-sky-50 ring-2 ring-sky-400 dark:bg-sky-950" : "border-slate-200 hover:border-sky-400 dark:border-slate-700"}`}
              key={type}
              onClick={() => onTypeChange(type)}
              type="button"
            >
              <Icon className="mb-3 text-sky-600" size={28} aria-hidden="true" />
              <strong className="block">{t(`wizard.contentTypes.${type}`)}</strong>
              <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{t(`wizard.contentTypeHelp.${type}`)}</span>
            </button>
          ))}
          <button
            aria-disabled="true"
            className="cursor-not-allowed rounded-2xl border border-slate-200 p-4 text-left opacity-45 dark:border-slate-700"
            disabled
            type="button"
          >
            <MessageSquareText className="mb-3 text-slate-500" size={28} aria-hidden="true" />
            <strong className="block">{t("wizard.contentTypes.phrases")}</strong>
            <span className="mt-1 block text-sm">{t("wizard.comingLater")}</span>
          </button>
        </div>
      </fieldset>
      <div>
        <label className="mb-2 block font-semibold" htmlFor="lesson-name">{t("wizard.name")}</label>
        <input autoFocus id="lesson-name" className={inputClassName} value={name} placeholder={t("wizard.namePlaceholder")} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  );
}

function PackageState({ capability, status, progress, installing, onDownload, onDelete }: {
  capability: TranslationCapability | null;
  status: TranslationPackageStatus | null;
  progress?: TranslationPackageProgress;
  installing: boolean;
  onDownload: (capability: TranslationCapability) => Promise<void>;
  onDelete: (capability: TranslationCapability) => Promise<void>;
}) {
  const { t } = useTranslation();
  if (!capability) return <span className="text-sm text-slate-500">{t("wizard.modelUnavailable")}</span>;
  if (progress || installing) return <div className="min-w-48"><span className="text-sm font-semibold">{t("wizard.downloadingPercent", { percent: progress ? Math.min(100, Math.round(progress.downloadedBytes / progress.totalBytes * 100)) : 0 })}</span>{progress ? <ProgressBar progress={progress} /> : null}</div>;
  if (!status) return <span className="text-sm text-slate-500">{t("common.loading")}</span>;
  if (status?.installed) return <div className="flex items-center gap-2"><span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t("wizard.modelInstalled")}</span><Button variant="ghost" onClick={() => void onDelete(capability)} icon={<Trash2 size={16} aria-hidden="true" />}>{t("wizard.deletePackage")}</Button></div>;
  if (status && !status.supported) return <span className="text-sm text-slate-500">{t("wizard.desktopRequired")}</span>;
  return <div className="flex flex-wrap items-center justify-end gap-2"><span className="text-sm text-slate-500">{t("wizard.modelNotInstalled")}</span><Button variant="secondary" onClick={() => void onDownload(capability)} icon={<Download size={16} aria-hidden="true" />}>{t("wizard.downloadPackageWithSize", { size: formatMegabytes(capability.estimatedBytes) })}</Button></div>;
}

function ProgressBar({ progress }: { progress: TranslationPackageProgress }) {
  const percent = Math.min(100, Math.round(progress.downloadedBytes / progress.totalBytes * 100));
  return <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div className="h-full bg-sky-500" style={{ width: `${percent}%` }} /></div>;
}

function TranslationState({ state, progress }: { state: "loadingModel" | "translating" | "finished" | "kanaReadingsReady" | "timedOut" | "failed" | "unavailable"; progress: TranslationProgress | null }) {
  const { t } = useTranslation();
  return <p role="status" className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">{state === "translating" && progress ? t("wizard.translationProgress", { completed: progress.completed, total: progress.total }) : t(`wizard.${state}`)}</p>;
}

function formatMegabytes(bytes: number): string {
  return `${Math.ceil(bytes / 1_000_000)} MB`;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-bold">{value}</dd></div>;
}
