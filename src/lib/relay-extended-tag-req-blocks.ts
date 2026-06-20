import type { Filter } from 'nostr-tools'

/** NIP-01 tag filters are `#` + tag name; keys like `#E` / `#A` / `#I` are uppercase variants. */
const CAPITAL_LEADING_TAG_FILTER_KEY = /^#[A-Z]/

function filterUsesCapitalLetterTagKey(f: Filter): boolean {
  for (const k of Object.keys(f as Record<string, unknown>)) {
    if (CAPITAL_LEADING_TAG_FILTER_KEY.test(k)) return true
  }
  return false
}

/**
 * True if any filter object includes a tag filter whose key starts with `#` and an uppercase ASCII letter
 * (e.g. `#E`, `#A`, `#I`). Some relays (notably relay.sovbit.host) reject those keys entirely.
 */
export function relayFiltersUseCapitalLetterTagKeys(filter: Filter | Filter[]): boolean {
  const filters = Array.isArray(filter) ? filter : [filter]
  return filters.some(filterUsesCapitalLetterTagKey)
}

