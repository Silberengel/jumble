import { TRANSLATE_URL } from '@/constants'
import { electronAwareFetch } from '@/lib/electron-aware-fetch'
import logger from '@/lib/logger'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

const memoryCache = new Map<string, { text: string; at: number }>()
const MAX_MEMORY = 80
const CACHE_TTL_MS = 1000 * 60 * 60 * 24

/** After `/languages` or `/translate` hits 502/503/504, skip further translate HTTP this tab (optional dev proxy). */
let translateBackendGoneThisSession = false

const TRANSLATE_UNAVAILABLE_MESSAGE =
  'Translation service is unavailable. With npm run dev, optional services (/api/translate, /api/languagetool, /sites, …) are proxied to jumble.imwald.eu by default; use npm run dev:all for local sidecars.'

function throwTranslateUnavailable(): never {
  throw new Error(TRANSLATE_UNAVAILABLE_MESSAGE)
}

const translateOptionalLoggedKeys = new Set<string>()

function translateDevLogOnce(key: string, message: string, payload?: Record<string, unknown>): void {
  if (translateOptionalLoggedKeys.has(key)) return
  translateOptionalLoggedKeys.add(key)
  if (import.meta.env.DEV) {
    logger.debug(message, payload)
  }
}

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

export function isTranslateBackendUnreachableThisSession(): boolean {
  return translateBackendGoneThisSession
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
/** After HTTP/parse failure, avoid hammering a broken `/api/translate` proxy (dev 500s); 2m was still noisy with many remounts. */
const LANGUAGES_FAILURE_CACHE_TTL_MS = 86_400_000

let languagesFetchInFlight: Promise<TranslateLanguageOption[]> | null = null
let lastLanguagesFailureLogAt = 0

/**
 * Dedupes `/languages` across the whole app while a fetch is in flight. Cleared in `finally` so later
 * mounts hit {@link fetchTranslateLanguages} again and get the memory cache without holding a stale Promise.
 */
let warmTranslateLanguagesPromise: Promise<TranslateLanguageOption[]> | null = null

/** One shared `/languages` request per flight; safe to call from every note’s menu hook. */
export function warmTranslateLanguagesOnce(): Promise<TranslateLanguageOption[]> {
  if (!TRANSLATE_URL.trim()) return Promise.resolve([])
  if (warmTranslateLanguagesPromise) return warmTranslateLanguagesPromise
  const p = fetchTranslateLanguages()
  warmTranslateLanguagesPromise = p
  void p.finally(() => {
    warmTranslateLanguagesPromise = null
  })
  return p
}

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
  if (translateBackendGoneThisSession) {
    translateDevLogOnce(
      'languages-skip',
      '[Translate] /languages skipped — optional translate backend unavailable this session.'
    )
    recordAdvertisedTranslateCodesFromServer(languagesCache?.list ?? [])
    return languagesCache?.list ?? []
  }
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
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        translateBackendGoneThisSession = true
        translateDevLogOnce('languages-fail', '[Translate] Optional translate proxy offline (502/503/504); skipping further translate HTTP this session.', {
          status: res.status
        })
      } else if (t - lastLanguagesFailureLogAt > 10_000) {
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
      translateBackendGoneThisSession = false
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
  warmTranslateLanguagesPromise = null
  translateBackendGoneThisSession = false
  translateOptionalLoggedKeys.clear()
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
  if (translateBackendGoneThisSession) {
    translateDevLogOnce(
      'translate-post-skip',
      '[Translate] Skipping translate POST — optional backend unavailable this session.'
    )
    throwTranslateUnavailable()
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
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      translateBackendGoneThisSession = true
      translateDevLogOnce('translate-post-fail', '[Translate] Optional translate proxy offline; skipping further translate HTTP this session.', {
        status: res.status
      })
      throwTranslateUnavailable()
    }
    const err = await res.text().catch(() => '')
    logger.warn('[Translate] HTTP error', { status: res.status, err: err.slice(0, 200) })
    const detail = err.replace(/\s+/gu, ' ').trim().slice(0, 160)
    throw new Error(
      detail ? `Translate: ${res.status} — ${detail}` : `Translate: ${res.status}`
    )
  }
  const data = (await res.json()) as { translatedText?: string }
  const outCore = data.translatedText ?? ''
  translateBackendGoneThisSession = false
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
