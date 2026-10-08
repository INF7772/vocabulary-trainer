import Kuroshiro from "kuroshiro";

const KANA_CHARACTER = /^[\p{Script=Hiragana}\p{Script=Katakana}]$/u;
const KANA_TEXT = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
const SMALL_KANA_OR_LENGTH_MARK = /^[ぁぃぅぇぉゃゅょゎゕゖァィゥェォャュョヮヵヶー]$/u;
const HIRAGANA_GLYPHS = [..."あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ"];
const KATAKANA_GLYPHS = [..."アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ"];
const HIRAGANA_CONTRACTED = ["きゃ", "きゅ", "きょ", "しゃ", "しゅ", "しょ", "ちゃ", "ちゅ", "ちょ", "にゃ", "にゅ", "にょ", "ひゃ", "ひゅ", "ひょ", "みゃ", "みゅ", "みょ", "りゃ", "りゅ", "りょ", "ぎゃ", "ぎゅ", "ぎょ", "じゃ", "じゅ", "じょ", "びゃ", "びゅ", "びょ", "ぴゃ", "ぴゅ", "ぴょ"];
const KATAKANA_CONTRACTED = ["キャ", "キュ", "キョ", "シャ", "シュ", "ショ", "チャ", "チュ", "チョ", "ニャ", "ニュ", "ニョ", "ヒャ", "ヒュ", "ヒョ", "ミャ", "ミュ", "ミョ", "リャ", "リュ", "リョ", "ギャ", "ギュ", "ギョ", "ジャ", "ジュ", "ジョ", "ビャ", "ビュ", "ビョ", "ピャ", "ピュ", "ピョ"];

/**
 * Returns an immediate Hepburn reading for kana-only study cards.
 *
 * A kana symbol has a pronunciation but no semantic translation. Sending it
 * through a general translation model can make decoding run until its maximum
 * output length and still produce no useful Card meaning. Romaji gives these
 * Cards the stable second side required by the learning modes without loading
 * the large translation model.
 */
export function kanaStudyReading(
  text: string,
  sourceLanguage: string,
): string | null {
  if (sourceLanguage !== "ja") return null;
  const normalized = text.normalize("NFC").trim();
  const characters = [...normalized];
  const isSingleKana = characters.length === 1 && KANA_CHARACTER.test(characters[0]!);
  const isContractedSyllable =
    characters.length === 2 &&
    KANA_CHARACTER.test(characters[0]!) &&
    SMALL_KANA_OR_LENGTH_MARK.test(characters[1]!);
  if (!isSingleKana && !isContractedSyllable) {
    return null;
  }
  const reading = Kuroshiro.Util.kanaToRomaji(normalized, "hepburn").trim();
  return reading && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(reading)
    ? reading
    : null;
}

/** Returns a Hepburn answer for kana text without requiring a Japanese IME. */
export function japaneseRomajiReading(
  text: string,
  sourceLanguage: string,
): string | null {
  if (sourceLanguage !== "ja") return null;
  const normalized = text.normalize("NFC").trim();
  if (!normalized || !KANA_TEXT.test(normalized)) return null;
  const reading = Kuroshiro.Util.kanaToRomaji(normalized, "hepburn").trim();
  return reading && !KANA_TEXT.test(reading) ? reading : null;
}

/**
 * Builds stable, font-rendered answer tiles for a kana recall question.
 * Lesson glyphs are preferred; the built-in kana inventory fills small lessons.
 */
export function createKanaGlyphOptions(
  target: string,
  sourceLanguage: string,
  candidateTargets: readonly string[],
  maximumOptions = 4,
): string[] {
  const normalized = target.normalize("NFC").trim();
  if (!kanaStudyReading(normalized, sourceLanguage)) return [];
  if (!Number.isInteger(maximumOptions) || maximumOptions < 2) {
    throw new Error("Kana choices require at least two options.");
  }

  const length = [...normalized].length;
  const katakana = /\p{Script=Katakana}/u.test(normalized[0] ?? "");
  const fallback = length === 2
    ? (katakana ? KATAKANA_CONTRACTED : HIRAGANA_CONTRACTED)
    : (katakana ? KATAKANA_GLYPHS : HIRAGANA_GLYPHS);
  const compatibleCandidates = candidateTargets
    .map((value) => value.normalize("NFC").trim())
    .filter(
      (value) =>
        [...value].length === length &&
        kanaStudyReading(value, sourceLanguage) !== null &&
        /\p{Script=Katakana}/u.test(value[0] ?? "") === katakana,
    );
  const pool = [...new Set([...compatibleCandidates, ...fallback])]
    .filter((value) => value !== normalized);
  const offset = stableKanaHash(normalized) % Math.max(1, pool.length);
  const distractors = [...pool.slice(offset), ...pool.slice(0, offset)]
    .slice(0, maximumOptions - 1);
  const result = [normalized, ...distractors];
  const rotation = stableKanaHash(`${normalized}:position`) % result.length;
  return [...result.slice(rotation), ...result.slice(0, rotation)];
}

function stableKanaHash(value: string): number {
  return [...value].reduce(
    (hash, character) => ((hash * 31) + (character.codePointAt(0) ?? 0)) >>> 0,
    17,
  );
}

export function canUseKanaStudyReadings(
  texts: readonly string[],
  sourceLanguage: string,
): boolean {
  return texts.length > 0 && texts.every(
    (text) => kanaStudyReading(text, sourceLanguage) !== null,
  );
}

export function fillMissingKanaStudyTranslations(
  text: string,
  sourceLanguage: string,
  translationLanguages: readonly string[],
  translations: Readonly<Record<string, string>>,
): Record<string, string> {
  const reading = kanaStudyReading(text, sourceLanguage);
  if (!reading) return translations;
  let changed = false;
  const next = { ...translations };
  for (const language of translationLanguages) {
    if (!next[language]?.trim()) {
      next[language] = reading;
      changed = true;
    }
  }
  return changed ? next : translations;
}
