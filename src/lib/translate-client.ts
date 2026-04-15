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

export async function translatePlainText(
  text: string,
  targetLang: string,
  sourceLang: string = 'auto'
): Promise<string> {
  const base = TRANSLATE_URL.trim().replace(/\/$/u, '')
  if (!base) {
    throw new Error('Translation URL not configured')
  }
  const key = cacheKey(text, sourceLang, targetLang)
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
      source: sourceLang,
      target: targetLang,
      format: 'text'
    })
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    logger.warn('[Translate] HTTP error', { status: res.status, err: err.slice(0, 200) })
    throw new Error(`Translate: ${res.status}`)
  }
  const data = (await res.json()) as { translatedText?: string }
  const out = data.translatedText ?? ''
  pruneMemory()
  memoryCache.set(key, { text: out, at: Date.now() })
  return out
}
