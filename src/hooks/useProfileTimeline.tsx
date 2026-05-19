import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import client, { eventService } from '@/services/client.service'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Event, kinds as nostrKinds, type Filter } from 'nostr-tools'
import { CALENDAR_EVENT_KINDS, ExtendedKind, isDocumentRelayKind, isSocialKindBlockedKind } from '@/constants'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import type { ProfileReportsRelayList } from '@/lib/profile-reports-relays'
import { hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { normalizeAnyRelayUrl, subtractNormalizedRelayUrls } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostrOptional } from '@/providers/nostr-context'
import indexedDb from '@/services/indexed-db.service'
import type { TSubRequestFilter } from '@/types'

type ProfileTimelineMemoryEntry = {
  events: Event[]
  lastUpdated: number
}

/** 5-minute in-memory cache for this hook only — not IndexedDB, not client timeline refs. */
const memoryTimelineByKey = new Map<string, ProfileTimelineMemoryEntry>()
const CACHE_DURATION = 5 * 60 * 1000

export type ProfileTimelineRelayUrlsBuilder = (
  favoriteRelays: string[],
  blockedRelays: string[],
  authorRelayList: ProfileReportsRelayList,
  includeAuthorLocalRelays: boolean
) => string[]

type UseProfileTimelineOptions = {
  pubkey: string
  cacheKey: string
  kinds: number[]
  limit?: number
  filterPredicate?: (event: Event) => boolean
  /** When set, replaces {@link buildProfilePageReadRelayUrls} (e.g. profile Reports tab inboxes only). */
  relayUrlsBuilder?: ProfileTimelineRelayUrlsBuilder
}

type UseProfileTimelineResult = {
  events: Event[]
  isLoading: boolean
  refresh: () => void
}

function buildSubRequests(
  groups: string[][],
  pubkey: string,
  kindsArg: number[],
  limit: number,
  hasCalendarKinds: boolean
) {
  const authorRequests = groups
    .map((urls) => ({
      urls,
      filter: {
        authors: [pubkey],
        kinds: kindsArg,
        limit
      } as any
    }))
    .filter((request) => request.urls.length)
  const calendarInviteRequests = hasCalendarKinds
    ? groups
        .map((urls) => ({
          urls,
          filter: {
            kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
            '#p': [pubkey],
            limit: 100
          } as any
        }))
        .filter((request) => request.urls.length)
    : []
  return [...authorRequests, ...calendarInviteRequests]
}

function postProcessEvents(
  rawEvents: Event[],
  filterPredicate: ((event: Event) => boolean) | undefined,
  limit: number,
  isEventDeleted: (event: Event) => boolean
) {
  const dedupMap = new Map<string, Event>()
  rawEvents.forEach((evt) => {
    if (!dedupMap.has(evt.id)) {
      dedupMap.set(evt.id, evt)
    }
  })

  let events = Array.from(dedupMap.values()).filter((e) => !isEventDeleted(e))

  // Parameterized replaceable events (kinds 30000-39999) should be unique by pubkey+kind+d.
  // Keep only the latest version so profile feeds don't show multiple revisions of one article.
  const latestAddressableByKey = new Map<string, Event>()
  const nonAddressableEvents: Event[] = []
  events.forEach((evt) => {
    const isAddressable = evt.kind >= 30000 && evt.kind < 40000
    if (!isAddressable) {
      nonAddressableEvents.push(evt)
      return
    }
    const d = evt.tags.find((t) => t[0] === 'd')?.[1]?.trim()
    if (!d) {
      nonAddressableEvents.push(evt)
      return
    }
    const key = `${evt.pubkey}:${evt.kind}:${d}`
    const existing = latestAddressableByKey.get(key)
    if (
      !existing ||
      evt.created_at > existing.created_at ||
      (evt.created_at === existing.created_at && evt.id > existing.id)
    ) {
      latestAddressableByKey.set(key, evt)
    }
  })
  events = [...nonAddressableEvents, ...latestAddressableByKey.values()]

  if (filterPredicate) {
    events = events.filter(filterPredicate)
  }
  events.sort((a, b) => b.created_at - a.created_at)
  return events.slice(0, limit)
}

