import {
  BOOKSTR_RELAY_URLS,
  DOCUMENT_RELAY_URLS,
  FAST_READ_RELAY_URLS,
  NIP66_DISCOVERY_RELAY_URLS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import { mergeRelayUrlLayers } from '@/lib/favorites-feed-relays'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'
import nip66Service from '@/services/nip66.service'

/** Cap NIP-66 “supports search” relays so we do not open hundreds of sockets. */
const CITATION_SEARCH_NIP66_NIP50_CAP = 42

/** Final cap after merge (priority = earlier layers in {@link mergeRelayUrlLayers}). */
const CITATION_SEARCH_MAX_RELAYS = 56

function normList(urls: readonly string[]): string[] {
  return urls.map((u) => normalizeUrl(u) || u.trim()).filter(Boolean)
}

/**
 * Relay stack for NIP-32 citation (kinds 30–33) NIP-50 search: user NIP-65 / favorites / local / profile,
 * static searchable + document + discovery pools, NIP-66 search-capable relays, then fast read.
 */
export async function buildCitationPickerSearchRelayUrls(): Promise<string[]> {
  const viewer = client.pubkey?.trim() || undefined

  let userCentric: string[] = []
  try {
    userCentric = await buildComprehensiveRelayList({
      userPubkey: viewer,
      includeUserOwnRelays: !!viewer,
      includeProfileFetchRelays: true,
      includeFastReadRelays: true,
      includeFastWriteRelays: true,
      includeSearchableRelays: true,
      includeLocalRelays: !!viewer,
      includeFavoriteRelays: !!viewer
    })
  } catch {
    /* continue with static layers */
  }

  const nip66Search = nip66Service
    .getSearchableRelayUrls()
    .map((u) => normalizeUrl(u) || u.trim())
    .filter(Boolean)
    .slice(0, CITATION_SEARCH_NIP66_NIP50_CAP)

  const merged = mergeRelayUrlLayers(
    [
      userCentric,
      normList(SEARCHABLE_RELAY_URLS),
      normList(DOCUMENT_RELAY_URLS),
      normList(NIP66_DISCOVERY_RELAY_URLS),
      normList(BOOKSTR_RELAY_URLS),
      nip66Search,
      normList(FAST_READ_RELAY_URLS)
    ],
    []
  )

  return sanitizeRelayUrlsForFetch(merged).slice(0, CITATION_SEARCH_MAX_RELAYS)
}
