import {
  BOOKSTR_RELAY_URLS,
  DOCUMENT_RELAY_URLS,
  FAST_READ_RELAY_URLS,
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

/**
 * Curated stacks allowed to connect briefly under metadata-only policy when merged into an active
 * query/subscribe (documents, GIFs, profiles, …). Excludes FAST_READ, search indexers, and read-only mirrors.
 */
const METADATA_POLICY_OPERATION_SCOPED_RELAY_LISTS: readonly (readonly string[])[] = [
  PROFILE_RELAY_URLS,
  DOCUMENT_RELAY_URLS,
  GIF_RELAY_URLS,
  BOOKSTR_RELAY_URLS,
  FOLLOWS_HISTORY_RELAY_URLS
]

let curatedRelayKeySet: ReadonlySet<string> | null = null
let operationScopedRelayKeySet: ReadonlySet<string> | null = null

function relayKeyForCuratedSet(url: string): string {
  return (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
}

/** Relays grantable for the duration of an active read query/subscribe (not general feed widening). */
const METADATA_POLICY_ACTIVE_READ_GRANT_RELAY_LISTS: readonly (readonly string[])[] = [
  ...METADATA_POLICY_OPERATION_SCOPED_RELAY_LISTS,
  FAST_READ_RELAY_URLS,
  SEARCHABLE_RELAY_URLS,
  READ_ONLY_RELAY_URLS,
  NIP66_DISCOVERY_RELAY_URLS
]

let activeReadGrantRelayKeySet: ReadonlySet<string> | null = null

function getActiveReadGrantRelayKeySet(): ReadonlySet<string> {
  if (!activeReadGrantRelayKeySet) {
    const out = new Set<string>()
    for (const list of METADATA_POLICY_ACTIVE_READ_GRANT_RELAY_LISTS) {
      for (const u of list) {
        const key = relayKeyForCuratedSet(u)
        if (key) out.add(key)
      }
    }
    activeReadGrantRelayKeySet = out
  }
  return activeReadGrantRelayKeySet
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

function getOperationScopedRelayKeySet(): ReadonlySet<string> {
  if (!operationScopedRelayKeySet) {
    const out = new Set<string>()
    for (const list of METADATA_POLICY_OPERATION_SCOPED_RELAY_LISTS) {
      for (const u of list) {
        const key = relayKeyForCuratedSet(u)
        if (key) out.add(key)
      }
    }
    operationScopedRelayKeySet = out
  }
  return operationScopedRelayKeySet
}

/** True for relays from specialized constants (profile fetch, read-only indexers, NIP-50, …). */
export function isMetadataPolicyCuratedRelay(url: string): boolean {
  const key = relayKeyForCuratedSet(url)
  return key.length > 0 && getCuratedRelayKeySet().has(key)
}

/** Purpose-specific constants that may connect during an in-flight read (not general feed widening). */
export function isMetadataPolicyOperationScopedRelay(url: string): boolean {
  const key = relayKeyForCuratedSet(url)
  return key.length > 0 && getOperationScopedRelayKeySet().has(key)
}

/** Search / index / discovery stacks allowed only while an active read operation lists them. */
export function isMetadataPolicyActiveReadGrantRelay(url: string): boolean {
  const key = relayKeyForCuratedSet(url)
  return key.length > 0 && getActiveReadGrantRelayKeySet().has(key)
}

let profileRelayKeySet: ReadonlySet<string> | null = null

function getProfileRelayKeySet(): ReadonlySet<string> {
  if (!profileRelayKeySet) {
    const out = new Set<string>()
    for (const u of PROFILE_RELAY_URLS) {
      const key = relayKeyForCuratedSet(u)
      if (key) out.add(key)
    }
    profileRelayKeySet = out
  }
  return profileRelayKeySet
}

/** {@link PROFILE_RELAY_URLS} — kind-0 / profile hydration mirrors allowed under metadata-only reads. */
export function isMetadataPolicyProfileRelay(url: string): boolean {
  const key = relayKeyForCuratedSet(url)
  return key.length > 0 && getProfileRelayKeySet().has(key)
}

/** For tests: reset lazy-built key set after constant changes. */
export function resetMetadataPolicyCuratedRelayKeysForTests(): void {
  curatedRelayKeySet = null
  operationScopedRelayKeySet = null
  activeReadGrantRelayKeySet = null
  profileRelayKeySet = null
}
