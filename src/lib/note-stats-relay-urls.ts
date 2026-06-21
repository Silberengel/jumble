import { SEARCHABLE_RELAY_URLS } from '@/constants'
import { appendMoneroNostrRelays } from '@/lib/monero-nostr-relays'
import { prependAggrNostrLandIfViewerEligible } from '@/lib/nostr-land-relay-eligibility'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { nip66Service } from '@/services/nip66.service'

/** Search/index relays + aggr.nostr.land when the viewer lists nostr.land (see {@link prependAggrNostrLandIfViewerEligible}). */
export function buildNoteStatsRelayUrls(): string[] {
  const base = dedupeNormalizeRelayUrlsOrdered([
    ...SEARCHABLE_RELAY_URLS,
    ...nip66Service.getSearchableRelayUrls()
  ])
  return prependAggrNostrLandIfViewerEligible(
    appendMoneroNostrRelays(sanitizeRelayUrlsForFetch(base))
  )
}
