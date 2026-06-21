import {
  isHttpOrHttpsScheme,
  isLocalNetworkUrl,
  normalizeHttpRelayUrl,
  normalizeRelayUrlByScheme
} from '@/lib/url'
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

function pinRelaysInCap(
  capped: readonly string[],
  pinSources: readonly string[],
  maxRelays: number,
  isProtectedInStack: (normalizedUrl: string) => boolean
): string[] {
  if (pinSources.length === 0) return [...capped]

  const pinKeySet = new Set(pinSources.map((u) => relayDedupeKey(u)).filter(Boolean))
  const out = [...capped]
  const outKeys = new Set(out.map(relayDedupeKey))

  for (const raw of pinSources) {
    const n = normalizeRelayUrlByScheme(raw) || raw.trim()
    if (!n) continue
    const key = relayDedupeKey(n)
    if (outKeys.has(key)) continue

    while (out.length >= maxRelays) {
      let dropped = false
      for (let i = out.length - 1; i >= 0; i--) {
        const candidate = out[i]!
        const ck = relayDedupeKey(candidate)
        if (pinKeySet.has(ck) || isProtectedInStack(candidate)) continue
        out.splice(i, 1)
        outKeys.delete(ck)
        dropped = true
        break
      }
      if (!dropped) break
    }

    if (out.length >= maxRelays) continue
    out.push(n)
    outKeys.add(key)
    pinKeySet.add(key)
  }

  return out.slice(0, maxRelays)
}

function mailboxReadPinSources(sourceUrls: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw: string) => {
    const n = normalizeRelayUrlByScheme(raw) || raw.trim()
    if (!n) return
    const key = relayDedupeKey(n)
    if (seen.has(key)) return
    seen.add(key)
    out.push(n)
  }
  for (const raw of sourceUrls) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (isHttpOrHttpsScheme(trimmed)) {
      add(normalizeHttpRelayUrl(trimmed) || trimmed)
      continue
    }
    if (isLocalNetworkUrl(trimmed)) add(trimmed)
  }
  return out
}

/**
 * Keep viewer kind-10432 cache + kind-10243 HTTP read relays in a capped feed stack.
 * Favorites and NIP-65 WS inboxes otherwise fill the cap and drop mailbox layers.
 */
export function pinViewerMailboxReadRelaysInRelayCap(
  capped: readonly string[],
  sourceUrls: readonly string[],
  maxRelays: number
): string[] {
  const pinSources = mailboxReadPinSources(sourceUrls)
  if (pinSources.length === 0) return [...capped]

  const protectedKeys = new Set(pinSources.map((u) => relayDedupeKey(u)).filter(Boolean))

  return pinRelaysInCap(capped, pinSources, maxRelays, (candidate) => {
    const ck = relayDedupeKey(candidate)
    return (
      protectedKeys.has(ck) ||
      isHttpOrHttpsScheme(candidate.trim()) ||
      isLocalNetworkUrl(candidate)
    )
  })
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
  return pinViewerMailboxReadRelaysInRelayCap(capped, sourceUrls, maxRelays)
}

/**
 * Keep global mention / read aggregators in a capped stack (notifications `#p` REQs).
 * Long NIP-65 lists otherwise fill {@link FAUX_SPELL_MAX_RELAYS} before index relays are reached.
 */
export function pinMentionRelaysInRelayCap(
  capped: readonly string[],
  mentionSources: readonly string[],
  maxRelays: number,
  minPinned: number
): string[] {
  const pinKeys = new Set(
    mentionSources
      .slice(0, Math.max(0, minPinned))
      .map((u) => relayDedupeKey(u))
      .filter(Boolean)
  )
  if (pinKeys.size === 0) return [...capped]

  const mentionKeySet = new Set(mentionSources.map((u) => relayDedupeKey(u)).filter(Boolean))
  const out = [...capped]
  const outKeys = new Set(out.map(relayDedupeKey))

  for (const raw of mentionSources) {
    const key = relayDedupeKey(raw)
    if (!key || outKeys.has(key)) continue

    while (out.length >= maxRelays) {
      let dropped = false
      for (let i = out.length - 1; i >= 0; i--) {
        const candidate = out[i]!
        const ck = relayDedupeKey(candidate)
        if (pinKeys.has(ck) || mentionKeySet.has(ck)) continue
        out.splice(i, 1)
        outKeys.delete(ck)
        dropped = true
        break
      }
      if (!dropped) break
    }

    if (out.length >= maxRelays) continue
    out.push(raw)
    outKeys.add(key)
    pinKeys.add(key)
    if ([...pinKeys].every((k) => outKeys.has(k))) break
  }

  return out.slice(0, maxRelays)
}
