import {
  ExtendedKind,
  METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
  METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS
} from '@/constants'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import { getReplaceableCoordinate } from '@/lib/event'
import {
  fetchLegacyProfileBadgesListEvent,
  fetchProfileBadgesListEvent
} from '@/lib/nip58-profile-badges-list'
import {
  isNip58ProfileBadgesListEvent,
  parseAddressableCoordinate,
  parseProfileBadgeEntries,
  resolveBadgeDisplayFromDefinition,
  type ResolvedProfileBadge
} from '@/lib/nip58-profile-badges'
import { isDirectProfileWallComment } from '@/lib/profile-wall-comments'
import { isValidPubkey, userIdToPubkey } from '@/lib/pubkey'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import client, { replaceableEventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Event, kinds, type Filter } from 'nostr-tools'

async function fetchBadgeDefinitionOnRelays(
  coordinate: string,
  relayUrls: string[]
): Promise<Event | undefined> {
  const parsed = parseAddressableCoordinate(coordinate)
  if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) return undefined

  try {
    const disk = await indexedDb.getReplaceableEvent(parsed.pubkey, parsed.kind, parsed.d)
    if (disk) return disk
  } catch {
    /* best-effort */
  }

  try {
    const cached = await replaceableEventService.fetchReplaceableEvent(
      parsed.pubkey,
      parsed.kind,
      parsed.d
    )
    if (cached) return cached
  } catch {
    /* best-effort */
  }

  if (!relayUrls.length) return undefined

  const rows = await client.fetchEvents(
    relayUrls,
    {
      authors: [parsed.pubkey],
      kinds: [ExtendedKind.BADGE_DEFINITION],
      '#d': [parsed.d],
      limit: 20
    },
    {
      replaceableRace: true,
      eoseTimeout: METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
      globalTimeout: METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS,
      foreground: true
    }
  )
  const matches = rows.filter((e) => e.kind === ExtendedKind.BADGE_DEFINITION)
  if (!matches.length) return undefined
  return matches.reduce((best, e) => (e.created_at > best.created_at ? e : best))
}

const CACHE_DURATION = 5 * 60 * 1000
const wallCacheByKey = new Map<string, { badges: ResolvedProfileBadge[]; comments: Event[]; lastUpdated: number }>()

