import RelayReviewCard from '@/components/RelayInfo/RelayReviewCard'
import RelaySimpleInfo, { RelaySimpleInfoSkeleton } from '@/components/RelaySimpleInfo'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { useFetchRelayInfo } from '@/hooks'
import {
  buildExploreRelayDirectory,
  filterExploreRelayDirectory,
  type ExploreRelayEntry
} from '@/lib/explore-relay-directory'
import {
  dedupeRelayReviewsNewestFirst,
  groupRelayReviewsByUrl,
  loadCachedRelayReviews
} from '@/lib/explore-relay-reviews'
import { getRelayUrlFromRelayReviewEvent } from '@/lib/event-metadata'
import {
  getRelayUrlsWithFavoritesFastReadAndInbox,
  userReadRelaysWithHttp
} from '@/lib/favorites-feed-relays'
import { toRelay } from '@/lib/link'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { appendCuratedReadOnlyRelays } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { useSmartRelayNavigation } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SHOW_COUNT = 12
const REVIEW_QUERY_LIMIT = 100
const EXPLORE_REVIEWS_MAX_RELAYS = 12
const EXPLORE_REVIEWS_EOSE_TAIL_MS = 4500
const MAX_REVIEWS_PER_CARD = 3

function stableRelayInputsKey(
  favoriteRelays: string[],
  blockedRelays: string[],
  relayList: { read?: string[]; write?: string[]; httpRead?: string[] } | null | undefined
): string {
  const normSortJoin = (urls: string[]) =>
    [...urls]
      .map((u) => normalizeAnyRelayUrl(u) || u.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .join('|')
  return [
    normSortJoin(favoriteRelays),
    normSortJoin(blockedRelays),
    normSortJoin([...(relayList?.httpRead ?? []), ...(relayList?.read ?? [])]),
    normSortJoin(relayList?.write ?? [])
  ].join('::')
}

function ExploreRelayDirectoryCard({ entry }: { entry: ExploreRelayEntry }) {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const { relayInfo } = useFetchRelayInfo(entry.url)
  const { sourceFlags, favoritedBy, reviews } = entry
  const visibleReviews = reviews.slice(0, MAX_REVIEWS_PER_CARD)

  const badges: { key: string; label: string }[] = []
  if (sourceFlags.inMailboxRead || sourceFlags.inMailboxWrite || sourceFlags.inMailboxHttpRead) {
    badges.push({ key: 'inbox', label: t('Your inbox') })
  }
  if (sourceFlags.inUserFavorites) {
    badges.push({ key: 'favorite', label: t('Favorite') })
  }
  if (reviews.length > 0) {
    badges.push({
      key: 'reviews',
      label: t('{{count}} reviews', { count: reviews.length })
    })
  }

  return (
    <article className="border-b px-4 py-4">
      <RelaySimpleInfo
        relayInfo={relayInfo}
        users={favoritedBy.length > 0 ? favoritedBy : undefined}
        className="clickable min-h-0"
        onClick={(e) => {
          e.stopPropagation()
          navigateToRelay(toRelay(entry.url))
        }}
      />
      {badges.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <Badge key={b.key} variant="secondary" className="text-xs font-normal">
              {b.label}
            </Badge>
          ))}
        </div>
      ) : null}
      {visibleReviews.length > 0 ? (
        <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
          {visibleReviews.map((event) => (
            <RelayReviewCard
              key={event.id}
              event={event}
              showRelayInfo={false}
              className="border md:border-border"
            />
          ))}
        </div>
      ) : null}
    </article>
  )
}

