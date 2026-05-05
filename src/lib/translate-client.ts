import { TRANSLATE_URL } from '@/constants'
import { electronAwareFetch } from '@/lib/electron-aware-fetch'
import logger from '@/lib/logger'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

const memoryCache = new Map<string, { text: string; at: number }>()
const MAX_MEMORY = 80
const CACHE_TTL_MS = 1000 * 60 * 60 * 24

function cacheKey(source: string, sourceLang: string, targetLang: string): string {
  const h = bytesToHex(sha256(new TextEncoder().encode(`${sourceLang}|${targetLang}|${source}`)))
  return h
}

function pruneMemory(): void {
  const now = Date.now()
  for (const [k, v] of memoryCache) {
    if (now - v.at > CACHE_TTL_MS) memoryCache.delete(k)
  }
  while (memoryCache.size > MAX_MEMORY) {
    const first = memoryCache.keys().next().value
    if (first) memoryCache.delete(first)
    else break
  }
}

export function isTranslateConfigured(): boolean {
  return Boolean(TRANSLATE_URL.trim())
}

/** LibreTranslate uses ISO 639-1; map a few common mistypes (defence in depth). */
const LANG_ALIASES: Record<string, string> = {
  sp: 'es',
  ger: 'de',
  eng: 'en',
  fra: 'fr',
  ita: 'it',
  por: 'pt',
  // LibreTranslate/Argos use Bokmål code `nb`; ISO 639-1 `no` is not in the model index.
  no: 'nb'
}

export function normalizeTranslateLangCode(code: string): string {
  const t = code.trim().toLowerCase()
  return (LANG_ALIASES[t] ?? code.trim()) || 'en'
}

/**
 * LibreTranslate/Argos only registers `en` — regional English codes are for grammar (LanguageTool)
 * and read-aloud; the translate API still expects `en`.
 */
export function translateApiLanguageCode(code: string): string {
  const n = normalizeTranslateLangCode(code).toLowerCase().replace(/_/gu, '-')
  if (n === 'en-gb' || n === 'en-us') return 'en'
  return normalizeTranslateLangCode(code)
}

export type TranslateLanguageOption = { code: string; name: string }

function advertisedApiCodeKey(code: string): string {
  return translateApiLanguageCode(code).trim().toLowerCase().replace(/_/gu, '-')
}

/** Codes last returned by GET `/languages` (API form, e.g. `en` for `en-gb`). Empty fetch clears this. */
let advertisedTranslateApiCodes: Set<string> | null = null

function recordAdvertisedTranslateCodesFromServer(list: readonly TranslateLanguageOption[]): void {
  if (list.length === 0) {
    advertisedTranslateApiCodes = null
    return
  }
  advertisedTranslateApiCodes = new Set(list.map((o) => advertisedApiCodeKey(o.code)))
}

/**
 * True if we have not yet seen a successful `/languages` response, or the server advertises the
 * Libre `target` we would send for this logical menu code.
 */
export function translateServerSupportsLogicalTarget(targetCode: string): boolean {
  if (!advertisedTranslateApiCodes) return true
  return advertisedTranslateApiCodes.has(advertisedApiCodeKey(targetCode))
}

let languagesCache: { list: TranslateLanguageOption[]; at: number; fromFailure?: boolean } | null = null
const LANGUAGES_CACHE_TTL_MS = 60_000
/** After HTTP/parse failure, cache empty so each {@link useMenuActions} mount does not re-request. */
const LANGUAGES_FAILURE_CACHE_TTL_MS = 120_000

let languagesFetchInFlight: Promise<TranslateLanguageOption[]> | null = null
let lastLanguagesFailureLogAt = 0

function parseLanguagesResponse(data: unknown): TranslateLanguageOption[] {
  if (!Array.isArray(data)) return []
  const out: TranslateLanguageOption[] = []
  for (const row of data) {
    if (typeof row === 'string') {
      out.push({ code: row, name: row })
    } else if (row && typeof row === 'object' && 'code' in row) {
      const r = row as { code: unknown; name?: unknown }
      const code = String(r.code)
      const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : code
      out.push({ code, name })
    }
  }
  const seen = new Set<string>()
  const dedup = out.filter((o) => {
    if (seen.has(o.code)) return false
    seen.add(o.code)
    return true
  })
  dedup.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return dedup
}

