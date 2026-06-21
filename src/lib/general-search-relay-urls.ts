import { userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { getAggrAwareSearchRelayUrls } from '@/lib/nostr-land-relay-eligibility'
import { normalizeUrl } from '@/lib/url'
import type { TRelayList } from '@/types'

/** User inbox/outbox + favorites + aggr-aware searchable relays for general text search on relays. */
export function buildGeneralSearchRelayUrls(options: {
  relayList: TRelayList | null | undefined
  cacheRelayListEvent: import('nostr-tools').Event | null | undefined
  favoriteRelays: readonly string[]
  blockedRelays: readonly string[]
}): string[] {
  const relays: string[] = []
  const eligibility = [
    ...(options.favoriteRelays ?? []),
    ...(options.relayList?.read ?? []),
    ...(options.relayList?.write ?? []),
    ...(options.relayList?.httpRead ?? []),
    ...(options.relayList?.httpWrite ?? [])
  ]

  if (options.relayList) {
    relays.push(
      ...userReadInboxUrls(options.relayList, options.cacheRelayListEvent),
      ...userWriteOutboxUrls(options.relayList, options.cacheRelayListEvent)
    )
  }

  relays.push(...(options.favoriteRelays ?? []))
  relays.push(...getAggrAwareSearchRelayUrls(eligibility))

  const blockedSet = new Set(
    (options.blockedRelays ?? [])
      .map((b) => normalizeUrl(b) || b.trim())
      .filter((b): b is string => !!b)
  )

  return Array.from(
    new Set(relays.map((url) => normalizeUrl(url) || url.trim()).filter((url): url is string => !!url))
  ).filter((relay) => {
    const n = normalizeUrl(relay) || relay
    return !blockedSet.has(n)
  })
}
