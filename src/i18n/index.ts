import dayjs from 'dayjs'
import i18n, { Resource } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { TRINITY_LANGUAGE_CODES, TRINITY_LANGUAGE_DISPLAY_NAMES } from '@/lib/trinity-languages'
import en from './locales/en'

/** App UI locales with full bundles (see `trinity-languages.ts`); translate menus use Libre+LT from the API. */
const LANGUAGE_META = TRINITY_LANGUAGE_DISPLAY_NAMES

export type TLanguage = keyof typeof LANGUAGE_META

export const LocalizedLanguageNames: { [key in TLanguage]: string } = { ...LANGUAGE_META }

/** Same codes as {@link TRINITY_LANGUAGE_CODES} — stable order for every language dropdown. */
const supportedLanguages = [...TRINITY_LANGUAGE_CODES] as TLanguage[]

/** App UI languages (same set used for “Translate to …” in note menus). */
export const SUPPORTED_APP_LANGUAGE_CODES: readonly TLanguage[] = supportedLanguages

const localeModules = import.meta.glob<{ default: Resource }>('./locales/*.ts')

const localePath = (code: TLanguage): string => `./locales/${code}.ts`

/** Normalize a browser / i18next language tag to a supported app locale. */
export function normalizeToSupportedAppLanguage(lng: string): TLanguage {
  const exact = supportedLanguages.find((s) => lng === s)
  if (exact) return exact
  return supportedLanguages.find((s) => lng.startsWith(s)) ?? 'en'
}

async function ensureLocaleLoaded(code: TLanguage): Promise<void> {
  if (code === 'en') return
  if (i18n.hasResourceBundle(code, 'translation')) return
  const load = localeModules[localePath(code)]
  if (!load) {
    console.warn('[i18n] Missing locale module for', code)
    return
  }
  const mod = await load()
  i18n.addResourceBundle(code, 'translation', mod.default.translation, true, true)
}

export async function changeAppLanguage(code: TLanguage): Promise<void> {
  await ensureLocaleLoaded(code)
  await i18n.changeLanguage(code)
}

let initPromise: Promise<void> | null = null

export function initI18n(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    await i18n.use(LanguageDetector).use(initReactI18next).init({
      fallbackLng: 'en',
      supportedLngs: supportedLanguages,
      resources: { en },
      partialBundledLanguages: true,
      interpolation: {
        escapeValue: false
      },
      detection: {
        convertDetectedLanguage: (lng) => normalizeToSupportedAppLanguage(lng)
      }
    })

    i18n.services.formatter?.add('date', (timestamp, lng) => {
      switch (lng) {
        case 'zh':
          return dayjs(timestamp).format('YYYY年MM月DD日')
        case 'pl':
        case 'de':
        case 'ru':
        case 'cs':
          return dayjs(timestamp).format('DD.MM.YYYY')
        case 'es':
        case 'fr':
        case 'nl':
        case 'tr':
          return dayjs(timestamp).format('DD/MM/YYYY')
        default:
          return dayjs(timestamp).format('MMM D, YYYY')
      }
    })

    const target = normalizeToSupportedAppLanguage(i18n.language)
    if (target !== 'en') {
      await ensureLocaleLoaded(target)
      await i18n.changeLanguage(target)
    }
  })()
  return initPromise
}

export default i18n
