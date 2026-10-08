import { findLanguage } from "../config/languages";

const GOOGLE_IMAGES_URL = "https://www.google.com/search";
const MAX_BASE_QUERY_LENGTH = 180;
const EDUCATIONAL_REFINEMENT =
  "beginner vocabulary flashcard educational illustration";
const EXPLICIT_VISUAL_STYLE =
  /\b(?:photo|photograph|photography|photorealistic|real life)\b/iu;

export interface SelectedSearchImage {
  blob: Blob;
  sourceUrl?: string;
}

interface ImageSearchBridgeResult {
  bytes: Uint8Array | { data: number[] };
  mimeType: string;
  sourceUrl: string | null;
}

interface ImageSearchBridge {
  openImageSearch?: (
    query: string,
    labels: { selectImage: string; openSource: string },
  ) => Promise<ImageSearchBridgeResult | null>;
}

interface ImageSearchWindow extends Window {
  vocabularyTrainerDesktop?: ImageSearchBridge;
}

export function createImageSearchSeed(
  primaryMeaning: string,
  target: string,
  targetLanguage?: string,
): string {
  const uniqueTerms = new Map<string, string>();
  for (const value of [primaryMeaning, target]) {
    const normalized = normalizeWhitespace(value);
    const key = normalized.toLocaleLowerCase();
    if (normalized && !uniqueTerms.has(key)) uniqueTerms.set(key, normalized);
  }
  const languageName = targetLanguage
    ? findLanguage(targetLanguage)?.englishName
    : undefined;
  return [
    ...[...uniqueTerms.values()].map(quoteSearchTerm),
    ...(languageName ? [`${languageName} language`] : []),
  ].join(" ");
}

export function buildVisualImageSearchQuery(query: string): string {
  const normalized = normalizeWhitespace(query)
    .slice(0, MAX_BASE_QUERY_LENGTH)
    .trim();
  if (!normalized) return "";

  return EXPLICIT_VISUAL_STYLE.test(normalized)
    ? normalized
    : `${normalized} ${EDUCATIONAL_REFINEMENT}`;
}

export function googleImagesSearchUrl(query: string): string {
  const refinedQuery = buildVisualImageSearchQuery(query);
  const url = new URL(GOOGLE_IMAGES_URL);
  url.searchParams.set("tbm", "isch");
  url.searchParams.set("q", refinedQuery);
  return url.toString();
}

export async function openGoogleImagesSearch(
  query: string,
  labels: { selectImage: string; openSource: string },
): Promise<SelectedSearchImage | null> {
  const refinedQuery = buildVisualImageSearchQuery(query);
  if (!refinedQuery) return null;
  const bridge = (window as ImageSearchWindow).vocabularyTrainerDesktop;
  if (!bridge?.openImageSearch) {
    window.open(googleImagesSearchUrl(query), "_blank", "noopener,noreferrer");
    return null;
  }
  const selected = await bridge.openImageSearch(refinedQuery, labels);
  if (!selected) return null;
  const bytes = selected.bytes instanceof Uint8Array
    ? selected.bytes
    : new Uint8Array(selected.bytes.data);
  return {
    blob: new Blob([new Uint8Array(bytes).buffer], { type: selected.mimeType }),
    sourceUrl: selected.sourceUrl ?? undefined,
  };
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function quoteSearchTerm(value: string): string {
  const safe = value.replace(/["“”]/gu, "").trim();
  return safe ? `"${safe}"` : "";
}
