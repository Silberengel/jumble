import {
  BOOKSTR_RELAY_URLS,
  DOCUMENT_RELAY_URLS,
  FOLLOWS_HISTORY_RELAY_URLS,
  GIF_RELAY_URLS,
  NIP42_POOL_AUTOMATIC_AUTH_RELAY_URLS,
  NIP66_DISCOVERY_RELAY_URLS,
  PROFILE_RELAY_URLS,
  READ_ONLY_RELAY_URLS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import { normalizeAnyRelayUrl } from '@/lib/url'

/** App-defined relay stacks (metadata, search, documents, …) — not ad-hoc FAST_READ widening. */
const METADATA_POLICY_CURATED_RELAY_LISTS: readonly (readonly string[])[] = [
  PROFILE_RELAY_URLS,
  READ_ONLY_RELAY_URLS,
  SEARCHABLE_RELAY_URLS,
  DOCUMENT_RELAY_URLS,
  GIF_RELAY_URLS,
  BOOKSTR_RELAY_URLS,
  NIP66_DISCOVERY_RELAY_URLS,
  FOLLOWS_HISTORY_RELAY_URLS,
  NIP42_POOL_AUTOMATIC_AUTH_RELAY_URLS
]

let curatedRelayKeySet: ReadonlySet<string> | null = null

function relayKeyForCuratedSet(url: string): string {
  return (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
}

function getCuratedRelayKeySet(): ReadonlySet<string> {
  if (!curatedRelayKeySet) {
    const out = new Set<string>()
    for (const list of METADATA_POLICY_CURATED_RELAY_LISTS) {
      for (const u of list) {
        const key = relayKeyForCuratedSet(u)
        if (key) out.add(key)
      }
    }
    curatedRelayKeySet = out
  }
  return curatedRelayKeySet
}

/** True for relays from specialized constants (profile fetch, read-only indexers, NIP-50, …). */
export function isMetadataPolicyCuratedRelay(url: string): boolean {
  const key = relayKeyForCuratedSet(url)
  return key.length > 0 && getCuratedRelayKeySet().has(key)
}

/** For tests: reset lazy-built key set after constant changes. */
export function resetMetadataPolicyCuratedRelayKeysForTests(): void {
  curatedRelayKeySet = null
}
