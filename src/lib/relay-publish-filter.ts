import {
  AUTHOR_PROFILE_VIEW_REPLACEABLE_KINDS,
  READ_ONLY_RELAY_URLS
} from '@/constants'
import { normalizeAnyRelayUrl } from '@/lib/url'

/**
 * Profile mirrors and indexers that reject notes, reactions, and other social kinds.
 * Distinct from {@link READ_ONLY_RELAY_URLS} (search/index aggregators) and
 * {@link SOCIAL_KIND_BLOCKED_RELAY_URLS} (subset also listed here for kind 1 / 1111 / 11).
 */
export const PROFILE_INDEX_ONLY_RELAY_URLS = [
  'wss://profiles.nostr1.com',
  'wss://purplepag.es',
  'wss://profiles.nostrver.se/',
  'wss://indexer.coracle.social/'
] as const

const profileIndexOnlyKeySet = new Set(
  PROFILE_INDEX_ONLY_RELAY_URLS.map((u) => (normalizeAnyRelayUrl(u) || u).toLowerCase()).filter(Boolean)
)

const readOnlyKeySet = new Set(
  READ_ONLY_RELAY_URLS.map((u) => (normalizeAnyRelayUrl(u) || u).toLowerCase()).filter(Boolean)
)

const profileIndexPublishKindSet = new Set<number>(AUTHOR_PROFILE_VIEW_REPLACEABLE_KINDS)

function relayKey(url: string): string {
  return (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
}

export function isProfileIndexOnlyRelay(url: string): boolean {
  const key = relayKey(url)
  return key.length > 0 && profileIndexOnlyKeySet.has(key)
}

export function isReadOnlyRelayUrl(url: string): boolean {
  const key = relayKey(url)
  return key.length > 0 && readOnlyKeySet.has(key)
}

/** True when this relay may receive an EVENT for `eventKind` (profile/list replaceables only on profile mirrors). */
export function relayAllowsPublishKind(url: string, eventKind: number): boolean {
  if (!isProfileIndexOnlyRelay(url)) return true
  return profileIndexPublishKindSet.has(eventKind)
}

export function filterRelaysForEventPublish(urls: readonly string[], eventKind: number): string[] {
  return urls.filter((u) => relayAllowsPublishKind(u, eventKind) && !isReadOnlyRelayUrl(u))
}

/**
 * Relay refused the EVENT due to kind / content policy (not connectivity).
 * These are expected when publishing to specialty relays — do not session-strike the relay.
 */
export function isRelayPublishPolicyRejection(message: string): boolean {
  const m = message.trim().toLowerCase()
  if (!m) return false
  if (/\bkind\s*[:\s]?\s*\d+\b/.test(m) && /(accept|accepted|only|not supported|unsupported|reject|refused|allow|allowed|permitted)/.test(m)) {
    return true
  }
  if (/only .{0,120} (accept|accepted|allowed|permitted)/.test(m)) return true
  if (/(does not|don't|do not) accept/.test(m)) return true
  if (/not accepted on this relay/.test(m)) return true
  if (/wrong kind/.test(m)) return true
  if (/unsupported kind/.test(m)) return true
  if (/kind not (supported|allowed|permitted)/.test(m)) return true
  if (/event kind (blocked|not allowed|rejected)/.test(m)) return true
  if (/this relay only accepts/.test(m)) return true
  return false
}

/**
 * Reply/mention author **read** hints used as publish targets: never LAN/Tor, read-only aggregators,
 * or profile/index mirrors (those are not inboxes for notes or reactions).
 */
export function filterContextAuthorReadRelaysForPublish(urls: readonly string[]): string[] {
  return urls.filter((u) => {
    const key = relayKey(u)
    if (!key) return false
    if (isReadOnlyRelayUrl(u)) return false
    if (isProfileIndexOnlyRelay(u)) return false
    return true
  })
}
