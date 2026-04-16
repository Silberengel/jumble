/**
 * Canonical ISO-639-style language labels (English + endonym) for selection UI.
 * {@link getLanguageDisplayParts} falls back to `Intl.DisplayNames` when a code is missing here.
 *
 * JSX: {@link LanguageSelectOptionLines} in `language-select-option-lines.tsx` (this file stays `.ts`
 * so extensionless imports resolve cleanly under Vite).
 */
import { normalizeTranslateLangCode } from '@/lib/translate-client'

/** Lowercase keys: ISO 639-1 base, or BCP47 tag for regional overrides. */
export const LANGUAGE_TRIPLE_BY_LOWER_KEY: Record<string, { english: string; native: string }> =
  Object.fromEntries(
    (
      [
        ['en', 'English', 'English'],
        ['de', 'German', 'Deutsch'],
        ['fr', 'French', 'Français'],
        ['es', 'Spanish', 'español'],
        ['it', 'Italian', 'italiano'],
        ['pt', 'Portuguese', 'português'],
        ['pt-br', 'Portuguese (Brazil)', 'português (Brasil)'],
        ['pt-pt', 'Portuguese (Portugal)', 'português (Portugal)'],
        ['pl', 'Polish', 'polski'],
        ['ru', 'Russian', 'русский'],
        ['uk', 'Ukrainian', 'українська'],
        ['nl', 'Dutch', 'Nederlands'],
        ['sv', 'Swedish', 'svenska'],
        ['da', 'Danish', 'dansk'],
        ['no', 'Norwegian', 'norsk'],
        ['nb', 'Norwegian Bokmål', 'norsk bokmål'],
        ['nn', 'Norwegian Nynorsk', 'nynorsk'],
        ['fi', 'Finnish', 'suomi'],
        ['el', 'Greek', 'Ελληνικά'],
        ['tr', 'Turkish', 'Türkçe'],
        ['ar', 'Arabic', 'العربية'],
        ['he', 'Hebrew', 'עברית'],
        ['hi', 'Hindi', 'हिन्दी'],
        ['ja', 'Japanese', '日本語'],
        ['ko', 'Korean', '한국어'],
        ['zh', 'Chinese', '中文'],
        ['zh-cn', 'Chinese (Simplified)', '简体中文'],
        ['zh-tw', 'Chinese (Traditional)', '繁體中文'],
        ['zh-hans', 'Chinese (Simplified)', '简体中文'],
        ['zh-hant', 'Chinese (Traditional)', '繁體中文'],
        ['fa', 'Persian', 'فارسی'],
        ['th', 'Thai', 'ไทย'],
        ['vi', 'Vietnamese', 'Tiếng Việt'],
        ['ro', 'Romanian', 'română'],
        ['cs', 'Czech', 'čeština'],
        ['sk', 'Slovak', 'slovenčina'],
        ['hu', 'Hungarian', 'magyar'],
        ['sl', 'Slovenian', 'slovenščina'],
        ['hr', 'Croatian', 'hrvatski'],
        ['sr', 'Serbian', 'српски'],
        ['bg', 'Bulgarian', 'български'],
        ['lt', 'Lithuanian', 'lietuvių'],
        ['lv', 'Latvian', 'latviešu'],
        ['et', 'Estonian', 'eesti'],
        ['ca', 'Catalan', 'català'],
        ['gl', 'Galician', 'galego'],
        ['tl', 'Tagalog', 'Tagalog'],
        ['id', 'Indonesian', 'Bahasa Indonesia'],
        ['ms', 'Malay', 'Bahasa Melayu'],
        ['ta', 'Tamil', 'தமிழ்'],
        ['te', 'Telugu', 'తెలుగు'],
        ['mr', 'Marathi', 'मराठी'],
        ['bn', 'Bengali', 'বাংলা'],
        ['gu', 'Gujarati', 'ગુજરાતી'],
        ['kn', 'Kannada', 'ಕನ್ನಡ'],
        ['ml', 'Malayalam', 'മലയാളം'],
        ['pa', 'Punjabi', 'ਪੰਜਾਬੀ'],
        ['or', 'Odia', 'ଓଡ଼ିଆ'],
        ['as', 'Assamese', 'অসমীয়া'],
        ['ne', 'Nepali', 'नेपाली'],
        ['si', 'Sinhala', 'සිංහල'],
        ['lo', 'Lao', 'ລາວ'],
        ['km', 'Khmer', 'ខ្មែរ'],
        ['my', 'Burmese', 'မြန်မာ'],
        ['ka', 'Georgian', 'ქართული'],
        ['hy', 'Armenian', 'հայերեն'],
        ['az', 'Azerbaijani', 'azərbaycan'],
        ['kk', 'Kazakh', 'қазақ тілі'],
        ['mn', 'Mongolian', 'монгол'],
        ['af', 'Afrikaans', 'Afrikaans'],
        ['sw', 'Swahili', 'Kiswahili'],
        ['zu', 'Zulu', 'isiZulu'],
        ['xh', 'Xhosa', 'isiXhosa'],
        ['yo', 'Yoruba', 'Yorùbá'],
        ['ig', 'Igbo', 'Igbo'],
        ['ha', 'Hausa', 'Hausa'],
        ['so', 'Somali', 'Soomaali'],
        ['am', 'Amharic', 'አማርኛ'],
        ['ti', 'Tigrinya', 'ትግርኛ'],
        ['om', 'Oromo', 'Afaan Oromoo'],
        ['sn', 'Shona', 'chiShona'],
        ['rw', 'Kinyarwanda', 'Kinyarwanda'],
        ['mg', 'Malagasy', 'Malagasy'],
        ['ny', 'Chichewa', 'Chichewa'],
        ['eo', 'Esperanto', 'Esperanto'],
        ['lb', 'Luxembourgish', 'Lëtzebuergesch'],
        ['br', 'Breton', 'brezhoneg'],
        ['cy', 'Welsh', 'Cymraeg'],
        ['ga', 'Irish', 'Gaeilge'],
        ['gd', 'Scottish Gaelic', 'Gàidhlig'],
        ['mt', 'Maltese', 'Malti'],
        ['is', 'Icelandic', 'íslenska'],
        ['fo', 'Faroese', 'føroyskt'],
        ['tk', 'Turkmen', 'Türkmençe'],
        ['uz', 'Uzbek', 'oʻzbekcha'],
        ['ky', 'Kyrgyz', 'кыргызча'],
        ['tg', 'Tajik', 'тоҷикӣ'],
        ['ps', 'Pashto', 'پښتو'],
        ['sd', 'Sindhi', 'سنڌي'],
        ['ur', 'Urdu', 'اردو'],
        ['ckb', 'Central Kurdish', 'کوردی'],
        ['ku', 'Kurdish', 'Kurdî'],
        ['yi', 'Yiddish', 'ייִדיש'],
        ['jv', 'Javanese', 'Basa Jawa'],
        ['su', 'Sundanese', 'Basa Sunda'],
        ['en-us', 'English (United States)', 'English (United States)'],
        ['en-gb', 'English (United Kingdom)', 'English (United Kingdom)'],
        ['de-de', 'German (Germany)', 'Deutsch (Deutschland)'],
        ['de-at', 'German (Austria)', 'Deutsch (Österreich)'],
        ['de-ch', 'German (Switzerland)', 'Deutsch (Schweiz)'],
        ['fr-fr', 'French (France)', 'français (France)'],
        ['fr-ca', 'French (Canada)', 'français (Canada)'],
        ['es-es', 'Spanish (Spain)', 'español (España)'],
        ['es-mx', 'Spanish (Mexico)', 'español (México)'],
        ['it-it', 'Italian (Italy)', 'italiano (Italia)'],
        ['ru-ru', 'Russian (Russia)', 'русский (Россия)'],
        ['pl-pl', 'Polish (Poland)', 'polski (Polska)'],
        ['ja-jp', 'Japanese (Japan)', '日本語 (日本)'],
        ['ko-kr', 'Korean (South Korea)', '한국어 (대한민국)'],
        ['cs-cz', 'Czech (Czechia)', 'čeština (Česko)'],
        ['sk-sk', 'Slovak (Slovakia)', 'slovenčina (Slovensko)'],
        ['uk-ua', 'Ukrainian (Ukraine)', 'українська (Україна)'],
        ['da-dk', 'Danish (Denmark)', 'dansk (Danmark)'],
        ['fi-fi', 'Finnish (Finland)', 'suomi (Suomi)'],
        ['el-gr', 'Greek (Greece)', 'Ελληνικά (Ελλάδα)'],
        ['th-th', 'Thai (Thailand)', 'ไทย (ประเทศไทย)'],
        ['vi-vn', 'Vietnamese (Vietnam)', 'Tiếng Việt (Việt Nam)'],
        ['ro-ro', 'Romanian (Romania)', 'română (România)'],
        ['sl-si', 'Slovenian (Slovenia)', 'slovenščina (Slovenija)'],
        ['hr-hr', 'Croatian (Croatia)', 'hrvatski (Hrvatska)'],
        ['bg-bg', 'Bulgarian (Bulgaria)', 'български (България)'],
        ['lt-lt', 'Lithuanian (Lithuania)', 'lietuvių (Lietuva)'],
        ['lv-lv', 'Latvian (Latvia)', 'latviešu (Latvija)'],
        ['et-ee', 'Estonian (Estonia)', 'eesti (Eesti)'],
        ['ca-es', 'Catalan (Spain)', 'català (Espanya)'],
        ['gl-es', 'Galician (Spain)', 'galego (España)'],
        ['tl-ph', 'Tagalog (Philippines)', 'Tagalog (Pilipinas)'],
        ['ms-my', 'Malay (Malaysia)', 'Bahasa Melayu (Malaysia)'],
        ['ta-in', 'Tamil (India)', 'தமிழ் (இந்தியா)'],
        ['te-in', 'Telugu (India)', 'తెలుగు (భారతదేశం)'],
        ['mr-in', 'Marathi (India)', 'मराठी (भारत)'],
        ['bn-bd', 'Bengali (Bangladesh)', 'বাংলা (বাংলাদেশ)'],
        ['gu-in', 'Gujarati (India)', 'ગુજરાતી (ભારત)'],
        ['kn-in', 'Kannada (India)', 'ಕನ್ನಡ (ಭಾರತ)'],
        ['ml-in', 'Malayalam (India)', 'മലയാളം (ഇന്ത്യ)'],
        ['pa-in', 'Punjabi (India)', 'ਪੰਜਾਬੀ (ਭਾਰਤ)'],
        ['or-in', 'Odia (India)', 'ଓଡ଼ିଆ (ଭାରତ)'],
        ['as-in', 'Assamese (India)', 'অসমীয়া (ভাৰত)'],
        ['ne-np', 'Nepali (Nepal)', 'नेपाली (नेपाल)'],
        ['si-lk', 'Sinhala (Sri Lanka)', 'සිංහල (ශ්‍රී ලංකාව)'],
        ['lo-la', 'Lao (Laos)', 'ລາວ (ລາວ)'],
        ['km-kh', 'Khmer (Cambodia)', 'ខ្មែរ (កម្ពុជា)'],
        ['my-mm', 'Burmese (Myanmar)', 'မြန်မာ (မြန်မာ)'],
        ['ka-ge', 'Georgian (Georgia)', 'ქართული (საქართველო)'],
        ['hy-am', 'Armenian (Armenia)', 'հայերեն (Հայաստան)'],
        ['kk-kz', 'Kazakh (Kazakhstan)', 'қазақ тілі (Қазақстан)'],
        ['mn-mn', 'Mongolian (Mongolia)', 'монгол (Монгол)'],
        ['so-so', 'Somali (Somalia)', 'Soomaali (Soomaaliya)'],
        ['om-et', 'Oromo (Ethiopia)', 'Afaan Oromoo (Itoophiyaa)'],
        ['sn-zw', 'Shona (Zimbabwe)', 'chiShona (Zimbabwe)'],
        ['mg-mg', 'Malagasy (Madagascar)', 'Malagasy (Madagasikara)'],
        ['ny-mw', 'Chichewa (Malawi)', 'Chichewa (Malaŵi)'],
        ['br-fr', 'Breton (France)', 'brezhoneg (Frañs)'],
        ['cy-gb', 'Welsh (United Kingdom)', 'Cymraeg (Y Deyrnas Unedig)'],
        ['ga-ie', 'Irish (Ireland)', 'Gaeilge (Éire)'],
        ['gd-gb', 'Scottish Gaelic (United Kingdom)', 'Gàidhlig (An Rìoghachd Aonaichte)'],
        ['mt-mt', 'Maltese (Malta)', 'Malti (Malta)'],
        ['is-is', 'Icelandic (Iceland)', 'íslenska (Ísland)'],
        ['fo-fo', 'Faroese (Faroe Islands)', 'føroyskt (Føroyar)'],
        ['tk-tm', 'Turkmen (Turkmenistan)', 'Türkmençe (Türkmenistan)'],
        ['uz-uz', 'Uzbek (Uzbekistan)', 'oʻzbekcha (Oʻzbekiston)'],
        ['ky-kg', 'Kyrgyz (Kyrgyzstan)', 'кыргызча (Кыргызстан)'],
        ['tg-tj', 'Tajik (Tajikistan)', 'тоҷикӣ (Тоҷикистон)'],
        ['ps-af', 'Pashto (Afghanistan)', 'پښتو (افغانستان)'],
        ['sd-in', 'Sindhi (India)', 'سنڌي (انڊيا)'],
        ['ur-pk', 'Urdu (Pakistan)', 'اردو (پاکستان)'],
        ['ckb-iq', 'Central Kurdish (Iraq)', 'کوردی (عێراق)'],
        ['kmr-latn', 'Northern Kurdish (Latin)', 'Kurdî (Latînî)'],
        ['yi-001', 'Yiddish', 'ייִדיש'],
        ['jv-latn', 'Javanese (Latin)', 'Basa Jawa (Latin)'],
        ['su-latn', 'Sundanese (Latin)', 'Basa Sunda (Latin)'],
        ['ar-sa', 'Arabic (Saudi Arabia)', 'العربية (المملكة العربية السعودية)'],
        ['he-il', 'Hebrew (Israel)', 'עברית (ישראל)'],
        ['tr-tr', 'Turkish (Türkiye)', 'Türkçe (Türkiye)'],
        ['nl-nl', 'Dutch (Netherlands)', 'Nederlands (Nederland)'],
        ['sv-se', 'Swedish (Sweden)', 'svenska (Sverige)'],
        ['nb-no', 'Norwegian Bokmål (Norway)', 'norsk bokmål (Norge)'],
        ['eu', 'Basque', 'euskara'],
        ['sq', 'Albanian', 'shqip'],
        ['mk', 'Macedonian', 'македонски'],
        ['bs', 'Bosnian', 'bosanski'],
        ['me', 'Montenegrin', 'crnogorski'],
        ['be', 'Belarusian', 'беларуская'],
        ['la', 'Latin', 'Latina'],
        ['grc', 'Ancient Greek', 'Ἑλληνικά'],
        ['haw', 'Hawaiian', 'ʻŌlelo Hawaiʻi'],
        ['mi', 'Māori', 'te reo Māori'],
        ['sa', 'Sanskrit', 'संस्कृतम्'],
        ['bo', 'Tibetan', 'བོད་སྐད་'],
        ['ug', 'Uyghur', 'ئۇيغۇرچە'],
        ['dz', 'Dzongkha', 'རྫོང་ཁ'],
        ['nn-no', 'Norwegian Nynorsk (Norway)', 'nynorsk (Noreg)']
      ] as [string, string, string][]
    ).map(([k, e, n]) => [k, { english: e, native: n }] as const)
  ) as Record<string, { english: string; native: string }>

