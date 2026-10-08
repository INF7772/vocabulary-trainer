import { Check, ChevronDown } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  findLanguage,
  languageDisplayName,
  languageRegistry,
} from "../config/languages";
import { inputClassName } from "./ui/FormField";

export function LanguageCombobox({
  id,
  value,
  onChange,
  exclude = [],
}: {
  id: string;
  value: string;
  onChange: (languageCode: string) => void;
  exclude?: readonly string[];
}) {
  const { t } = useTranslation();
  const generatedId = useId();
  const listId = `${generatedId}-listbox`;
  const [open, setOpen] = useState(false);
  const selected = findLanguage(value);
  const [query, setQuery] = useState(() =>
    selected ? languageDisplayName(selected.code, t) : "",
  );

  const options = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return languageRegistry.filter((language) => {
      if (exclude.includes(language.code)) return false;
      if (!normalized || language.code === value) return true;
      const terms = [
        language.code,
        language.englishName,
        languageDisplayName(language.code, t),
        ...language.aliases,
      ];
      return terms.some((term) =>
        term.toLocaleLowerCase().includes(normalized),
      );
    });
  }, [exclude, query, t, value]);

  return (
    <div className="relative">
      <input
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        autoComplete="off"
        className={`${inputClassName} pr-10`}
        id={id}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={(event) => {
          event.currentTarget.select();
          setOpen(true);
        }}
        placeholder={t("wizard.languageSearchPlaceholder")}
        role="combobox"
        value={query}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-3.5 text-slate-500"
        size={18}
      />
      {open ? (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          id={listId}
          role="listbox"
        >
          {options.length ? (
            options.map((language) => (
              <li key={language.code} role="option" aria-selected={language.code === value}>
                <button
                  className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(language.code);
                    setQuery(languageDisplayName(language.code, t));
                    setOpen(false);
                  }}
                  type="button"
                >
                  <span>
                    <strong>{languageDisplayName(language.code, t)}</strong>
                    {languageDisplayName(language.code, t) !== language.englishName ? (
                      <span className="ml-2 text-sm text-slate-500">
                        {language.englishName}
                      </span>
                    ) : null}
                  </span>
                  {language.code === value ? <Check size={17} aria-hidden="true" /> : null}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-slate-500">
              {t("wizard.noLanguagesFound")}
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
