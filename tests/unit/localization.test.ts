import { describe, expect, it } from "vitest";

import { languageRegistry } from "../../src/config/languages";
import { interfaceLanguageForLocale } from "../../src/data/repositories/settings-repository";
import { interfaceLanguageCodes } from "../../src/i18n/supported-locales";
import { resources } from "../../src/i18n/resources";

type FlatLocale = Record<string, string>;

const intentionallySharedKeys = new Set([
  "audio.title",
  "automate.chaos",
  "card.optional",
  "card.source",
  "chaos.title",
  "learn.correct",
  "learn.question",
  "lesson.questions",
  "quick.length",
  "quick.mode",
  "quick.progress",
  "theme.system",
  "wizard.original",
]);

function flatten(
  value: Record<string, unknown>,
  prefix = "",
  result: FlatLocale = {},
): FlatLocale {
  for (const [key, item] of Object.entries(value)) {
    const itemPath = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object") {
      flatten(item as Record<string, unknown>, itemPath, result);
    } else {
      result[itemPath] = String(item);
    }
  }
  return result;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{[^}]+\}\}/gu)]
    .map(([placeholder]) => placeholder)
    .sort();
}

describe("complete interface localization", () => {
  const canonicalCodes = interfaceLanguageCodes;
  const english = flatten(resources.en.translation);

  it("uses the canonical translation-language registry for UI locales", () => {
    expect(interfaceLanguageCodes).toEqual(
      languageRegistry.map((language) => language.code),
    );
    expect(Object.keys(resources).sort()).toEqual([...canonicalCodes].sort());
  });

  it.each(canonicalCodes)("keeps %s complete and interpolation-safe", (code) => {
    const locale = flatten(resources[code].translation);
    expect(Object.keys(locale).sort()).toEqual(Object.keys(english).sort());
    for (const key of Object.keys(english)) {
      expect(locale[key]).toBeTruthy();
      expect(placeholders(locale[key]!)).toEqual(placeholders(english[key]!));
    }
  });

  it.each(canonicalCodes.filter((code) => code !== "en"))(
    "does not silently inherit English strings in %s",
    (code) => {
      const locale = flatten(resources[code].translation);
      const inherited = Object.keys(english).filter(
        (key) => locale[key] === english[key] && !intentionallySharedKeys.has(key),
      );
      expect(inherited).toEqual([]);
    },
  );

  it.each(canonicalCodes)("detects %s from an OS locale", (code) => {
    expect(interfaceLanguageForLocale(`${code}-TEST`)).toBe(code);
  });

  it("falls back to English only for unsupported or missing OS locales", () => {
    expect(interfaceLanguageForLocale("pt-BR")).toBe("en");
    expect(interfaceLanguageForLocale(undefined)).toBe("en");
  });
});
