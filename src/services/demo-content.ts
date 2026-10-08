import type { Card } from "../domain";
import { cardsRepository, lessonsRepository } from "../data";
import type { CardRepository, LessonRepository } from "../data/repositories";

export const DEMO_LESSON_NAME = "Everyday English · Demo";

interface DemoCardDefinition {
  target: string;
  translation: string;
  image?: string;
}

const demoCards: readonly DemoCardDefinition[] = [
  { target: "bicycle", translation: "bicicleta", image: "bicycle.webp" },
  { target: "tea", translation: "té", image: "tea.webp" },
  { target: "market", translation: "mercado", image: "market.webp" },
  { target: "fox", translation: "zorro", image: "fox.webp" },
  { target: "window", translation: "ventana" },
  { target: "journey", translation: "viaje" },
  { target: "quiet", translation: "tranquilo" },
  { target: "bright", translation: "brillante" },
];

type DemoCardRepository = Pick<CardRepository, "createOrReuse" | "update">;
type DemoLessonRepository = Pick<LessonRepository, "addCard" | "create" | "list">;

interface DemoContentDependencies {
  cards?: DemoCardRepository;
  lessons?: DemoLessonRepository;
  loadImage?: (filename: string) => Promise<Card["image"]>;
  loadAudio?: (filename: string) => Promise<NonNullable<Card["customAudio"]>>;
}

/**
 * Gives a fresh installation a useful first screen without touching an
 * existing library. Re-running is safe, including after an interrupted load.
 */
export async function installBuiltInDemoLesson(
  dependencies: DemoContentDependencies = {},
): Promise<void> {
  const cards = dependencies.cards ?? cardsRepository;
  const lessons = dependencies.lessons ?? lessonsRepository;
  const existingLessons = await lessons.list();

  if (
    existingLessons.length > 0 &&
    !existingLessons.some(
      (lesson) =>
        lesson.name === DEMO_LESSON_NAME && lesson.targetLanguage === "en",
    )
  ) {
    return;
  }

  const lesson =
    existingLessons.find(
      (item) =>
        item.name === DEMO_LESSON_NAME && item.targetLanguage === "en",
    ) ??
    (await lessons.create({
      name: DEMO_LESSON_NAME,
      contentType: "vocabulary",
      targetLanguage: "en",
      translationLanguages: ["es"],
      activeTranslationLanguage: "es",
      visibleTranslationLanguages: ["es"],
      useImages: true,
      tts: { targetLocale: "en-US", speechRate: 0.95 },
    }));

  const loadImage = dependencies.loadImage ?? loadDemoImage;
  const loadAudio = dependencies.loadAudio ?? loadDemoAudio;

  for (const [position, item] of demoCards.entries()) {
    const image = item.image
      ? await loadImage(item.image).catch(() => null)
      : null;
    const customAudio = await loadAudio(`${item.target}.wav`).catch(
      () => undefined,
    );
    const result = await cards.createOrReuse({
      itemType: "vocabulary",
      target: item.target,
      targetLanguage: "en",
      translations: { es: item.translation },
      image,
      customAudio,
    });

    if (
      !result.created &&
      ((image && !result.card.image) || (customAudio && !result.card.customAudio))
    ) {
      await cards.update(result.card.id, {
        image: result.card.image ?? image,
        customAudio: result.card.customAudio ?? customAudio,
      });
    }
    await lessons.addCard(lesson.id, result.card.id, position);
  }
}

async function loadDemoAudio(
  filename: string,
): Promise<NonNullable<Card["customAudio"]>> {
  const response = await fetch(`/demo/audio/${filename}`);
  if (!response.ok) {
    throw new Error(`Demo audio could not be loaded: ${filename}`);
  }
  const blob = await response.blob();
  return {
    blob,
    mimeType: blob.type || "audio/wav",
  };
}

async function loadDemoImage(filename: string): Promise<Card["image"]> {
  const response = await fetch(`/demo/${filename}`);
  if (!response.ok) {
    throw new Error(`Demo image could not be loaded: ${filename}`);
  }
  const blob = await response.blob();
  return {
    blob,
    mimeType: blob.type || "image/webp",
    width: 720,
    height: 720,
    alt: filename.replace(/\.webp$/u, ""),
  };
}
