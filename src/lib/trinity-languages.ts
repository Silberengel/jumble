/**
 * Piper voices match `services/piper-tts-proxy/server.ts` `getVoiceForLanguage` (`TRINITY_PIPER_VOICE` + `EXTRA_READ_ALOUD_PIPER_VOICE`).
 * Read-aloud uses {@link getPiperVoiceForChosenLanguage}: native Piper for trinity UI codes, then
 * **related** Piper (e.g. Chinese for Japanese/Korean — no `ja`/`ko` in rhasspy/piper-voices yet),
 * then **English** when no heuristic fits.
 *
 * **Translate UIs** use `filterTranslateLanguagesWithGrammarCatalog` in `language-display-meta.ts`:
 * Libre `/languages` ∩ LanguageTool pairing (installed translate targets only).
 */
import {
  normalizeTranslateLangCode,
  type TranslateLanguageOption
} from '@/lib/translate-client'
import { translateTargetToLanguageToolCode } from '@/lib/languagetool-language-order'

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

/**
 * Read-aloud Piper voices beyond app UI locales (rhasspy/piper-voices). Install files into
 * `.local-piper-data` — see `scripts/download-piper-extra-voices.sh`.
 */
export const EXTRA_READ_ALOUD_PIPER_VOICE: Record<string, string> = {
  ar: 'ar_JO-kareem-medium',
  it: 'it_IT-paola-medium',
  pt: 'pt_BR-cadu-medium'
}

export type PiperReadAloudProfileCode = TrinityLanguageCode | keyof typeof EXTRA_READ_ALOUD_PIPER_VOICE

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

export const PIPER_READ_ALOUD_PROFILE_LABELS: Record<PiperReadAloudProfileCode, string> = {
  ...TRINITY_LANGUAGE_DISPLAY_NAMES,
  ar: 'العربية',
  it: 'Italiano',
  pt: 'Português'
}

export function piperReadAloudProfileLabel(code: PiperReadAloudProfileCode): string {
  return PIPER_READ_ALOUD_PROFILE_LABELS[code]
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

export type PiperVoiceResolution = {
  voice: string
  /** True when using `TRINITY_PIPER_VOICE.en` because no related model was chosen. */
  usedEnglishVoiceFallback: boolean
  /** True when using another trinity voice (e.g. `zh`) to approximate the requested language. */
  usedRelatedVoiceFallback: boolean
  /** Piper profile for UI labels (trinity locale or e.g. `ar` for Arabic read-aloud). */
  piperProfileCode: PiperReadAloudProfileCode
}

/**
 * ISO 639-1 (or base BCP47 segment) → trinity Piper voice to approximate when we have no native model.
 * Keep conservative: same-script / regional neighbors only where it helps more than English.
 */
const RELATED_PIPER_FOR_BASE: Record<string, TrinityLanguageCode> = {
  ja: 'zh',
  ko: 'zh',
  uk: 'ru',
  be: 'ru',
  bg: 'ru',
  mk: 'ru',
  sr: 'ru',
  bs: 'ru',
  kk: 'ru',
  ky: 'ru',
  mn: 'ru',
  tg: 'ru',
  sk: 'cs',
  sl: 'de',
  hr: 'ru',
  ca: 'es',
  gl: 'es',
  ro: 'es',
  la: 'es',
  sq: 'es',
  oc: 'es',
  eu: 'es',
  da: 'de',
  sv: 'de',
  no: 'de',
  nb: 'de',
  nn: 'de',
  is: 'de',
  fo: 'de',
  lb: 'de',
  fy: 'de',
  gsw: 'de',
  nds: 'de',
  et: 'de',
  lv: 'de',
  fi: 'de',
  hu: 'de',
  el: 'es',
  br: 'fr',
  mt: 'es'
}

export function getPiperVoiceForTrinityLanguage(lang: TrinityLanguageCode): PiperVoiceResolution {
  return {
    voice: TRINITY_PIPER_VOICE[lang],
    usedEnglishVoiceFallback: false,
    usedRelatedVoiceFallback: false,
    piperProfileCode: lang
  }
}

function baseLangTag(raw: string): string {
  const n = normalizeTranslateLangCode(raw).toLowerCase().replace(/_/gu, '-')
  return n.split(/-/u)[0] ?? n
}

/** Piper voice for read-aloud: native trinity → related trinity → English. */
export function getPiperVoiceForChosenLanguage(rawLang: string): PiperVoiceResolution {
  const base = baseLangTag(rawLang)
  const full = normalizeTranslateLangCode(rawLang).toLowerCase().replace(/_/gu, '-')

  if (isTrinityLanguageCode(base)) {
    return getPiperVoiceForTrinityLanguage(base)
  }
  if (isTrinityLanguageCode(full)) {
    return getPiperVoiceForTrinityLanguage(full)
  }

  const extraVoice = EXTRA_READ_ALOUD_PIPER_VOICE[base]
  if (extraVoice) {
    return {
      voice: extraVoice,
      usedEnglishVoiceFallback: false,
      usedRelatedVoiceFallback: false,
      piperProfileCode: base as PiperReadAloudProfileCode
    }
  }

  const related = RELATED_PIPER_FOR_BASE[full] ?? RELATED_PIPER_FOR_BASE[base] ?? null

  if (related) {
    return {
      voice: TRINITY_PIPER_VOICE[related],
      usedEnglishVoiceFallback: false,
      usedRelatedVoiceFallback: true,
      piperProfileCode: related
    }
  }

  return {
    voice: TRINITY_FALLBACK_ENGLISH_VOICE,
    usedEnglishVoiceFallback: base !== 'en' && full !== 'en',
    usedRelatedVoiceFallback: false,
    piperProfileCode: 'en'
  }
}

/**
 * LanguageTool `language` dropdown for the lab: same logical set as the translate targets (Libre
 * `/languages` ∩ LT), so grammar never offers e.g. Spanish when the translator was not built with
 * Spanish. Order: UI language’s LT (if installed), `en-US` (if English is installed), then other
 * targets in **translate list order** (matches source/target dropdowns).
 */
export function buildLabLanguageToolPreferenceList(
  i18nLanguage: string | undefined,
  translateLangs: readonly TranslateLanguageOption[]
): string[] {
  const allowedLt = new Set(
    translateLangs.map((l) => translateTargetToLanguageToolCode(l.code))
  )
  const ordered: string[] = []
  const push = (c: string) => {
    if (!ordered.includes(c) && allowedLt.has(c)) ordered.push(c)
  }
  const raw = (i18nLanguage ?? 'en').trim() || 'en'
  push(translateTargetToLanguageToolCode(raw))
  push('en-US')
  for (const l of translateLangs) {
    push(translateTargetToLanguageToolCode(l.code))
  }
  return ordered
}
