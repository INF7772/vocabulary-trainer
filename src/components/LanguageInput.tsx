import { useId } from "react";
import { useTranslation } from "react-i18next";

import { languageDisplayName, languageRegistry } from "../config/languages";
import { inputClassName } from "./ui/FormField";

export function LanguageInput({
  id,
  value,
  onChange,
  disabled = false,
  placeholder = "de, en-US, uk…",
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const generatedId = useId();
  const listId = `${id ?? generatedId}-languages`;
  const { t } = useTranslation();
  return (
    <>
      <input
        id={id}
        className={inputClassName}
        list={listId}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {languageRegistry.map((language) => (
          <option key={language.code} value={language.code}>
            {languageDisplayName(language.code, t)} (
            {language.preferredTtsLocale})
          </option>
        ))}
      </datalist>
    </>
  );
}
