import { normalizeHttpRelayUrl, normalizeRelayUrlByScheme, isHttpOrHttpsScheme } from '@/lib/url'
import type { TFeedSubRequest } from '@/types'

function relayDedupeKey(url: string): string {
  return (normalizeRelayUrlByScheme(url) || url.trim()).toLowerCase()
}

/** Deduped relay URLs from all timeline subrequests (REQ order preserved). */
export function uniqueRelayUrlsFromSubRequests(requests: readonly TFeedSubRequest[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const req of requests) {
    for (const raw of req.urls) {
      const n = normalizeRelayUrlByScheme(raw) || raw.trim()
      if (!n) continue
      const key = relayDedupeKey(n)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(n)
    }
  }
  return out
}

/**
 * Keep viewer kind-10243 HTTP index relays in a capped feed stack (they are easy to drop when
 * favorites + NIP-65 WS fill {@link FAUX_SPELL_MAX_RELAYS}).
 */
export function pinHttpIndexRelaysInRelayCap(
  capped: readonly string[],
  sourceUrls: readonly string[],
  maxRelays: number
): string[] {
  const httpSources = sourceUrls
    .map((u) => normalizeHttpRelayUrl(u) || (isHttpOrHttpsScheme(u.trim()) ? u.trim() : ''))
    .filter(Boolean)
  if (httpSources.length === 0) return [...capped]

  const httpKeySet = new Set(httpSources.map((u) => u.toLowerCase()))
  const out = [...capped]
  const outKeys = new Set(out.map(relayDedupeKey))

  for (const http of httpSources) {
    const key = http.toLowerCase()
    if (outKeys.has(key)) continue

    while (out.length >= maxRelays) {
      let dropped = false
      for (let i = out.length - 1; i >= 0; i--) {
        const candidate = out[i]!
        const ck = relayDedupeKey(candidate)
        if (httpKeySet.has(ck) || isHttpOrHttpsScheme(candidate.trim())) continue
        out.splice(i, 1)
        outKeys.delete(ck)
        dropped = true
        break
      }
      if (!dropped) break
    }

    if (out.length >= maxRelays) continue
    out.push(http)
    outKeys.add(key)
  }

  return out.slice(0, maxRelays)
}
