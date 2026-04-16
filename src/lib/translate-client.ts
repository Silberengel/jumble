import { TRANSLATE_URL } from '@/constants'
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

export type TranslateLanguageOption = { code: string; name: string }

let languagesCache: { list: TranslateLanguageOption[]; at: number } | null = null
const LANGUAGES_CACHE_TTL_MS = 60_000

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
  if (languagesCache && now - languagesCache.at < LANGUAGES_CACHE_TTL_MS) {
    return languagesCache.list
  }
  const url = `${base}/languages`
  const res = await fetch(url)
  if (!res.ok) {
    logger.warn('[Translate] /languages failed', { status: res.status })
    languagesCache = null
    return []
  }
  try {
    const data = (await res.json()) as unknown
    const list = parseLanguagesResponse(data)
    languagesCache = { list, at: now }
    return list
  } catch (e) {
    logger.warn('[Translate] /languages parse error', { e })
    languagesCache = null
    return []
  }
}

export function clearTranslateLanguagesCache(): void {
  languagesCache = null
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
  const resolvedTarget = normalizeTranslateLangCode(targetLang)
  const resolvedSource =
    sourceLang === 'auto' ? 'auto' : normalizeTranslateLangCode(sourceLang)
  const key = cacheKey(text, resolvedSource, resolvedTarget)
  const hit = memoryCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.text
  }

  const url = `${base}/translate`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
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
  const out = data.translatedText ?? ''
  pruneMemory()
  memoryCache.set(key, { text: out, at: Date.now() })
  return out
}
