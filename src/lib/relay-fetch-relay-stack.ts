import type { Filter } from 'nostr-tools'
import { publicReadRelayFallbackUrls } from '@/lib/viewer-relay-defaults'
import { relayFiltersUseCapitalLetterTagKeys } from '@/lib/relay-extended-tag-req-blocks'

/**
 * When filters use `#E`-style tag keys and the relay stack is empty, fall back to public read relays.
 * (Legacy per-relay stripping was removed; some relays still reject capital tag keys entirely.)
 */
export function applyCapitalLetterTagRelayFallback(
  relays: string[],
  filters: Filter | Filter[],
  online: boolean
): string[] {
  if (!relayFiltersUseCapitalLetterTagKeys(filters)) return relays
  if (relays.length === 0 && online) return [...publicReadRelayFallbackUrls()]
  return relays
}
