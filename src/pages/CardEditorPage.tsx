import {
  ArrowLeft,
  ClipboardPaste,
  ExternalLink,
  ImagePlus,
  Mic,
  Square,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { CardImage } from "../components/CardImage";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { FormField, inputClassName } from "../components/ui/FormField";
import { cardsRepository } from "../data";
import type { AudioRecorder } from "../services/audio";
import {
  audioFromFile,
  playCardAudio,
  startAudioRecording,
} from "../services/audio";
import {
  ClipboardImageError,
  imageFromClipboardData,
  optimizeImage,
  readImageFromClipboard,
} from "../services/image";
import {
  createImageSearchSeed,
  openGoogleImagesSearch,
} from "../services/image-search";
import { useLessonBundle } from "../hooks/useLessonBundle";
import type { Card, CustomAudio, ImageMetadata, StoredImage } from "../domain";
import { DuplicateCardError } from "../data/repositories/errors";

export function CardEditorPage() {
  const { lessonId, cardId } = useParams();
  const bundle = useLessonBundle(lessonId);
  const card = bundle?.cards.find((item) => item.id === cardId);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [target, setTarget] = useState("");
  const [pronunciationText, setPronunciation] = useState("");
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [image, setImage] = useState<StoredImage | null>(null);
  const [imageMetadata, setImageMetadata] = useState<
    ImageMetadata | undefined
  >();
  const [customAudio, setCustomAudio] = useState<CustomAudio | undefined>();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<AudioRecorder | null>(null);

  useEffect(() => {
    if (!card) return;
    // Hydrate the local draft when the requested IndexedDB entity arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(card.target);
    setPronunciation(card.pronunciationText ?? "");
    setTranslations(card.translations);
    setImage(card.image);
    setImageMetadata(card.imageMetadata);
    setCustomAudio(card.customAudio);
    const primaryMeaning =
      card.translations.en ||
      card.translations[bundle?.lesson.activeTranslationLanguage ?? ""] ||
      card.target;
    setQuery(
      createImageSearchSeed(
        primaryMeaning,
        card.target,
        bundle?.lesson.targetLanguage,
      ),
    );
  }, [
    card,
    bundle?.lesson.activeTranslationLanguage,
    bundle?.lesson.targetLanguage,
  ]);

  if (bundle === undefined) return <p>{t("common.loading")}</p>;
  if (!bundle || !card) return <p>{t("notFound.title")}</p>;
  const { lesson } = bundle;
  const currentCard = card;
  const draft: Card = {
    ...card,
    target,
    pronunciationText: pronunciationText || undefined,
    translations,
    image,
    imageMetadata,
    customAudio,
  };

  async function ingestImage(blob: Blob) {
    if (!blob.type.startsWith("image/")) return;
    setStatus(null);
    try {
      setImage(await optimizeImage(blob));
      setImageMetadata(undefined);
      setStatus(t("card.imageReady"));
    } catch {
      setStatus(t("card.brokenImage"));
    }
  }

  async function searchGoogleImages() {
    if (!query.trim()) return;
    if (!navigator.onLine) {
      setStatus(t("common.offline"));
      return;
    }
    setStatus(null);
    setSearching(true);
    try {
      const selected = await openGoogleImagesSearch(query, {
        selectImage: t("card.useThisImage"),
        openSource: t("card.openImageSource"),
      });
      if (!selected) return;
      setImage(await optimizeImage(selected.blob));
      setImageMetadata(selected.sourceUrl ? { sourceUrl: selected.sourceUrl } : undefined);
      setStatus(t("card.imageReady"));
    } catch {
      setStatus(t("card.brokenImage"));
    } finally {
      setSearching(false);
    }
  }

  async function pasteImageFromClipboard() {
    setStatus(null);
    try {
      await ingestImage(await readImageFromClipboard());
    } catch (error) {
      setStatus(
        error instanceof ClipboardImageError && error.code === "no-image"
          ? t("card.clipboardNoImage")
          : t("card.clipboardUnavailable"),
      );
    }
  }

  async function toggleRecording() {
    if (recorder.current) {
      try {
        setCustomAudio(await recorder.current.stop());
      } catch {
        setStatus(t("audio.microphoneDenied"));
      } finally {
        recorder.current = null;
        setRecording(false);
      }
      return;
    }
    try {
      recorder.current = await startAudioRecording();
      setRecording(true);
    } catch {
      setStatus(t("audio.microphoneDenied"));
    }
  }

  async function save() {
    setStatus(null);
    try {
      await cardsRepository.update(currentCard.id, {
        target: target.trim(),
        pronunciationText: pronunciationText.trim() || undefined,
        translations,
        image,
        imageMetadata,
        customAudio,
      });
      navigate(`/lessons/${lesson.id}`);
    } catch (error) {
      setStatus(
        t(
          error instanceof DuplicateCardError
            ? "errors.duplicateCard"
            : "errors.storage",
        ),
      );
    }
  }

  function pasted(event: ClipboardEvent<HTMLDivElement>) {
    if (isTextEditingTarget(event.target)) return;
    const file = imageFromClipboardData(event.clipboardData);
    if (file) {
      event.preventDefault();
      void ingestImage(file);
    }
  }
  function dropped(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find((item) =>
      item.type.startsWith("image/"),
    );
    if (file) void ingestImage(file);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-7" onPaste={pasted}>
      <Link
        className="inline-flex items-center gap-2 text-sm font-semibold"
        to={`/lessons/${lesson.id}`}
      >
        <ArrowLeft size={17} aria-hidden="true" />
        {t("common.back")}
      </Link>
      <PageHeader title={t("lesson.editCard")} description={lesson.name} />
      {status ? (
        <p
          role="status"
          className="rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {status}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <FormField htmlFor="target" label={t("card.target")}>
            <input
              id="target"
              className={inputClassName}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </FormField>
          <FormField htmlFor="pronunciation" label={t("card.pronunciation")}>
            <input
              id="pronunciation"
              className={inputClassName}
              value={pronunciationText}
              onChange={(e) => setPronunciation(e.target.value)}
            />
          </FormField>
          <fieldset className="space-y-4">
            <legend className="mb-3 font-bold">{t("card.translations")}</legend>
            {lesson.translationLanguages.map((language) => (
              <FormField
                key={language}
                htmlFor={`translation-${language}`}
                label={language.toUpperCase()}
              >
                <input
                  id={`translation-${language}`}
                  className={inputClassName}
                  value={translations[language] ?? ""}
                  onChange={(e) =>
                    setTranslations((value) => ({
                      ...value,
                      [language]: e.target.value,
                    }))
                  }
                />
              </FormField>
            ))}
          </fieldset>
        </section>

        {lesson.useImages ? (
          <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-xl font-bold">
              {t("card.image")}{" "}
              <span className="text-sm font-normal text-slate-500">
                ({t("card.optional")})
              </span>
            </h2>
            <div
              data-testid="image-drop-zone"
              tabIndex={0}
              onDrop={dropped}
              onDragOver={(e) => e.preventDefault()}
              className="rounded-2xl border-2 border-dashed border-slate-300 p-3 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700"
            >
              <CardImage
                image={image}
                className="aspect-[16/10] w-full rounded-xl"
                loading="eager"
              />
              <p className="mt-3 text-sm text-slate-500">
                {t("card.imageHint")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                  <ImagePlus size={18} aria-hidden="true" />
                  {t("card.chooseImage")}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void ingestImage(file);
                    }}
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void pasteImageFromClipboard()}
                  icon={<ClipboardPaste size={18} aria-hidden="true" />}
                >
                  {t("card.pasteImage")}
                </Button>
                {image ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setImage(null);
                      setImageMetadata(undefined);
                    }}
                    icon={<X size={18} aria-hidden="true" />}
                  >
                    {t("common.delete")}
                  </Button>
                ) : null}
              </div>
            </div>
            {imageMetadata?.sourceUrl ? (
              <p className="text-sm">
                <a
                  className="text-sky-700 underline dark:text-sky-300"
                  href={imageMetadata.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t("card.source")}
                </a>
                {imageMetadata.author ? ` · ${imageMetadata.author}` : ""}
                {imageMetadata.license ? ` · ${imageMetadata.license}` : ""}
              </p>
            ) : null}
            <details className="rounded-xl border border-slate-200 dark:border-slate-700">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                {t("card.imageSearch")}
              </summary>
              <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                <div className="flex gap-2">
                <input
                  aria-label={t("card.imageSearch")}
                  id="image-search"
                  className={inputClassName}
                  value={query}
                  placeholder={t("card.searchPlaceholder")}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button
                  type="button"
                  disabled={searching || !query.trim()}
                  onClick={() => void searchGoogleImages()}
                  icon={<ExternalLink size={18} aria-hidden="true" />}
                >
                  {searching ? t("card.searching") : t("card.searchGoogleImages")}
                </Button>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {t("card.googleImagesHint")}
                </p>
              </div>
            </details>
          </section>
        ) : null}
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <h2 className="text-xl font-bold">{t("audio.title")}</h2>
          <span className="text-sm text-slate-500">
            {customAudio ? t("audio.custom") : t("audio.system")}
          </span>
        </summary>
        <div className="flex flex-wrap gap-2 border-t border-slate-200 p-5 dark:border-slate-800">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void playCardAudio(draft, lesson).catch(() =>
                setStatus(t("audio.noVoice")),
              )
            }
            icon={<Volume2 size={18} aria-hidden="true" />}
          >
            {t("audio.play")}
          </Button>
          <Button
            type="button"
            variant={recording ? "danger" : "secondary"}
            onClick={() => void toggleRecording()}
            icon={
              recording ? (
                <Square size={18} aria-hidden="true" />
              ) : (
                <Mic size={18} aria-hidden="true" />
              )
            }
          >
            {recording ? t("audio.stop") : t("audio.record")}
          </Button>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 font-semibold dark:border-slate-700">
            <Upload size={18} aria-hidden="true" />
            {t("audio.upload")}
            <input
              className="sr-only"
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setCustomAudio(audioFromFile(file));
              }}
            />
          </label>
          {customAudio ? (
            <Button variant="ghost" onClick={() => setCustomAudio(undefined)}>
              {t("audio.reset")}
            </Button>
          ) : null}
        </div>
      </details>
      <div className="flex justify-end gap-2">
        <Link
          className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold"
          to={`/lessons/${lesson.id}`}
        >
          {t("common.cancel")}
        </Link>
        <Button disabled={!target.trim()} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}
