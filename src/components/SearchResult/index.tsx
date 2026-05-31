import { FAST_READ_RELAY_URLS, NIP_SEARCH_PAGE_KINDS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { TSearchParams } from '@/types'
import NormalFeed from '../NormalFeed'
import FullTextSearchByRelay from './FullTextSearchByRelay'
import Profile from '../Profile'
import { ProfileListBySearch } from '../ProfileListBySearch'
import Relay from '../Relay'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import { userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { normalizeUrl } from '@/lib/url'
import { buildAlexandriaEventsSearchUrlForTSearchParams } from '@/lib/alexandria-events-search-url'
import { useLayoutEffect, useMemo } from 'react'

function relayDedupeKey(url: string): string {
  return (normalizeUrl(url) || url.trim()).toLowerCase()
}

export default function SearchResult({ searchParams }: { searchParams: TSearchParams | null }) {
  const { relayList, cacheRelayListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()

  /**
   * Before NIP-50 / hashtag REQs, yield the pool — but do not abort profile lookups (npub / profile search).
   */
  useLayoutEffect(() => {
    if (!searchParams) return
    if (
      searchParams.type === 'relay' ||
      searchParams.type === 'profile' ||
      searchParams.type === 'profiles'
    ) {
      return
    }
    /** Yield pool capacity to search REQs without closing in-flight NIP-50 sockets (that zeroed results). */
    client.interruptBackgroundQueries()
  }, [searchParams?.type, searchParams?.search, searchParams?.input])

  /** NIP-50 / index relays — always queried first on their own shard so dead personal relays cannot zero out search. */
  const searchableUrls = useMemo(
    () =>
      Array.from(
        new Set(SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u.trim()).filter(Boolean))
      ),
    []
  )

  const searchableKeySet = useMemo(
    () => new Set(searchableUrls.map(relayDedupeKey)),
    [searchableUrls]
  )

  // User stack + defaults (hashtag search uses the non-searchable slice as a second shard)
  const combinedRelays = useMemo(() => {
    const relays: string[] = []

    if (relayList) {
      relays.push(
        ...userReadInboxUrls(relayList, cacheRelayListEvent),
        ...userWriteOutboxUrls(relayList, cacheRelayListEvent)
      )
    }

    relays.push(...(favoriteRelays || []))

    relays.push(...FAST_READ_RELAY_URLS, ...SEARCHABLE_RELAY_URLS)

    const normalized = Array.from(
      new Set(relays.map((url) => normalizeUrl(url) || url).filter((url): url is string => !!url))
    )

    const blockedSet = new Set(
      (blockedRelays ?? [])
        .map((b) => normalizeUrl(b) || b.trim())
        .filter((b): b is string => !!b)
    )

    return normalized.filter((relay) => {
      const n = normalizeUrl(relay) || relay
      return !blockedSet.has(n)
    })
  }, [relayList, cacheRelayListEvent, favoriteRelays, blockedRelays])

  const nonSearchableRelays = useMemo(
    () => combinedRelays.filter((u) => !searchableKeySet.has(relayDedupeKey(u))),
    [combinedRelays, searchableKeySet]
  )

  const alexandriaEmptyHref = useMemo(
    () => (searchParams ? buildAlexandriaEventsSearchUrlForTSearchParams(searchParams) : null),
    [searchParams]
  )

  if (!searchParams) {
    return null
  }
  if (searchParams.type === 'profile') {
    return (
      <Profile id={searchParams.search} alexandriaNotFoundHref={alexandriaEmptyHref} />
    )
  }
  if (searchParams.type === 'profiles') {
    return (
      <ProfileListBySearch search={searchParams.search} alexandriaEmptyHref={alexandriaEmptyHref} />
    )
  }
  if (searchParams.type === 'notes') {
    return (
      <FullTextSearchByRelay
        searchQuery={searchParams.search}
        relayUrls={searchableUrls}
        kinds={NIP_SEARCH_PAGE_KINDS}
        alexandriaEmptyHref={alexandriaEmptyHref}
      />
    )
  }
  if (searchParams.type === 'hashtag') {
    const hashtagFilter = { '#t': [searchParams.search] }
    const subRequests = [
      { urls: searchableUrls, filter: hashtagFilter },
      ...(nonSearchableRelays.length > 0 ? [{ urls: nonSearchableRelays, filter: hashtagFilter }] : [])
    ]
    return (
      <NormalFeed
        timelinePublicReadFallback
        subRequests={subRequests}
        alexandriaEmptyUrl={alexandriaEmptyHref}
      />
    )
  }
  return (
    <Relay
      url={searchParams.search}
      alexandriaEmptyUrl={alexandriaEmptyHref}
      alexandriaNotFoundHref={alexandriaEmptyHref}
    />
  )
}
