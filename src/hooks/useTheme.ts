import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';

import { settingsRepository } from '../data';
import type { ThemePreference } from '../domain';
import { setDesktopWindowTheme } from '../services/desktop-shell';

export function useTheme() {
  const settings = useLiveQuery(() => settingsRepository.get(), []);

  useEffect(() => {
    if (!settings) {
      return;
    }

    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark =
        settings.theme === 'dark' ||
        (settings.theme === 'system' && Boolean(media?.matches));
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      void setDesktopWindowTheme(dark ? 'dark' : 'light');
    };
    apply();
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [settings]);

  const setTheme = (theme: ThemePreference) => settingsRepository.update({ theme });
  return { theme: settings?.theme ?? 'system', setTheme };
}
