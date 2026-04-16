/**
 * Piper “native” voices: codes with an entry in `TRINITY_PIPER_VOICE` match `getVoiceForLanguage` in
 * `services/piper-tts-proxy/server.ts`. Read-aloud uses {@link getPiperVoiceForChosenLanguage}: native
 * Piper for those codes, **English Piper** for every other translate target.
 *
 * **Translate UIs** (note menu, Advanced lab) list languages from LibreTranslate `/languages` that also
 * have an explicit LanguageTool mapping (`translateCodeHasLanguageToolPairing` in
 * `languagetool-language-order.ts`). That avoids offering targets LT cannot pair with, and avoids
 * showing “Turkish” when your LibreTranslate image has no `tr` Argos model (the API would error).
 */
import type { TranslateLanguageOption } from '@/lib/translate-client'
import { normalizeTranslateLangCode } from '@/lib/translate-client'
import {
  translateCodeHasLanguageToolPairing,
  translateTargetToLanguageToolCode
} from '@/lib/languagetool-language-order'

export const TRINITY_LANGUAGE_CODES = [
  'en',
  'de',
  'fr',
  'es',
  'ru',
  'zh',
  'pl',
  'nl',
  'cs',
  'tr'
] as const

export type TrinityLanguageCode = (typeof TRINITY_LANGUAGE_CODES)[number]

const TRINITY_SET = new Set<string>(TRINITY_LANGUAGE_CODES)

/** Piper voice ids — same as `services/piper-tts-proxy/server.ts` `voiceMap`. */
export const TRINITY_PIPER_VOICE: Record<TrinityLanguageCode, string> = {
  en: 'en_US-lessac-medium',
  de: 'de_DE-thorsten-medium',
  fr: 'fr_FR-siwis-medium',
  es: 'es_ES-davefx-medium',
  ru: 'ru_RU-ruslan-medium',
  zh: 'zh_CN-huayan-medium',
  pl: 'pl_PL-darkman-medium',
  nl: 'nl_NL-mls-medium',
  cs: 'cs_CZ-jirka-medium',
  tr: 'tr_TR-dfki-medium'
}

export const TRINITY_FALLBACK_ENGLISH_VOICE = TRINITY_PIPER_VOICE.en

/** Native autonyms / labels for **app UI** locales (General settings); not the full translate menu. */
export const TRINITY_LANGUAGE_DISPLAY_NAMES: { [K in TrinityLanguageCode]: string } = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ru: 'Русский',
  zh: '简体中文',
  pl: 'Polski',
  nl: 'Nederlands',
  cs: 'Čeština',
  tr: 'Türkçe'
}

export function isTrinityLanguageCode(s: string): s is TrinityLanguageCode {
  return TRINITY_SET.has(s as TrinityLanguageCode)
}

/** Map browser / i18next tag to a trinity app locale (defaults to `en`). */
export function normalizeBrowserLangToTrinityCode(lng: string): TrinityLanguageCode {
  const raw = lng.trim().toLowerCase()
  const first = raw.split(/[-_]/u)[0] ?? 'en'
  if (isTrinityLanguageCode(first)) return first
  if (isTrinityLanguageCode(raw)) return raw as TrinityLanguageCode
  return 'en'
}

/** LibreTranslate `target` / `source` code (after normalization). */
export function trinityTranslateTarget(code: string): string {
  return normalizeTranslateLangCode(code)
}

/** LanguageTool `language` parameter for grammar. */
export function trinityLanguageToolCode(code: string): string {
  return translateTargetToLanguageToolCode(code)
}

/**
 * LibreTranslate `/languages` entries that have an explicit LT mapping, deduped by LT grammar code
 * (one row per LanguageTool language; prefers shorter API codes like `zh` over `zh-CN`).
 */
export function filterTranslateLanguagesWithLanguageToolPairing(
  list: TranslateLanguageOption[]
): TranslateLanguageOption[] {
  const withPairing = list.filter((l) => translateCodeHasLanguageToolPairing(l.code))
  const byLt = new Map<string, TranslateLanguageOption>()
  for (const l of withPairing) {
    const lt = translateTargetToLanguageToolCode(l.code)
    const prev = byLt.get(lt)
    if (!prev || l.code.trim().length < prev.code.trim().length) {
      byLt.set(lt, l)
    }
  }
  return Array.from(byLt.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

export function getPiperVoiceForTrinityLanguage(lang: TrinityLanguageCode): {
  voice: string
  usedEnglishVoiceFallback: boolean
} {
  return {
    voice: TRINITY_PIPER_VOICE[lang],
    usedEnglishVoiceFallback: false
  }
}

/** Native Piper when we ship a voice; otherwise English Piper (read-aloud / lab). */
export function getPiperVoiceForChosenLanguage(lang: string): {
  voice: string
  usedEnglishVoiceFallback: boolean
} {
  if (isTrinityLanguageCode(lang)) {
    return getPiperVoiceForTrinityLanguage(lang)
  }
  return {
    voice: TRINITY_FALLBACK_ENGLISH_VOICE,
    usedEnglishVoiceFallback: lang !== 'en'
  }
}

/**
 * LanguageTool `language` dropdown for the lab: UI language’s LT code, `en-US`, then one entry per
 * translate target (from the filtered LibreTranslate list).
 */
export function buildLabLanguageToolPreferenceList(
  i18nLanguage: string | undefined,
  translateLangs: readonly TranslateLanguageOption[]
): string[] {
  const ordered: string[] = []
  const push = (c: string) => {
    if (!ordered.includes(c)) ordered.push(c)
  }
  const raw = (i18nLanguage ?? 'en').trim() || 'en'
  push(translateTargetToLanguageToolCode(raw))
  push('en-US')
  const extras = translateLangs.map((l) => translateTargetToLanguageToolCode(l.code))
  extras.sort((a, b) => a.localeCompare(b))
  for (const c of extras) {
    push(c)
  }
  return ordered
}
