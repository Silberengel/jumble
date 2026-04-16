import type { TLanguage } from '@/i18n'

/**
 * Piper voice ids aligned with the default Wyoming / `piper-tts-proxy` stock models
 * (see `services/piper-tts-proxy/server.ts` `getVoiceForLanguage`).
 * App locales without a dedicated model use {@link PIPER_FALLBACK_ENGLISH_VOICE}.
 */
const PIPER_VOICE_BY_APP_LANGUAGE: Partial<Record<TLanguage, string>> = {
  en: 'en_US-lessac-medium',
  de: 'de_DE-thorsten-medium',
  fr: 'fr_FR-siwis-medium',
  es: 'es_ES-davefx-medium',
  ru: 'ru_RU-ruslan-medium',
  zh: 'zh_CN-huayan-medium',
  pl: 'pl_PL-darkman-medium'
}

export const PIPER_FALLBACK_ENGLISH_VOICE = 'en_US-lessac-medium'

export function getPiperVoiceForChosenLanguage(lang: TLanguage): {
  voice: string
  usedEnglishVoiceFallback: boolean
} {
  const v = PIPER_VOICE_BY_APP_LANGUAGE[lang]
  if (v) {
    return { voice: v, usedEnglishVoiceFallback: false }
  }
  return {
    voice: PIPER_FALLBACK_ENGLISH_VOICE,
    usedEnglishVoiceFallback: lang !== 'en'
  }
}
