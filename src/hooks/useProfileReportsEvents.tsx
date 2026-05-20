import { ExtendedKind, FAST_READ_RELAY_URLS, PROFILE_RELAY_URLS } from '@/constants'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import type { ProfileTimelineRelayUrlsBuilder } from '@/hooks/useProfileTimeline'
import { buildProfilePageReadRelayUrls, mergeRelayUrlLayers } from '@/lib/favorites-feed-relays'
import { isNip56ReportEvent } from '@/lib/event'
import { isReportAuthoredBy, reportTargetsPubkey } from '@/lib/nip56-reports'
import { normalizeHexPubkey } from '@/lib/pubkey'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { normalizeAnyRelayUrl, subtractNormalizedRelayUrls } from '@/lib/url'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostrOptional } from '@/providers/nostr-context'
import client from '@/services/client.service'
import type { TSubRequestFilter } from '@/types'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Event, kinds } from 'nostr-tools'

const REPORT_KINDS = [kinds.Report, ExtendedKind.REPORT] as const
const CACHE_DURATION = 5 * 60 * 1000

type CacheEntry = { events: Event[]; lastUpdated: number }
const memoryByKey = new Map<string, CacheEntry>()

function relayListsContentKey(favoriteRelays: string[], blockedRelays: string[]): string {
  const fav = [...favoriteRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  const blk = [...blockedRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  return `${fav}\u0000${blk}`
}

function mergeReportEvents(
  raw: Event[],
  limit: number,
  isEventDeleted: (e: Event) => boolean,
  extraFilter?: (e: Event) => boolean
): Event[] {
  const dedup = new Map<string, Event>()
  for (const e of raw) {
    if (!isNip56ReportEvent(e)) continue
    if (extraFilter && !extraFilter(e)) continue
    if (isEventDeleted(e)) continue
    dedup.set(e.id, e)
  }
  return [...dedup.values()].sort((a, b) => b.created_at - a.created_at).slice(0, limit)
}

function eventsEqualById(a: Event[], b: Event[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false
  }
  return true
}

type FetchMode = 'received' | 'made'

function buildFilter(pubkey: string, mode: FetchMode, limit: number): TSubRequestFilter {
  if (mode === 'made') {
    return { authors: [pubkey], kinds: [...REPORT_KINDS], limit }
  }
  return { kinds: [...REPORT_KINDS], '#p': [pubkey], limit }
}

function postFilter(pubkey: string, mode: FetchMode) {
  return mode === 'made'
    ? (e: Event) => isReportAuthoredBy(e, pubkey)
    : (e: Event) => reportTargetsPubkey(e, pubkey)
}

type UseProfileReportsEventsOptions = {
  pubkey: string
  relayUrlsBuilder?: ProfileTimelineRelayUrlsBuilder
  limit?: number
}

export function useProfileReportsEvents({
  pubkey,
  relayUrlsBuilder,
  limit = 200
}: UseProfileReportsEventsOptions) {
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const useGlobalRelayBootstrap = useGlobalRelayBootstrapDefaults()
  const nostr = useNostrOptional()
  const { isEventDeleted, tombstoneEpoch } = useDeletedEvent()
  const isEventDeletedRef = useRef(isEventDeleted)
  isEventDeletedRef.current = isEventDeleted

  const receivedCacheKey = useMemo(() => `${pubkey}-profile-reports-received-v1`, [pubkey])
  const madeCacheKey = useMemo(() => `${pubkey}-profile-reports-made-v1`, [pubkey])

  const receivedCached = memoryByKey.get(receivedCacheKey)
  const madeCached = memoryByKey.get(madeCacheKey)

  const [received, setReceived] = useState<Event[]>(receivedCached?.events ?? [])
  const [made, setMade] = useState<Event[]>(madeCached?.events ?? [])
  const [isLoading, setIsLoading] = useState(!receivedCached || !madeCached)
  const [refreshToken, setRefreshToken] = useState(0)

  const includeAuthorLocalRelays = useMemo(() => {
    const me = nostr?.pubkey?.trim()
    if (!me) return false
    try {
      return normalizeHexPubkey(me) === normalizeHexPubkey(pubkey)
    } catch {
      return false
    }
  }, [nostr?.pubkey, pubkey])

  const relayListsKey = useMemo(
    () => relayListsContentKey(favoriteRelays, blockedRelays),
    [favoriteRelays, blockedRelays]
  )

  const relayUrlsBuilderRef = useRef(relayUrlsBuilder)
  relayUrlsBuilderRef.current = relayUrlsBuilder
  const favoriteRelaysRef = useRef(favoriteRelays)
  const blockedRelaysRef = useRef(blockedRelays)
  favoriteRelaysRef.current = favoriteRelays
  blockedRelaysRef.current = blockedRelays
  const useGlobalRelayBootstrapRef = useRef(useGlobalRelayBootstrap)
  useGlobalRelayBootstrapRef.current = useGlobalRelayBootstrap

  const resolveFeedUrls = useCallback(
    (
      authorRelayList: { read: string[]; write: string[]; httpRead?: string[]; httpWrite?: string[] },
      includeAuthorLocal: boolean
    ) => {
      const blocked = blockedRelaysRef.current
      const profileRead = buildProfilePageReadRelayUrls(
        favoriteRelaysRef.current,
        blocked,
        authorRelayList,
        false,
        includeAuthorLocal,
        [...REPORT_KINDS],
        useGlobalRelayBootstrapRef.current
      )
      const custom = relayUrlsBuilderRef.current
      const fromCustom = custom
        ? custom(favoriteRelaysRef.current, blocked, authorRelayList, includeAuthorLocal)
        : []
      const merged = mergeRelayUrlLayers(
        custom ? [fromCustom, profileRead] : [profileRead],
        blocked
      )
      if (merged.length > 0) return merged
      // NIP-65 still loading: favorites + fast-read only (same as profile feed).
      return buildProfilePageReadRelayUrls(
        favoriteRelaysRef.current,
        blocked,
        { read: [], write: [], httpRead: [], httpWrite: [] },
        false,
        includeAuthorLocal,
        [...REPORT_KINDS],
        useGlobalRelayBootstrapRef.current
      )
    },
    []
  )

  useEffect(() => {
    setReceived((prev) => {
      const next = prev.filter((e) => !isEventDeletedRef.current(e))
      const c = memoryByKey.get(receivedCacheKey)
      if (c) memoryByKey.set(receivedCacheKey, { events: next, lastUpdated: c.lastUpdated })
      return next
    })
    setMade((prev) => {
      const next = prev.filter((e) => !isEventDeletedRef.current(e))
      const c = memoryByKey.get(madeCacheKey)
      if (c) memoryByKey.set(madeCacheKey, { events: next, lastUpdated: c.lastUpdated })
      return next
    })
  }, [tombstoneEpoch, receivedCacheKey, madeCacheKey])

  useEffect(() => {
    let cancelled = false

    const loadMode = async (
      mode: FetchMode,
      cacheKey: string,
      setEvents: Dispatch<SetStateAction<Event[]>>
    ) => {
      const mem = memoryByKey.get(cacheKey)
      const cacheAge = mem ? Date.now() - mem.lastUpdated : Infinity
      const isCacheFresh = cacheAge < CACHE_DURATION
      const pool = new Map<string, Event>()
      if (isCacheFresh && mem) {
        mem.events.forEach((e) => pool.set(e.id, e))
      }

      const flush = () => {
        if (cancelled) return
        const processed = mergeReportEvents(
          Array.from(pool.values()),
          limit,
          isEventDeletedRef.current,
          postFilter(pubkey, mode)
        )
        memoryByKey.set(cacheKey, { events: processed, lastUpdated: Date.now() })
        setEvents((prev) => (eventsEqualById(prev, processed) ? prev : processed))
      }

      let pkNorm = pubkey
      try {
        pkNorm = normalizeHexPubkey(pubkey)
      } catch {
        /* use raw */
      }

      const emptyAuthor = { read: [] as string[], write: [] as string[], httpRead: [] as string[], httpWrite: [] as string[] }
      const authorPeek = await client.peekRelayListFromStorage(pubkey).catch(() => emptyAuthor)
      if (cancelled) return
      let provisionalUrls = resolveFeedUrls(authorPeek, includeAuthorLocalRelays)
      if (provisionalUrls.length === 0) {
        provisionalUrls = dedupeNormalizeRelayUrlsOrdered([
          ...PROFILE_RELAY_URLS,
          ...FAST_READ_RELAY_URLS
        ]).slice(0, 24)
      }
      if (provisionalUrls.length === 0) return

      const filter = buildFilter(pkNorm, mode, limit)
      const subRequests = [{ urls: provisionalUrls, filter }]

      try {
        const disk = await client.getLocalFeedEvents(subRequests)
        if (!cancelled) {
          for (const e of disk) pool.set(e.id, e)
          flush()
        }
      } catch {
        /* best-effort */
      }

      try {
        const fetched = await client.fetchEvents(provisionalUrls, filter, {
          cache: true,
          eoseTimeout: 4500,
          globalTimeout: 14_000
        })
        if (!cancelled) {
          for (const e of fetched) pool.set(e.id, e)
          flush()
        }
      } catch {
        /* ignore */
      }

      const authorRl = await client.fetchRelayList(pubkey).catch(() => emptyAuthor)
      if (cancelled) return
      const fullUrls = resolveFeedUrls(authorRl, includeAuthorLocalRelays)
      const deltaUrls = subtractNormalizedRelayUrls(fullUrls, provisionalUrls)
      if (deltaUrls.length === 0) return

      const deltaRequests = [{ urls: deltaUrls, filter }]
      try {
        const diskDelta = await client.getLocalFeedEvents(deltaRequests)
        if (!cancelled) {
          for (const e of diskDelta) pool.set(e.id, e)
          flush()
        }
      } catch {
        /* ignore */
      }
      try {
        const fetchedDelta = await client.fetchEvents(deltaUrls, filter, {
          cache: true,
          eoseTimeout: 4500,
          globalTimeout: 14_000
        })
        if (!cancelled) {
          for (const e of fetchedDelta) pool.set(e.id, e)
          flush()
        }
      } catch {
        /* ignore */
      }
    }

    const run = async () => {
      const recvMem = memoryByKey.get(receivedCacheKey)
      const madeMem = memoryByKey.get(madeCacheKey)
      const recvFresh = recvMem && Date.now() - recvMem.lastUpdated < CACHE_DURATION
      const madeFresh = madeMem && Date.now() - madeMem.lastUpdated < CACHE_DURATION

      if (recvFresh && recvMem) {
        setReceived(recvMem.events)
      }
      if (madeFresh && madeMem) {
        setMade(madeMem.events)
      }
      if (recvFresh && madeFresh && refreshToken === 0) {
        setIsLoading(false)
        return
      }

      setIsLoading(true)

      await Promise.all([
        loadMode('received', receivedCacheKey, setReceived),
        loadMode('made', madeCacheKey, setMade)
      ])

      if (!cancelled) setIsLoading(false)
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [
    pubkey,
    receivedCacheKey,
    madeCacheKey,
    limit,
    refreshToken,
    relayListsKey,
    includeAuthorLocalRelays,
    resolveFeedUrls
  ])

  const refresh = useCallback(() => {
    memoryByKey.delete(receivedCacheKey)
    memoryByKey.delete(madeCacheKey)
    setIsLoading(true)
    setRefreshToken((t) => t + 1)
  }, [receivedCacheKey, madeCacheKey])

  return { received, made, isLoading, refresh }
}
