import { normalizeTranslateLangCode } from '@/lib/translate-client'

/**
 * Build LanguageTool `language` codes with UI language first, then English, then German, then others.
 * @see https://api.languagetool.org/v2/languages
 */
const LT_ALIASES: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es',
  it: 'it',
  pt: 'pt-BR',
  'pt-BR': 'pt-BR',
  'pt-PT': 'pt-PT',
  pl: 'pl-PL',
  ru: 'ru-RU',
  uk: 'uk-UA',
  nl: 'nl',
  sv: 'sv',
  da: 'da-DK',
  no: 'no',
  nb: 'no',
  nn: 'no',
  fi: 'fi',
  el: 'el-GR',
  tr: 'tr',
  ar: 'ar',
  he: 'he',
  hi: 'hi',
  ja: 'ja-JP',
  ko: 'ko',
  zh: 'zh-CN',
  fa: 'fa',
  th: 'th-TH',
  vi: 'vi-VN',
  ro: 'ro-RO',
  cs: 'cs-CZ',
  sk: 'sk-SK',
  hu: 'hu',
  sl: 'sl-SI',
  hr: 'hr-HR',
  sr: 'sr',
  bg: 'bg-BG',
  lt: 'lt-LT',
  lv: 'lv-LV',
  et: 'et-EE',
  ca: 'ca-ES',
  gl: 'gl-ES',
  tl: 'tl-PH',
  id: 'id',
  ms: 'ms-MY',
  ta: 'ta-IN',
  te: 'te-IN',
  mr: 'mr-IN',
  bn: 'bn-BD',
  gu: 'gu-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  pa: 'pa-IN',
  or: 'or-IN',
  as: 'as-IN',
  ne: 'ne-NP',
  si: 'si-LK',
  lo: 'lo-LA',
  km: 'km-KH',
  my: 'my-MM',
  ka: 'ka-GE',
  hy: 'hy-AM',
  az: 'az',
  kk: 'kk-KZ',
  mn: 'mn-MN',
  af: 'af',
  sw: 'sw',
  zu: 'zu',
  xh: 'xh',
  yo: 'yo',
  ig: 'ig',
  ha: 'ha',
  so: 'so-SO',
  am: 'am',
  ti: 'ti',
  om: 'om-ET',
  sn: 'sn-ZW',
  rw: 'rw',
  mg: 'mg-MG',
  ny: 'ny-MW',
  eo: 'eo',
  lb: 'lb',
  br: 'br-FR',
  cy: 'cy-GB',
  ga: 'ga-IE',
  gd: 'gd-GB',
  mt: 'mt-MT',
  is: 'is-IS',
  fo: 'fo-FO',
  tk: 'tk-TM',
  uz: 'uz-UZ',
  ky: 'ky-KG',
  tg: 'tg-TJ',
  ps: 'ps-AF',
  sd: 'sd-IN',
  ur: 'ur-PK',
  ckb: 'ckb-IQ',
  ku: 'kmr-Latn',
  yi: 'yi-001',
  jv: 'jv-Latn',
  su: 'su-Latn'
}

function mapI18nToLt(i18nLanguage: string): string {
  const base = i18nLanguage.split(/[-_]/u)[0]?.toLowerCase() ?? 'en'
  const full = i18nLanguage.replace('_', '-')
  if (LT_ALIASES[full]) return LT_ALIASES[full]!
  if (LT_ALIASES[base]) return LT_ALIASES[base]!
  return 'en-US'
}

/**
 * Map a LibreTranslate / lab target language code to a LanguageTool `language` value
 * (after {@link normalizeTranslateLangCode}).
 */
export function translateTargetToLanguageToolCode(translateCode: string): string {
  const n = normalizeTranslateLangCode(translateCode).toLowerCase().replace(/_/gu, '-')
  if (LT_ALIASES[n]) return LT_ALIASES[n]!
  const base = n.split(/-/u)[0] ?? n
  if (LT_ALIASES[base]) return LT_ALIASES[base]!
  return 'en-US'
}

/** Prefer a code present in `ltList` (lab grammar dropdown) when possible. */
export function pickLanguageToolCodeForTranslateTarget(
  translateCode: string,
  ltList: readonly string[]
): string {
  const mapped = translateTargetToLanguageToolCode(translateCode)
  if (ltList.includes(mapped)) return mapped
  const base = mapped.split(/-/u)[0]?.toLowerCase() ?? ''
  const hit = ltList.find(
    (c) => c.toLowerCase() === mapped.toLowerCase() || c.toLowerCase().startsWith(`${base}-`)
  )
  return hit ?? ltList[0] ?? mapped
}

export function buildLanguageToolPreferenceList(i18nLanguage: string | undefined): string[] {
  const primary = mapI18nToLt((i18nLanguage ?? 'en').trim() || 'en')
  const ordered: string[] = []
  const push = (c: string) => {
    if (!ordered.includes(c)) ordered.push(c)
  }
  push(primary)
  push('en-US')
  push('de-DE')
  const extras = Object.values(LT_ALIASES)
  extras.sort()
  for (const c of extras) {
    push(c)
  }
  return ordered
}
