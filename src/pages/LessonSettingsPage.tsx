import { ArrowLeft, BookOpenText, MessageSquareText, Shapes, Volume2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { FormField, inputClassName } from "../components/ui/FormField";
import { languageDisplayName, languageRegistry } from "../config/languages";
import { cardsRepository, database, lessonsRepository, settingsRepository } from "../data";
import type { LessonContentType, Translations } from "../domain";
import { useLessonBundle } from "../hooks/useLessonBundle";
import { useVoices } from "../hooks/useVoices";
import {
  getMatchingVoices,
  KOKORO_JAPANESE_PROVIDER_ID,
  KOKORO_JAPANESE_VOICES,
  isApplicationProviderSupported,
  japaneseProviderId,
  playCardAudio,
  prepareGeneratedAudioForCards,
} from "../services/audio";
import { kanaStudyReading } from "../services/kana-study-reading";
import { alignTranslationLines, parseNonEmptyLines, resolveLessonContentType } from "../services/lesson-data";
import { getJapaneseVoicePackageStatus } from "../services/voice-packages";

export function LessonSettingsPage() {
  const { lessonId } = useParams();
  const bundle = useLessonBundle(lessonId);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [contentType, setContentType] = useState<LessonContentType>("vocabulary");
  const [translationLanguages, setTranslationLanguages] = useState<string[]>([]);
  const [visibleTranslations, setVisibleTranslations] = useState<string[]>([]);
  const [cardTranslations, setCardTranslations] = useState<Record<string, Translations>>({});
  const [newItemsText, setNewItemsText] = useState("");
  const [newTranslations, setNewTranslations] = useState<Record<string, string>>({});
  const [languageToAdd, setLanguageToAdd] = useState("");
  const [locale, setLocale] = useState("");
  const [voiceUri, setVoiceUri] = useState("");
  const [rate, setRate] = useState(1);
  const [useImages, setUseImages] = useState(true);
  const [fallbackProviderId, setFallbackProviderId] = useState<string>();
  const [japanesePackageInstalled, setJapanesePackageInstalled] = useState(false);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const voices = useVoices(locale);
  const newItems = useMemo(() => parseNonEmptyLines(newItemsText), [newItemsText]);
  const duplicateNewItems = new Set(newItems.map((item) => item.normalize("NFC"))).size !== newItems.length;

  useEffect(() => {
    if (!bundle) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(bundle.lesson.name);
    setContentType(resolveLessonContentType(bundle.lesson, bundle.cards));
    setTranslationLanguages(bundle.lesson.translationLanguages);
    setVisibleTranslations(bundle.lesson.visibleTranslationLanguages);
    setCardTranslations(Object.fromEntries(bundle.cards.map((card) => [card.id, { ...card.translations }])));
    setLocale(bundle.lesson.tts.targetLocale);
    setVoiceUri(bundle.lesson.tts.voiceUri ?? "");
    setRate(bundle.lesson.tts.speechRate);
    setUseImages(bundle.lesson.useImages);
    setFallbackProviderId(bundle.lesson.tts.fallbackProviderId);
  }, [bundle]);

  useEffect(() => {
    void getJapaneseVoicePackageStatus().then((status) => setJapanesePackageInstalled(status.installed));
  }, []);

  if (bundle === undefined) return <p>{t("common.loading")}</p>;
  if (!bundle) return <p>{t("notFound.title")}</p>;
  const { lesson, cards } = bundle;
  const selectedProviderId = fallbackProviderId === KOKORO_JAPANESE_PROVIDER_ID
    ? japaneseProviderId(KOKORO_JAPANESE_VOICES[0].id)
    : fallbackProviderId;
  const matchingVoice = voiceUri
    ? voices.some((voice) => voice.voiceURI === voiceUri)
    : getMatchingVoices(locale).length > 0 || Boolean(selectedProviderId && japanesePackageInstalled && isApplicationProviderSupported(selectedProviderId, locale));
  const availableLanguages = languageRegistry.filter((language) => language.code !== lesson.targetLanguage && !translationLanguages.includes(language.code));
  const invalidNewTranslation = translationLanguages.some((language) => {
    const text = newTranslations[language] ?? "";
    return Boolean(text.trim() && !alignTranslationLines(newItems, text).valid);
  });

  function addTranslationLanguage() {
    if (!languageToAdd) return;
    setTranslationLanguages((current) => [...new Set([...current, languageToAdd])]);
    setVisibleTranslations((current) => [...new Set([...current, languageToAdd])]);
    setLanguageToAdd("");
  }

  async function save() {
    if (!name.trim() || translationLanguages.length === 0 || duplicateNewItems || invalidNewTranslation) return;
    setSaving(true);
    setAudioStatus(null);
    const selected = visibleTranslations.filter((language) => translationLanguages.includes(language));
    const visible = selected.length ? selected : [translationLanguages[0]!];
    const tts = { targetLocale: locale.trim(), voiceUri: voiceUri || undefined, speechRate: rate, fallbackProviderId };
    try {
      const updated = await database.transaction(
        "rw",
        [database.lessons, database.cards, database.lessonMemberships, database.lessonProgress, database.generatedTtsAudio],
        async () => {
          const savedLesson = await lessonsRepository.update(lesson.id, {
            name: name.trim(), contentType, translationLanguages,
            activeTranslationLanguage: visible[0]!, visibleTranslationLanguages: visible,
            useImages, tts,
          });
          for (const card of cards) {
            await cardsRepository.update(card.id, { translations: { ...card.translations, ...(cardTranslations[card.id] ?? {}) } });
          }
          for (const [index, target] of newItems.entries()) {
            const automaticReading = contentType === "symbols" ? kanaStudyReading(target, lesson.targetLanguage) : null;
            const translations = Object.fromEntries(translationLanguages.flatMap((language) => {
              const pasted = alignTranslationLines(newItems, newTranslations[language] ?? "").values[index]?.trim();
              const value = pasted || automaticReading;
              return value ? [[language, value]] : [];
            }));
            const result = await cardsRepository.createOrReuse({ target, targetLanguage: lesson.targetLanguage, translations });
            if (!result.created && Object.keys(translations).length > 0) {
              await cardsRepository.update(result.card.id, { translations: { ...result.card.translations, ...translations } });
            }
            await lessonsRepository.addCard(lesson.id, result.card.id);
          }
          return savedLesson;
        },
      );
      const settings = await settingsRepository.get();
      await settingsRepository.update({
        translationLanguages: [...new Set([...settings.translationLanguages, ...translationLanguages])],
        defaultActiveTranslationLanguage: visible[0]!, defaultVisibleTranslationLanguages: visible,
        useImages,
        audioPreferences: { ...settings.audioPreferences, [lesson.targetLanguage]: tts },
      });
      const updatedCards = await lessonsRepository.listCards(lesson.id);
      const prepared = await prepareGeneratedAudioForCards(updatedCards, updated, (progress) => setAudioStatus(t("audio.preparingCards", { completed: progress.completed, total: progress.total })));
      navigate(`/lessons/${lesson.id}${prepared.failedCardIds.length ? `?audioFailed=${prepared.failedCardIds.length}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  function preview() {
    const card = cards[0];
    if (!card) return;
    setAudioStatus(null);
    void playCardAudio(card, { ...lesson, useImages, tts: { targetLocale: locale, voiceUri: voiceUri || undefined, speechRate: rate, fallbackProviderId } }, (status) => setAudioStatus(status === "loading" ? t("audio.loadingProvider") : null)).catch(() => setAudioStatus(t("audio.noVoice")));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to={`/lessons/${lesson.id}`} className="inline-flex items-center gap-2 text-sm font-semibold"><ArrowLeft size={17} aria-hidden="true" /> {t("common.back")}</Link>
      <PageHeader title={t("lesson.settings")} description={t("lessonEditor.description")} />

      <EditorSection number="1" title={t("wizard.whatToLearn")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <TypeButton active={contentType === "vocabulary"} icon={BookOpenText} label={t("wizard.contentTypes.vocabulary")} onClick={() => setContentType("vocabulary")} />
          <TypeButton active={contentType === "symbols"} icon={Shapes} label={t("wizard.contentTypes.symbols")} onClick={() => { setContentType("symbols"); setUseImages(false); }} />
          <TypeButton disabled active={false} icon={MessageSquareText} label={`${t("wizard.contentTypes.phrases")} · ${t("wizard.comingLater")}`} onClick={() => undefined} />
        </div>
      </EditorSection>

      <EditorSection number="2" title={t("lessonEditor.basics")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("wizard.name")}><input className={inputClassName} value={name} onChange={(event) => setName(event.target.value)} /></FormField>
          <FormField label={t("wizard.targetLanguage")}><div className={`${inputClassName} bg-slate-100 font-semibold dark:bg-slate-800`}>{languageDisplayName(lesson.targetLanguage, t)}</div></FormField>
        </div>
      </EditorSection>

      <EditorSection number="3" title={t("lessonEditor.translations")}>
        <div className="flex flex-wrap gap-2">
          {translationLanguages.map((language) => (
            <label className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700" key={language}>
              <input aria-label={language.toUpperCase()} checked={visibleTranslations.includes(language)} onChange={(event) => {
                const next = event.target.checked ? [...new Set([...visibleTranslations, language])] : visibleTranslations.filter((item) => item !== language);
                if (next.length > 0) setVisibleTranslations(next);
              }} type="checkbox" />
              {languageDisplayName(language, t)}
            </label>
          ))}
        </div>
        {availableLanguages.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <select className={inputClassName} value={languageToAdd} onChange={(event) => setLanguageToAdd(event.target.value)}>
              <option value="">{t("lessonEditor.chooseLanguage")}</option>
              {availableLanguages.map((language) => <option key={language.code} value={language.code}>{languageDisplayName(language.code, t)}</option>)}
            </select>
            <Button disabled={!languageToAdd} onClick={addTranslationLanguage} type="button" variant="secondary">{t("lesson.addLanguage")}</Button>
          </div>
        ) : null}
        <div className="mt-5 space-y-4">
          {cards.map((card) => (
            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700" key={card.id}>
              <strong className="text-xl">{card.target}</strong>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {translationLanguages.map((language) => (
                  <FormField key={language} label={languageDisplayName(language, t)}>
                    <input className={inputClassName} value={cardTranslations[card.id]?.[language] ?? ""} onChange={(event) => setCardTranslations((current) => ({ ...current, [card.id]: { ...(current[card.id] ?? {}), [language]: event.target.value } }))} />
                  </FormField>
                ))}
              </div>
            </div>
          ))}
        </div>
      </EditorSection>

      <EditorSection number="4" title={contentType === "symbols" ? t("lessonEditor.addSymbols") : t("lessonEditor.addWords")}>
        <textarea className={inputClassName} rows={6} value={newItemsText} onChange={(event) => setNewItemsText(event.target.value)} placeholder={contentType === "symbols" ? t("wizard.symbolsHint") : t("wizard.wordsHint")} />
        <p className="mt-2 text-sm text-slate-500">{t("lessonEditor.addItemsHint")}</p>
        {duplicateNewItems ? <p className="mt-2 text-sm font-semibold text-red-600">{t("wizard.duplicates")}</p> : null}
        {newItems.length > 0 ? <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {translationLanguages.map((language) => {
            const alignment = alignTranslationLines(newItems, newTranslations[language] ?? "");
            return <FormField key={language} label={t("lessonEditor.newTranslationFor", { language: languageDisplayName(language, t) })}>
              <textarea className={inputClassName} rows={6} value={newTranslations[language] ?? ""} onChange={(event) => setNewTranslations((current) => ({ ...current, [language]: event.target.value }))} />
              <span className={`mt-1 block text-xs ${newTranslations[language]?.trim() && !alignment.valid ? "text-red-600" : "text-slate-500"}`}>{t("wizard.lineCount", { actual: alignment.values.length, expected: newItems.length })}</span>
            </FormField>;
          })}
        </div> : null}
      </EditorSection>

      <EditorSection number="5" title={t("lessonEditor.display")}>
        <label className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input className="mt-0.5 h-5 w-5 accent-sky-600" type="checkbox" checked={useImages} onChange={(event) => setUseImages(event.target.checked)} />
          <span><strong className="block">{t("lessonEditor.showImages")}</strong><span className="mt-1 block text-sm text-slate-500">{t("lessonEditor.showImagesHelp")}</span></span>
        </label>
      </EditorSection>

      <EditorSection number="6" title={t("settings.audio")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("audio.voice")}><select className={inputClassName} value={selectedProviderId ? `provider:${selectedProviderId}` : voiceUri} onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith("provider:")) { setVoiceUri(""); setFallbackProviderId(value.slice("provider:".length)); }
            else { setVoiceUri(value); setFallbackProviderId(undefined); }
          }}>
            <option value="">{t("audio.deviceAutomatic")}</option>
            {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}
            {japanesePackageInstalled && isApplicationProviderSupported(KOKORO_JAPANESE_PROVIDER_ID, locale) ? KOKORO_JAPANESE_VOICES.map((voice) => <option key={voice.id} value={`provider:${japaneseProviderId(voice.id)}`}>{t("audio.japaneseOfflineVoice")} — {voice.name}</option>) : null}
          </select></FormField>
          <FormField label={`${t("audio.rate")}: ${rate.toFixed(1)}`}><input className="w-full accent-sky-600" type="range" min="0.5" max="1.5" step="0.1" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></FormField>
        </div>
        {!matchingVoice ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100" role="status">{t("audio.noVoice")}</p> : null}
        <Button className="mt-4" type="button" variant="secondary" disabled={cards.length === 0} onClick={preview} icon={<Volume2 size={18} aria-hidden="true" />}>{t("audio.preview")}</Button>
        {audioStatus ? <p className="mt-3 text-sm font-semibold" role="status">{audioStatus}</p> : null}
      </EditorSection>

      <div className="sticky bottom-3 z-20 flex justify-end gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <Link className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold" to={`/lessons/${lesson.id}`}>{t("common.cancel")}</Link>
        <Button disabled={saving || !name.trim() || translationLanguages.length === 0 || duplicateNewItems || invalidNewTranslation} onClick={() => void save()}>{saving ? t("common.saving") : t("common.save")}</Button>
      </div>
    </div>
  );
}

function EditorSection({ children, number, title }: { children: ReactNode; number: string; title: string }) {
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
    <h2 className="mb-5 flex items-center gap-3 text-xl font-black"><span className="grid size-8 place-items-center rounded-full bg-sky-100 text-sm text-sky-800 dark:bg-sky-950 dark:text-sky-200">{number}</span>{title}</h2>
    {children}
  </section>;
}

function TypeButton({ active, disabled = false, icon: Icon, label, onClick }: { active: boolean; disabled?: boolean; icon: typeof BookOpenText; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className={`rounded-2xl border p-4 text-left font-bold ${disabled ? "cursor-not-allowed opacity-45" : "hover:border-sky-400"} ${active ? "border-sky-500 bg-sky-50 ring-2 ring-sky-400 dark:bg-sky-950" : "border-slate-200 dark:border-slate-700"}`} disabled={disabled} onClick={onClick} type="button">
    <Icon className="mb-2 text-sky-600" size={25} aria-hidden="true" />{label}
  </button>;
}