function intlEnglish(tag: string): string {
  try {
    return new Intl.DisplayNames('en', { type: 'language' }).of(tag.replace(/_/gu, '-')) ?? tag
  } catch {
    return tag
  }
}

function intlNative(tag: string): string {
  const bcp = tag.replace(/_/gu, '-')
  try {
    const v = new Intl.DisplayNames([bcp], { type: 'language' }).of(bcp)
    if (v) return v
    const loc = bcp.split('-')[0] ?? bcp
    return new Intl.DisplayNames([loc], { type: 'language' }).of(loc) ?? intlEnglish(tag)
  } catch {
    return intlEnglish(tag)
  }
}

function mapLookupKeys(normalizedLower: string): string[] {
  const keys: string[] = [normalizedLower]
  const base = normalizedLower.split(/-/u)[0] ?? normalizedLower
  if (base !== normalizedLower) keys.push(base)
  return keys
}

export type LanguageDisplayParts = {
  /** ISO / BCP47 / service tag shown in UI (normalized Libre style or LT tag). */
  codeLabel: string
  englishName: string
  nativeName: string
}

/**
 * @param tag LibreTranslate `code`, LanguageTool tag (e.g. `de-DE`), or UI locale (`en`).
 */
export function getLanguageDisplayParts(tag: string): LanguageDisplayParts {
  const raw = tag.trim()
  if (raw.toLowerCase() === 'auto') {
    return { codeLabel: 'auto', englishName: 'Detect language', nativeName: 'Detect language' }
  }
  const normalized = normalizeTranslateLangCode(raw)
  const lower = normalized.toLowerCase().replace(/_/gu, '-')
  const codeLabel = lower

  for (const k of mapLookupKeys(lower)) {
    const hit = LANGUAGE_TRIPLE_BY_LOWER_KEY[k]
    if (hit) {
      return { codeLabel, englishName: hit.english, nativeName: hit.native }
    }
  }

  return {
    codeLabel,
    englishName: intlEnglish(lower),
    nativeName: intlNative(lower)
  }
}

/** One line: `de — German — Deutsch` */
export function languageSelectSingleLine(tag: string): string {
  const p = getLanguageDisplayParts(tag)
  return `${p.codeLabel} — ${p.englishName} — ${p.nativeName}`
}
