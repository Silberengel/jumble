import { SOCIAL_KIND_BLOCKED_RELAY_URLS, isSocialKindBlockedKind } from '@/constants'
import { filterRelaysForEventPublish } from '@/lib/relay-publish-filter'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { normalizeRelayUrlByScheme } from '@/lib/url'

function relayHostname(url: string): string | null {
  const normalized = normalizeRelayUrlByScheme(url) || url.trim()
  if (!normalized) return null
  try {
    return new URL(normalized).hostname.toLowerCase()
  } catch {
    return null
  }
}

const blockedExactKeys = new Set(
  SOCIAL_KIND_BLOCKED_RELAY_URLS.map((u) => (normalizeRelayUrlByScheme(u) || u).toLowerCase()).filter(Boolean)
)

const blockedHostnames = new Set(
  SOCIAL_KIND_BLOCKED_RELAY_URLS.map((u) => relayHostname(u)).filter((h): h is string => !!h)
)

/** True when `url` is (or is hosted on) a relay in {@link SOCIAL_KIND_BLOCKED_RELAY_URLS}. */
export function isSocialKindBlockedRelayUrl(url: string): boolean {
  const key = (normalizeRelayUrlByScheme(url) || url.trim()).toLowerCase()
  if (!key) return false
  if (blockedExactKeys.has(key)) return true
  const host = relayHostname(url)
  return host != null && blockedHostnames.has(host)
}

/** Strip social-kind-blocked relays for kinds in {@link isSocialKindBlockedKind}. */
export function filterRelayUrlsForSocialKindPublish(
  urls: readonly string[],
  eventKind: number
): string[] {
  if (!isSocialKindBlockedKind(eventKind)) return [...urls]
  return urls.filter((url) => !isSocialKindBlockedRelayUrl(url))
}

/** Read-only / profile-index filter + social-kind-blocked strip + dedupe (publish stack). */
export function filterPublishingRelayUrls(urls: readonly string[], eventKind: number): string[] {
  return dedupeNormalizeRelayUrlsOrdered(
    filterRelayUrlsForSocialKindPublish(filterRelaysForEventPublish(urls, eventKind), eventKind)
  )
}
