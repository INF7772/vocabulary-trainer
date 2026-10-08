import { BookOpen, LogOut, Moon, Plus, Settings, SlidersHorizontal, Sun } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

import { APP_NAME } from "../config/app";
import { languageDisplayName } from "../config/languages";
import { settingsRepository } from "../data";
import type { InterfaceLanguage, ThemePreference } from "../domain";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useTheme } from "../hooks/useTheme";
import { interfaceLanguageCodes } from "../i18n/supported-locales";
import {
  exitDesktopApplication,
  isDesktopApplication,
} from "../services/desktop-shell";

export function AppShell() {
  const { t, i18n } = useTranslation();
  const online = useOnlineStatus();
  const { theme, setTheme } = useTheme();
  const desktop = isDesktopApplication();

  useEffect(() => {
    void settingsRepository.get().then((settings) => {
      if (i18n.resolvedLanguage?.split("-")[0] !== settings.interfaceLanguage) {
        void i18n.changeLanguage(settings.interfaceLanguage);
      }
    });
  }, [i18n]);

  useEffect(() => {
    document.documentElement.lang =
      i18n.resolvedLanguage?.split("-")[0] ?? "en";
  }, [i18n.resolvedLanguage]);

  async function changeInterfaceLanguage(language: InterfaceLanguage) {
    await settingsRepository.update({ interfaceLanguage: language });
    await i18n.changeLanguage(language);
  }

  const nextTheme: Record<ThemePreference, ThemePreference> = {
    system: "light",
    light: "dark",
    dark: "system",
  };

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950 antialiased dark:bg-slate-950 dark:text-slate-50">
      {desktop ? <div className="desktop-titlebar-spacer" aria-hidden="true" /> : null}
      <a
        className="sr-only z-50 rounded-lg bg-white px-4 py-2 focus:fixed focus:left-4 focus:top-4 focus:not-sr-only"
        href="#main-content"
      >
        {t("nav.skipToContent")}
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <NavLink
            className="mr-auto flex items-center gap-2 font-semibold tracking-tight"
            to="/"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-slate-950 text-white dark:bg-sky-400 dark:text-slate-950">
              <BookOpen aria-hidden="true" size={19} />
            </span>
            <span className="hidden sm:inline">{APP_NAME}</span>
          </NavLink>
          <nav
            aria-label={t("nav.primaryNavigation")}
            className="flex items-center gap-1"
          >
            <NavigationLink
              icon={<BookOpen size={17} />}
              label={t("nav.lessons")}
              to="/"
            />
            <NavigationLink
              icon={<SlidersHorizontal size={17} />}
              label={t("nav.practice")}
              to="/practice"
            />
          </nav>
          <NavLink
            aria-label={t("nav.newLesson")}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
            to="/lessons/new"
          >
            <Plus aria-hidden="true" size={17} />
            <span className="hidden lg:inline">{t("nav.newLesson")}</span>
          </NavLink>
          <details className="group relative">
            <summary
              aria-label={t("nav.settings")}
              className="grid size-10 cursor-pointer list-none place-items-center rounded-lg text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden"
            >
              <Settings aria-hidden="true" size={19} />
            </summary>
            <div className="absolute right-0 top-12 z-50 w-72 space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="interface-language">
                {t("language.label")}
              </label>
              <select
                className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950"
                id="interface-language"
                onChange={(event) =>
                  void changeInterfaceLanguage(
                    event.target.value as InterfaceLanguage,
                  )
                }
                value={i18n.resolvedLanguage?.split("-")[0] ?? "en"}
              >
                {interfaceLanguageCodes.map((language) => (
                  <option key={language} value={language}>
                    {languageDisplayName(language, t)}
                  </option>
                ))}
              </select>
              <button
                className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => void setTheme(nextTheme[theme])}
                type="button"
              >
                {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
                {t("theme.label")}: {t(`theme.${theme}`)}
              </button>
              <NavLink
                className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
                to="/settings"
              >
                <Settings aria-hidden="true" size={18} />
                {t("nav.settings")}
              </NavLink>
              {desktop ? (
              <button
                className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
                data-testid="desktop-exit"
                onClick={() => void exitDesktopApplication()}
                type="button"
              >
                <LogOut aria-hidden="true" size={18} />
                {t("common.exit")}
              </button>
              ) : null}
            </div>
          </details>
        </div>
        {!online ? (
          <div
            className="border-t border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            role="status"
          >
            {t("common.offline")}
          </div>
        ) : null}
      </header>
      <main
        className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
        id="main-content"
      >
        <Outlet />
      </main>
    </div>
  );
}

function NavigationLink({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        `inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${isActive ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`
      }
      end={to === "/"}
      to={to}
    >
      {icon}
      {label}
    </NavLink>
  );
}
