import { FAST_READ_RELAY_URLS, GENERAL_SEARCH_PAGE_KINDS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { TSearchParams } from '@/types'
import NormalFeed from '../NormalFeed'
import FullTextSearchByRelay from './FullTextSearchByRelay'
import Profile from '../Profile'
import { ProfileListBySearch } from '../ProfileListBySearch'
import Relay from '../Relay'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { normalizeUrl } from '@/lib/url'
import { buildAlexandriaEventsSearchUrlForTSearchParams } from '@/lib/alexandria-events-search-url'
import { useMemo } from 'react'

function relayDedupeKey(url: string): string {
  return (normalizeUrl(url) || url.trim()).toLowerCase()
}

export default function SearchResult({ searchParams }: { searchParams: TSearchParams | null }) {
  const { relayList, cacheRelayListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()

  /** Index relays for hashtag search and relay dedupe (notes search is local cache only). */
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
        kinds={GENERAL_SEARCH_PAGE_KINDS}
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