function relayListsContentKey(favoriteRelays: string[], blockedRelays: string[]): string {
  const fav = [...favoriteRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  const blk = [...blockedRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  return `${fav}\u0000${blk}`
}

export function useProfileTimeline({
  pubkey,
  cacheKey,
  kinds,
  limit = 200,
  filterPredicate,
  relayUrlsBuilder
}: UseProfileTimelineOptions): UseProfileTimelineResult {
  const nostr = useNostrOptional()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const useGlobalRelayBootstrap = useGlobalRelayBootstrapDefaults()
  const includeAuthorLocalRelays = useMemo(() => {
    const me = nostr?.pubkey?.trim()
    if (!me) return false
    try {
      return hexPubkeysEqual(normalizeHexPubkey(me), normalizeHexPubkey(pubkey))
    } catch {
      return false
    }
  }, [nostr?.pubkey, pubkey])
  const relayListsKey = useMemo(
    () => relayListsContentKey(favoriteRelays, blockedRelays),
    [favoriteRelays, blockedRelays]
  )
  const { isEventDeleted, tombstoneEpoch } = useDeletedEvent()
  const isEventDeletedRef = useRef(isEventDeleted)
  isEventDeletedRef.current = isEventDeleted

  const filterPredicateRef = useRef(filterPredicate)
  filterPredicateRef.current = filterPredicate
  const relayUrlsBuilderRef = useRef(relayUrlsBuilder)
  relayUrlsBuilderRef.current = relayUrlsBuilder
  const limitRef = useRef(limit)
  limitRef.current = limit

  const resolveFeedUrls = useCallback(
    (
      favoriteRelaysArg: string[],
      blockedRelaysArg: string[],
      authorRelayList: ProfileReportsRelayList,
      includeAuthorLocalRelaysArg: boolean,
      kindsArg: number[],
      useGlobalRelayBootstrapArg: boolean
    ) => {
      const custom = relayUrlsBuilderRef.current
      if (custom) {
        return custom(favoriteRelaysArg, blockedRelaysArg, authorRelayList, includeAuthorLocalRelaysArg)
      }
      const socialKinds = kindsArg.some(isSocialKindBlockedKind)
      return buildProfilePageReadRelayUrls(
        favoriteRelaysArg,
        blockedRelaysArg,
        authorRelayList as { read: string[]; write: string[]; httpRead?: string[]; httpWrite?: string[] },
        socialKinds,
        includeAuthorLocalRelaysArg,
        kindsArg,
        useGlobalRelayBootstrapArg
      )
    },
    []
  )

  const cachedEntry = useMemo(() => memoryTimelineByKey.get(cacheKey), [cacheKey])
  const [events, setEvents] = useState<Event[]>(cachedEntry?.events ?? [])
  const [isLoading, setIsLoading] = useState(!cachedEntry)
  /** Last painted rows — re-seed merge pool after `refresh()` clears memory so relay hiccups do not wipe the list. */
  const latestEventsRef = useRef<Event[]>(events)
  latestEventsRef.current = events
  const [refreshToken, setRefreshToken] = useState(0)
  const subscriptionRef = useRef<() => void>(() => {})

  useEffect(() => {
    setEvents((prev) => {
      const next = prev.filter((e) => !isEventDeletedRef.current(e))
      if (next.length === prev.length) return prev
      const cached = memoryTimelineByKey.get(cacheKey)
      if (cached) {
        memoryTimelineByKey.set(cacheKey, { events: next, lastUpdated: cached.lastUpdated })
      }
      return next
    })
  }, [tombstoneEpoch, cacheKey])

  useEffect(() => {
    let cancelled = false
    const closers: (() => void)[] = []
    const pool = new Map<string, Event>()

    const flushPool = () => {
      if (cancelled) return
      const processed = postProcessEvents(
        Array.from(pool.values()),
        filterPredicateRef.current,
        limitRef.current,
        isEventDeletedRef.current
      )
      memoryTimelineByKey.set(cacheKey, { events: processed, lastUpdated: Date.now() })
      setEvents(processed)
      setIsLoading(false)
    }

    subscriptionRef.current = () => {
      closers.forEach((c) => c())
      closers.length = 0
    }

    const registerCloser = (closer: () => void) => {
      if (cancelled) {
        closer()
        return
      }
      closers.push(closer)
    }

    const subscribe = async () => {
      const mem = memoryTimelineByKey.get(cacheKey)
      const cacheAge = mem ? Date.now() - mem.lastUpdated : Infinity
      const isCacheFresh = cacheAge < CACHE_DURATION

      pool.clear()
      if (isCacheFresh && mem) {
        setEvents(mem.events)
        setIsLoading(false)
        mem.events.forEach((e) => pool.set(e.id, e))
      } else {
        /**
         * Stale memory: keep showing last rows while revalidating (SWR). Previously we set `isLoading` false
         * whenever `mem` existed (`!mem` is false), which hid the refresh banner and skipped priming the pool —
         * relay failures then left the UI “frozen” on an empty pool with no new merge.
         */
        if (mem?.events?.length) {
          mem.events.forEach((e) => pool.set(e.id, e))
          setEvents(mem.events)
          setIsLoading(true)
        } else {
          try {
            const pk = normalizeHexPubkey(pubkey)
            const primeKinds = new Set(kinds)
            for (const e of latestEventsRef.current) {
              if (!primeKinds.has(e.kind)) continue
              if (normalizeHexPubkey(e.pubkey) === pk) pool.set(e.id, e)
            }
            if (!cancelled && pool.size > 0) flushPool()
          } catch {
            /* ignore malformed pubkeys */
          }
        }
      }

      const hasCalendarKinds = kinds.some((k) => CALENDAR_EVENT_KINDS.includes(k))
      const socialKinds = kinds.some(isSocialKindBlockedKind)
      const emptyAuthor = { read: [] as string[], write: [] as string[], httpRead: [] as string[], httpWrite: [] as string[] }
      const idbDocKinds = kinds.filter((k) => isDocumentRelayKind(k))

      let pkNorm: string | null = null
      try {
        pkNorm = normalizeHexPubkey(pubkey)
      } catch {
        pkNorm = null
      }

      let hadSessionHits = false
      if (pkNorm) {
        const pkForDisk = pkNorm
        try {
          const sessionKindList = idbDocKinds.length > 0 ? idbDocKinds : kinds
          const fromSession = eventService.listSessionEventsAuthoredBy(pkForDisk, {
            kinds: sessionKindList,
            limit
          })
          hadSessionHits = fromSession.length > 0
          if (!cancelled) {
            for (const e of fromSession) {
              pool.set(e.id, e as Event)
            }
            if (fromSession.length) flushPool()
          }
        } catch {
          /* ignore malformed pubkeys */
        }

        void (async () => {
          try {
            const idbKindsForScan = idbDocKinds.length > 0 ? idbDocKinds : kinds
            const maxScan = idbDocKinds.length > 0 ? 18_000 : 16_000
            const pubStorePromise =
              idbDocKinds.length > 0
                ? indexedDb.getCachedPublicationStoreEventsForProfileAuthor(pkForDisk, idbDocKinds, limit)
                : Promise.resolve([] as Event[])
            const [fromPubStore, fromArchive] = await Promise.all([
              pubStorePromise,
              indexedDb.scanEventArchiveByAuthorPubkey(pkForDisk, {
                kinds: idbKindsForScan,
                maxRowsScanned: maxScan,
                maxMatches: limit
              })
            ])
            if (cancelled) return
            for (const e of fromPubStore) pool.set(e.id, e)
            for (const e of fromArchive) pool.set(e.id, e)
            const hadDisk = fromPubStore.length + fromArchive.length > 0
            if (hadDisk) flushPool()
            else if (!isCacheFresh && !mem?.events?.length && !hadSessionHits) {
              setIsLoading(true)
            }
          } catch {
            /* best-effort */
          }
        })()
      } else if (!isCacheFresh && !mem?.events?.length) {
        setIsLoading(true)
      }

      const authorRelayPromise = client.fetchRelayList(pubkey).catch(() => emptyAuthor)

      const provisionalFeedUrls = resolveFeedUrls(
        favoriteRelays,
        blockedRelays,
        emptyAuthor,
        includeAuthorLocalRelays,
        kinds,
        useGlobalRelayBootstrap
      )

      const startWave = async (subRequests: ReturnType<typeof buildSubRequests>) => {
        if (cancelled || subRequests.length === 0) return
        try {
          const { closer } = await client.subscribeTimeline(
            subRequests,
            {
              onEvents: (fetched) => {
                if (cancelled) return
                for (const e of fetched as Event[]) {
                  pool.set(e.id, e)
                }
                flushPool()
              },
              onNew: (evt) => {
                if (cancelled) return
                pool.set((evt as Event).id, evt as Event)
                flushPool()
              }
            },
            { needSort: true }
          )
          registerCloser(closer)
        } catch {
          if (!cancelled) setIsLoading(false)
        }
      }

      if (provisionalFeedUrls.length === 0) {
        if (!cancelled) setIsLoading(false)
        return
      }

      const provisionalSubs = buildSubRequests([provisionalFeedUrls], pubkey, kinds, limit, hasCalendarKinds)
      void (async () => {
        let pkForReq = pubkey
        try {
          pkForReq = normalizeHexPubkey(pubkey)
        } catch {
          /* use raw pubkey */
        }
        const longFormPrefetch =
          idbDocKinds.includes(nostrKinds.LongFormArticle) && provisionalFeedUrls.length > 0
            ? client.fetchEvents(
                provisionalFeedUrls,
                {
                  authors: [pkForReq],
                  kinds: [nostrKinds.LongFormArticle],
                  limit
                } as Filter,
                { cache: true, eoseTimeout: 4500, globalTimeout: 14_000, replaceableRace: true }
              ).catch(() => [] as Event[])
            : Promise.resolve([] as Event[])

        try {
          const [disk, longFormRows] = await Promise.all([
            client.getLocalFeedEvents(
              provisionalSubs as Array<{ urls: string[]; filter: TSubRequestFilter }>
            ),
            longFormPrefetch
          ])
          if (!cancelled && disk.length > 0) {
            for (const e of disk) {
              pool.set(e.id, e)
            }
            flushPool()
          }
          if (!cancelled && longFormRows.length > 0) {
            for (const e of longFormRows) {
              pool.set(e.id, e)
            }
            flushPool()
          }
        } catch {
          /* disk snapshot is best-effort */
        }
        try {
          await startWave(provisionalSubs)
        } finally {
          /** Subscriptions are live; sync UI even if the merged layer was slow to emit (empty feed is valid). */
          if (!cancelled) flushPool()
        }
      })()

      void (async () => {
        const authorRl = await authorRelayPromise
        if (cancelled) return
        const fullFeedUrls = resolveFeedUrls(
          favoriteRelays,
          blockedRelays,
          authorRl,
          includeAuthorLocalRelays,
          kinds,
          useGlobalRelayBootstrap
        )
        const deltaUrls = subtractNormalizedRelayUrls(fullFeedUrls, provisionalFeedUrls)
        if (cancelled || deltaUrls.length === 0) return
        const deltaSubs = buildSubRequests([deltaUrls], pubkey, kinds, limit, hasCalendarKinds)
        try {
          const diskDelta = await client.getLocalFeedEvents(
            deltaSubs as Array<{ urls: string[]; filter: TSubRequestFilter }>
          )
          if (!cancelled && diskDelta.length > 0) {
            for (const e of diskDelta) {
              pool.set(e.id, e)
            }
            flushPool()
          }
        } catch {
          /* optional */
        }
        try {
          await startWave(deltaSubs)
        } finally {
          if (!cancelled) flushPool()
        }
      })()
    }

    void subscribe()

    return () => {
      cancelled = true
      subscriptionRef.current()
      subscriptionRef.current = () => {}
    }
  }, [
    pubkey,
    cacheKey,
    JSON.stringify(kinds),
    limit,
    refreshToken,
    relayListsKey,
    includeAuthorLocalRelays,
    useGlobalRelayBootstrap,
    resolveFeedUrls
  ])

  const refresh = useCallback(() => {
    subscriptionRef.current()
    subscriptionRef.current = () => {}
    memoryTimelineByKey.delete(cacheKey)
    setIsLoading(true)
    setRefreshToken((token) => token + 1)
  }, [cacheKey])

  return {
    events,
    isLoading,
    refresh
  }
}
