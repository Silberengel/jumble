import { isLocalNetworkUrl, normalizeAnyRelayUrl } from '@/lib/url'

function relayHostname(url: string): string | null {
  const normalized = normalizeAnyRelayUrl(url) || url.trim()
  if (!normalized) return null
  try {
    return new URL(normalized).hostname.toLowerCase()
  } catch {
    return null
  }
}

function relayMatchesEntry(url: string, entry: string): boolean {
  const normalized = normalizeAnyRelayUrl(url) || url.trim()
  if (!normalized) return false
  const entryNorm = normalizeAnyRelayUrl(entry) || entry.trim()
  if (!entryNorm) return false
  if (entryNorm === normalized) return true
  const host = relayHostname(normalized)
  return Boolean(host && relayHostname(entryNorm) === host)
}

/** True when the relay matches an allowlist URL or shares its hostname (https vs wss). */
export function isRelayInUserAllowlist(url: string, allowlist?: readonly string[]): boolean {
  if (!allowlist?.length) return false
  return allowlist.some((entry) => relayMatchesEntry(url, entry))
}

export function filterRelaysToUserAllowlist(
  urls: readonly string[],
  allowlist?: readonly string[]
): string[] {
  if (!allowlist?.length) return [...urls]
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const n = normalizeAnyRelayUrl(raw) || raw.trim()
    if (!n || !isRelayInUserAllowlist(n, allowlist)) continue
    const k = n.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out
}

export type EventSeenOnAllowlistOptions = {
  /**
   * Single-relay explore: hide rows with no recorded delivery relay (session / archive cache)
   * instead of treating unknown provenance as a match.
   */
  strictUnknownSeenOn?: boolean
}

/**
 * When the session has recorded delivery relays, require at least one on the allowlist.
 * By default empty seen-on (e.g. fresh live REQ row) is treated as allowed.
 */
export function eventSeenOnMatchesAllowlist(
  seenRelayUrls: readonly string[],
  allowlist: readonly string[],
  options?: EventSeenOnAllowlistOptions
): boolean {
  if (!allowlist.length) return true
  if (seenRelayUrls.length === 0) return !options?.strictUnknownSeenOn
  return seenRelayUrls.some((u) => isRelayInUserAllowlist(u, allowlist))
}

/** Keep only events delivered by a relay on `allowlist` (strict: no seen-on → drop). */
export function filterEventsToStrictRelayAllowlist<T extends { id: string }>(
  events: readonly T[],
  allowlist: readonly string[],
  getSeenOn: (eventId: string) => readonly string[]
): T[] {
  if (!allowlist.length) return [...events]
  if (allowlist.some((u) => isLocalNetworkUrl(u))) return [...events]
  return events.filter((e) =>
    eventSeenOnMatchesAllowlist(getSeenOn(e.id), allowlist, { strictUnknownSeenOn: true })
  )
}