function relayListsContentKey(favoriteRelays: string[], blockedRelays: string[]): string {
  const fav = [...favoriteRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  const blk = [...blockedRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  return `${fav}\u0000${blk}`
}

export function useProfileWall(pubkey: string, profileEventId: string | undefined) {
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const useGlobalRelayBootstrap = useGlobalRelayBootstrapDefaults()
  const { isEventDeleted } = useDeletedEvent()
  const isEventDeletedRef = useRef(isEventDeleted)
  isEventDeletedRef.current = isEventDeleted

  const cacheKey = useMemo(() => `${pubkey}-profile-wall-v1`, [pubkey])
  const cached = wallCacheByKey.get(cacheKey)

  const [badges, setBadges] = useState<ResolvedProfileBadge[]>(cached?.badges ?? [])
  const [comments, setComments] = useState<Event[]>(cached?.comments ?? [])
  const [isLoading, setIsLoading] = useState(!cached)
  const [refreshToken, setRefreshToken] = useState(0)

  const relayListsKey = useMemo(
    () => relayListsContentKey(favoriteRelays, blockedRelays),
    [favoriteRelays, blockedRelays]
  )
  const favoriteRelaysRef = useRef(favoriteRelays)
  const blockedRelaysRef = useRef(blockedRelays)
  favoriteRelaysRef.current = favoriteRelays
  blockedRelaysRef.current = blockedRelays
  const useGlobalRelayBootstrapRef = useRef(useGlobalRelayBootstrap)
  useGlobalRelayBootstrapRef.current = useGlobalRelayBootstrap

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const mem = wallCacheByKey.get(cacheKey)
      if (mem && Date.now() - mem.lastUpdated < CACHE_DURATION && refreshToken === 0) {
        setBadges(mem.badges)
        setComments(mem.comments)
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      try {
        const pkNorm = userIdToPubkey(pubkey) || pubkey
        if (!isValidPubkey(pkNorm)) {
          return
        }

        const emptyAuthor = {
          read: [] as string[],
          write: [] as string[],
          httpRead: [] as string[],
          httpWrite: [] as string[]
        }
        const authorRl = await client.peekRelayListFromStorage(pubkey).catch(() => emptyAuthor)
        if (cancelled) return

        const relayUrls = buildProfilePageReadRelayUrls(
          favoriteRelaysRef.current,
          blockedRelaysRef.current,
          authorRl,
          false,
          false,
          [ExtendedKind.COMMENT, ExtendedKind.PROFILE_BADGES_LIST, ExtendedKind.BADGE_DEFINITION],
          useGlobalRelayBootstrapRef.current
        )

        // --- Badges (NIP-58): IndexedDB + profile read relays (favorites / fast-read), not inbox-only ---
        let listEvent = await fetchProfileBadgesListEvent(pkNorm, relayUrls)
        if (!listEvent || !isNip58ProfileBadgesListEvent(listEvent)) {
          const legacy = await fetchLegacyProfileBadgesListEvent(pkNorm, relayUrls)
          if (legacy && isNip58ProfileBadgesListEvent(legacy)) listEvent = legacy
        }

        const entries = parseProfileBadgeEntries(listEvent)
        const defCoords = [...new Set(entries.map((e) => e.definitionCoordinate))]
        const defByCoord = new Map<string, Event | undefined>()

        await Promise.all(
          defCoords.map(async (coord) => {
            defByCoord.set(coord, await fetchBadgeDefinitionOnRelays(coord, relayUrls))
          })
        )

        const resolvedBadges = entries.map((entry) =>
          resolveBadgeDisplayFromDefinition(entry, defByCoord.get(entry.definitionCoordinate))
        )

        // --- Wall comments (kind 1111 on profile kind 0) ---
        let wallComments: Event[] = []
        const profileId = profileEventId?.trim().toLowerCase()
        if (profileId && /^[0-9a-f]{64}$/.test(profileId) && relayUrls.length > 0) {
          const profileCoord = getReplaceableCoordinate(kinds.Metadata, pkNorm, '')
          const filters: Filter[] = [
            { kinds: [ExtendedKind.COMMENT], '#e': [profileId], limit: 200 },
            { kinds: [ExtendedKind.COMMENT], '#a': [profileCoord], limit: 200 }
          ]
          const pool = new Map<string, Event>()
          try {
            const rows = await Promise.all(
              filters.map((filter) =>
                client.fetchEvents(relayUrls, filter, {
                  cache: true,
                  eoseTimeout: 4500,
                  globalTimeout: 14_000,
                  foreground: true
                })
              )
            )
            for (const batch of rows) {
              for (const e of batch) pool.set(e.id, e)
            }
          } catch {
            /* ignore */
          }

          wallComments = [...pool.values()]
            .filter(
              (e) =>
                !isEventDeletedRef.current(e) &&
                isDirectProfileWallComment(e, profileId, pkNorm)
            )
            .sort((a, b) => b.created_at - a.created_at)
        }

        if (cancelled) return
        setBadges(resolvedBadges)
        setComments(wallComments)
        wallCacheByKey.set(cacheKey, {
          badges: resolvedBadges,
          comments: wallComments,
          lastUpdated: Date.now()
        })
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [pubkey, profileEventId, cacheKey, refreshToken, relayListsKey])

  const refresh = useCallback(() => {
    wallCacheByKey.delete(cacheKey)
    setIsLoading(true)
    setRefreshToken((t) => t + 1)
  }, [cacheKey])

  return { badges, comments, isLoading, refresh }
}