export default function ExploreRelayDirectory({ listFilter = '' }: { listFilter?: string }) {
  const { t } = useTranslation()
  const { pubkey, relayList } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()

  const relayInputsKey = useMemo(
    () => stableRelayInputsKey(favoriteRelays, blockedRelays, relayList),
    [favoriteRelays, blockedRelays, relayList]
  )

  const reviewRelayUrls = useMemo(() => {
    const stacked = appendCuratedReadOnlyRelays(
      getRelayUrlsWithFavoritesFastReadAndInbox(
        favoriteRelays,
        blockedRelays,
        userReadRelaysWithHttp(relayList),
        {
          userWriteRelays: relayList?.write ?? [],
          maxRelays: EXPLORE_REVIEWS_MAX_RELAYS,
          applySocialKindBlockedFilter: false
        }
      ),
      blockedRelays
    )
    return stacked
      .slice(0, EXPLORE_REVIEWS_MAX_RELAYS)
      .map((u) => normalizeAnyRelayUrl(u) || u.trim())
      .filter((u): u is string => Boolean(u))
      .sort((a, b) => a.localeCompare(b))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content hash of relay inputs
  }, [relayInputsKey])

  const [nip66Cached, setNip66Cached] = useState<string[]>([])
  const [followingFavorites, setFollowingFavorites] = useState<[string, string[]][]>([])
  const [followingLoading, setFollowingLoading] = useState(true)
  const [reviewEvents, setReviewEvents] = useState<import('nostr-tools').Event[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fetchGenRef = useRef(0)

  useEffect(() => {
    client.scheduleNip66RelayDiscoveryFromExplore()
  }, [])

  useEffect(() => {
    let cancelled = false
    void indexedDb
      .getPublicLivelyRelayUrlsCache()
      .then((c) => {
        if (!cancelled && c?.urls?.length) setNip66Cached(c.urls)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setFollowingLoading(true)
    void (async () => {
      if (!pubkey) {
        setFollowingFavorites([])
        return
      }
      const rows = (await client.fetchFollowingFavoriteRelays(pubkey)) ?? []
      if (!cancelled) setFollowingFavorites(rows)
    })().finally(() => {
      if (!cancelled) setFollowingLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [pubkey])

  useEffect(() => {
    const gen = ++fetchGenRef.current
    let cancelled = false
    setReviewsLoading(true)
    setReviewEvents([])

    void (async () => {
      const cached = await loadCachedRelayReviews(REVIEW_QUERY_LIMIT)
      if (!cancelled && fetchGenRef.current === gen && cached.length > 0) {
        setReviewEvents(cached)
      }
      try {
        const raw = await client.fetchEvents(
          reviewRelayUrls,
          { kinds: [ExtendedKind.RELAY_REVIEW], limit: REVIEW_QUERY_LIMIT },
          {
            onevent: (e) => {
              if (cancelled || fetchGenRef.current !== gen) return
              if (e.kind === ExtendedKind.RELAY_REVIEW && getRelayUrlFromRelayReviewEvent(e)) {
                setReviewEvents((prev) => dedupeRelayReviewsNewestFirst([...prev, e]))
              }
            },
            firstRelayResultGraceMs: false,
            globalTimeout: 12_000,
            eoseTimeout: EXPLORE_REVIEWS_EOSE_TAIL_MS,
            cache: true
          }
        )
        if (cancelled || fetchGenRef.current !== gen) return
        const withRelay = raw.filter(
          (e) => e.kind === ExtendedKind.RELAY_REVIEW && getRelayUrlFromRelayReviewEvent(e)
        )
        setReviewEvents((prev) => dedupeRelayReviewsNewestFirst([...prev, ...withRelay]))
      } catch {
        if (!cancelled && fetchGenRef.current === gen) setReviewEvents([])
      } finally {
        if (!cancelled && fetchGenRef.current === gen) setReviewsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [relayInputsKey])

  const reviewsByRelay = useMemo(() => groupRelayReviewsByUrl(reviewEvents), [reviewEvents])

  const entries = useMemo(
    () =>
      buildExploreRelayDirectory({
        relayList,
        favoriteRelays,
        blockedRelays,
        nip66CachedUrls: nip66Cached,
        followingFavorites,
        reviewsByRelay
      }),
    [relayList, favoriteRelays, blockedRelays, nip66Cached, followingFavorites, reviewsByRelay]
  )

  const filtered = useMemo(
    () => filterExploreRelayDirectory(entries, listFilter),
    [entries, listFilter]
  )

  const visible = filtered.slice(0, showCount)
  const showInitialSkeleton = filtered.length === 0 && (followingLoading || reviewsLoading)

  useEffect(() => {
    setShowCount(SHOW_COUNT)
  }, [listFilter, relayInputsKey])

  useEffect(() => {
    const options = { root: null, rootMargin: '120px', threshold: 0 }
    const observer = new IntersectionObserver((entriesObs) => {
      if (entriesObs[0]?.isIntersecting && showCount < filtered.length) {
        setShowCount((prev) => prev + SHOW_COUNT)
      }
    }, options)
    const el = bottomRef.current
    if (el) observer.observe(el)
    return () => {
      if (el) observer.unobserve(el)
    }
  }, [showCount, filtered.length])

  if (showInitialSkeleton) {
    return (
      <section className="min-w-0 pb-8" aria-label={t('Relays')}>
        {Array.from({ length: 4 }).map((_, i) => (
          <RelaySimpleInfoSkeleton key={i} className="border-b p-4" />
        ))}
      </section>
    )
  }

  if (filtered.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        {listFilter.trim() ? t('no relays found') : t('No relays in your lists yet.')}
      </p>
    )
  }

  return (
    <section className="min-w-0 pb-8" aria-label={t('Relays')}>
      <p className="mb-3 px-4 text-sm text-muted-foreground">
        {t('Your relays first, then those your network favors and reviews.')}
      </p>
      {visible.map((entry) => (
        <ExploreRelayDirectoryCard key={entry.url} entry={entry} />
      ))}
      {reviewsLoading && entries.length > 0 ? (
        <div className="px-4 py-2" aria-busy="true">
          <Skeleton className="h-8 w-48" />
        </div>
      ) : null}
      {showCount < filtered.length ? <div ref={bottomRef} className="h-4" aria-hidden /> : null}
      {!followingLoading && !reviewsLoading && showCount >= filtered.length ? (
        <p className="mt-3 text-center text-sm text-muted-foreground">{t('no more relays')}</p>
      ) : null}
    </section>
  )
}
