import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import type { InterfaceLanguage } from '../domain';
import { resources } from './resources';
import {
  interfaceLanguageCodes,
  interfaceLanguageForSystemLocale,
} from './supported-locales';

function detectLanguage(): InterfaceLanguage {
  return interfaceLanguageForSystemLocale(globalThis.navigator?.language);
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en',
  supportedLngs: interfaceLanguageCodes,
  interpolation: {
    escapeValue: false,
  },
});

export { i18n };