/** GET `/languages` on the configured translate base (same-origin `/api/translate` in dev). */
export async function fetchTranslateLanguages(): Promise<TranslateLanguageOption[]> {
  const base = TRANSLATE_URL.trim().replace(/\/$/u, '')
  if (!base) return []
  const now = Date.now()
  if (languagesCache) {
    const ttl = languagesCache.fromFailure ? LANGUAGES_FAILURE_CACHE_TTL_MS : LANGUAGES_CACHE_TTL_MS
    if (now - languagesCache.at < ttl) {
      recordAdvertisedTranslateCodesFromServer(languagesCache.list)
      return languagesCache.list
    }
  }
  if (languagesFetchInFlight) {
    return languagesFetchInFlight
  }

  const url = `${base}/languages`
  languagesFetchInFlight = (async (): Promise<TranslateLanguageOption[]> => {
    const res = await electronAwareFetch(url)
    if (!res.ok) {
      const t = Date.now()
      if (t - lastLanguagesFailureLogAt > 10_000) {
        lastLanguagesFailureLogAt = t
        logger.warn('[Translate] /languages failed', { status: res.status })
      }
      languagesCache = { list: [], at: t, fromFailure: true }
      recordAdvertisedTranslateCodesFromServer([])
      return []
    }
    try {
      const data = (await res.json()) as unknown
      const list = parseLanguagesResponse(data)
      languagesCache = { list, at: Date.now() }
      recordAdvertisedTranslateCodesFromServer(list)
      return list
    } catch (e) {
      const t = Date.now()
      if (t - lastLanguagesFailureLogAt > 10_000) {
        lastLanguagesFailureLogAt = t
        logger.warn('[Translate] /languages parse error', { e })
      }
      languagesCache = { list: [], at: t, fromFailure: true }
      recordAdvertisedTranslateCodesFromServer([])
      return []
    }
  })().finally(() => {
    languagesFetchInFlight = null
  })

  return languagesFetchInFlight
}

export function clearTranslateLanguagesCache(): void {
  languagesCache = null
  advertisedTranslateApiCodes = null
}

/**
 * LibreTranslate / Argos often corrupts hashtag-only lines (random glyphs, subtitle-like junk,
 * dropped letters). Nostr-style hashtags must stay verbatim.
 */
export function shouldSkipMachineTranslatePlainCore(core: string): boolean {
  return /^(?:#[\p{L}\p{N}\p{M}_-]+(?:\s+#[\p{L}\p{N}\p{M}_-]+)*)\s*$/u.test(core.trim())
}

export async function translatePlainText(
  text: string,
  targetLang: string,
  sourceLang: string = 'auto'
): Promise<string> {
  const base = TRANSLATE_URL.trim().replace(/\/$/u, '')
  if (!base) {
    throw new Error('Translation URL not configured')
  }

  /** LibreTranslate often trims `q` / `translatedText`; keep edge whitespace so markup segments still join cleanly. */
  const leadingWs = text.match(/^\s*/u)?.[0] ?? ''
  const trailingWs = text.match(/\s*$/u)?.[0] ?? ''
  const core = text.slice(leadingWs.length, text.length - trailingWs.length)
  if (core === '') {
    return text
  }

  if (shouldSkipMachineTranslatePlainCore(core)) {
    return text
  }

  const resolvedTarget = translateApiLanguageCode(targetLang)
  const resolvedSource =
    sourceLang === 'auto' ? 'auto' : translateApiLanguageCode(sourceLang)

  if (!translateServerSupportsLogicalTarget(targetLang)) {
    const want = advertisedApiCodeKey(targetLang)
    throw new Error(
      `This translate server does not offer machine translation for “${want}” (that code is not in GET /languages). ` +
        'You can still use grammar check and read-aloud on text that is already in that language.'
    )
  }
  if (resolvedSource !== 'auto' && !translateServerSupportsLogicalTarget(sourceLang)) {
    const want = advertisedApiCodeKey(sourceLang)
    throw new Error(
      `This translate server does not offer “${want}” as a source language (not in /languages). Pick another source or use “Detect automatically”.`
    )
  }

  const key = cacheKey(core, resolvedSource, resolvedTarget)
  const hit = memoryCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    logger.info('[AdvancedLab] translate', {
      source: resolvedSource,
      target: resolvedTarget,
      inputChars: text.length,
      outputChars: hit.text.length + leadingWs.length + trailingWs.length,
      cacheHit: true
    })
    return leadingWs + hit.text + trailingWs
  }

  const url = `${base}/translate`
  const res = await electronAwareFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: core,
      source: resolvedSource,
      target: resolvedTarget,
      format: 'text'
    })
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    logger.warn('[Translate] HTTP error', { status: res.status, err: err.slice(0, 200) })
    const detail = err.replace(/\s+/gu, ' ').trim().slice(0, 160)
    throw new Error(
      detail ? `Translate: ${res.status} — ${detail}` : `Translate: ${res.status}`
    )
  }
  const data = (await res.json()) as { translatedText?: string }
  const outCore = data.translatedText ?? ''
  pruneMemory()
  memoryCache.set(key, { text: outCore, at: Date.now() })
  logger.info('[AdvancedLab] translate', {
    source: resolvedSource,
    target: resolvedTarget,
    inputChars: text.length,
    outputChars: leadingWs.length + outCore.length + trailingWs.length,
    cacheHit: false
  })
  return leadingWs + outCore + trailingWs
}
