import {
  ExtendedKind,
  METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
  METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS
} from '@/constants'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import { appendMoneroNostrRelays } from '@/lib/monero-nostr-relays'
import { getReplaceableCoordinate } from '@/lib/event'
import {
  fetchLegacyProfileBadgesListEvent,
  fetchProfileBadgesListEvent,
  hydrateProfileBadgesFromLocalCache
} from '@/lib/nip58-profile-badges-list'
import {
  isNip58ProfileBadgesListEvent,
  parseAddressableCoordinate,
  parseProfileBadgeEntries,
  resolveBadgeDisplayFromDefinition,
  type ResolvedProfileBadge
} from '@/lib/nip58-profile-badges'
import { isDirectProfileWallComment } from '@/lib/profile-wall-comments'
import {
  buildAttestedPaymentIdSet,
  filterAttestedProfileWallSuperchats,
  getPaymentAttestationTargetId
} from '@/lib/superchat'
import {
  hydrateAttestedSuperchatTargetEvents,
  mergeAttestedPaymentIdSets,
  resolveAttestedPaymentIdSet,
  resolveAttestedPaymentIdSetSync
} from '@/lib/payment-attestation-cache'
import { isValidPubkey, userIdToPubkey } from '@/lib/pubkey'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import type { TSubRequestFilter } from '@/types'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import client, { replaceableEventService } from '@/services/client.service'
import { ReplaceableEventService } from '@/services/client-replaceable-events.service'
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

function normalizeProfileEventId(profileEventId: string | undefined): string | undefined {
  const id = profileEventId?.trim().toLowerCase()
  return id && /^[0-9a-f]{64}$/.test(id) ? id : undefined
}

function buildProfileWallSuperchatFilters(pkNorm: string, profileId: string | undefined): Filter[] {
  const filters: Filter[] = [
    { kinds: [ExtendedKind.PAYMENT_NOTIFICATION], '#p': [pkNorm], limit: 200 },
    { kinds: [kinds.Zap], '#p': [pkNorm], limit: 200 },
    { kinds: [ExtendedKind.MONERO_TIP_DISCLOSURE], '#p': [pkNorm], limit: 200 },
    { kinds: [ExtendedKind.MONERO_TIP_RECEIPT], '#p': [pkNorm], limit: 200 },
    { kinds: [ExtendedKind.PAYMENT_ATTESTATION], authors: [pkNorm], limit: 500 }
  ]
  if (profileId) {
    const profileCoord = getReplaceableCoordinate(kinds.Metadata, pkNorm, '')
    filters.unshift(
      { kinds: [ExtendedKind.COMMENT], '#e': [profileId], limit: 200 },
      { kinds: [ExtendedKind.COMMENT], '#a': [profileCoord], limit: 200 }
    )
    filters.push(
      { kinds: [ExtendedKind.PAYMENT_NOTIFICATION], '#e': [profileId], limit: 200 },
      { kinds: [ExtendedKind.PAYMENT_NOTIFICATION], '#a': [profileCoord], limit: 200 },
      { kinds: [kinds.Zap], '#e': [profileId], limit: 200 },
      { kinds: [ExtendedKind.MONERO_TIP_DISCLOSURE], '#e': [profileId], limit: 200 },
      { kinds: [ExtendedKind.MONERO_TIP_RECEIPT], '#e': [profileId], limit: 200 }
    )
  }
  return filters
}

/** IndexedDB + session only — no relay REQ (profile wall must paint immediately when cached). */
async function hydrateProfileWallSuperchatsFromLocalCache(
  pkNorm: string,
  profileEventId: string | undefined,
  isEventDeleted: (event: Event) => boolean
): Promise<Event[]> {
  if (!isValidPubkey(pkNorm)) return []

  const profileId = normalizeProfileEventId(profileEventId)
  const pool = new Map<string, Event>()

  try {
    for (const e of await indexedDb.getPaymentNotificationsForRecipient(pkNorm, 200)) {
      pool.set(e.id, e)
    }
  } catch {
    /* optional */
  }

  if (profileId) {
    try {
      for (const e of await indexedDb.getPaymentNotificationsForReferencedEvent(profileId, 200)) {
        pool.set(e.id, e)
      }
    } catch {
      /* optional */
    }
    try {
      const profileCoord = getReplaceableCoordinate(kinds.Metadata, pkNorm, '')
      for (const e of await indexedDb.getPaymentNotificationsForReferencedCoordinate(profileCoord, 200)) {
        pool.set(e.id, e)
      }
    } catch {
      /* optional */
    }
  }

  try {
    for (const e of await indexedDb.getPaymentAttestationsForAuthor(pkNorm, 500)) {
      pool.set(e.id, e)
    }
  } catch {
    /* optional */
  }

  const filters = buildProfileWallSuperchatFilters(pkNorm, profileId)
  try {
    for (const e of await indexedDb.getPaymentSuperchatEventsMatchingFilters(filters, 800)) {
      pool.set(e.id, e)
    }
  } catch {
    /* optional */
  }
  try {
    const localMatches = await client.getLocalFeedEvents(
      filters.map((filter) => ({ urls: [], filter: filter as TSubRequestFilter })),
      { maxMatches: 800 }
    )
    for (const e of localMatches) pool.set(e.id, e)
  } catch {
    /* optional */
  }

  const attestations = [...pool.values()].filter((e) => e.kind === ExtendedKind.PAYMENT_ATTESTATION)
  const attestedIds = mergeAttestedPaymentIdSets(
    resolveAttestedPaymentIdSetSync(pkNorm),
    buildAttestedPaymentIdSet(attestations, pkNorm)
  )
  for (const e of await hydrateAttestedSuperchatTargetEvents(attestedIds, [])) {
    pool.set(e.id, e)
  }
  const fullAttestedIds = await resolveAttestedPaymentIdSet(pkNorm, attestations)
  for (const e of await hydrateAttestedSuperchatTargetEvents(fullAttestedIds, [])) {
    pool.set(e.id, e)
  }

  const paymentEvents = [...pool.values()].filter(
    (e) =>
      (e.kind === ExtendedKind.PAYMENT_NOTIFICATION ||
        e.kind === kinds.Zap ||
        e.kind === ExtendedKind.ZAP_RECEIPT ||
        e.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
        e.kind === ExtendedKind.MONERO_TIP_RECEIPT) &&
      !isEventDeleted(e)
  )

  return filterAttestedProfileWallSuperchats(
    paymentEvents,
    attestations,
    pkNorm,
    profileId,
    fullAttestedIds
  )
}

async function hydrateProfileWallFromLocalCache(
  pkNorm: string,
  profileEventId: string | undefined,
  isEventDeleted: (event: Event) => boolean
): Promise<{ badges: ResolvedProfileBadge[]; superchats: Event[] }> {
  const [badges, superchats] = await Promise.all([
    hydrateProfileBadgesFromLocalCache(pkNorm),
    hydrateProfileWallSuperchatsFromLocalCache(pkNorm, profileEventId, isEventDeleted)
  ])
  return { badges, superchats }
}

const wallCacheByKey = new Map<
  string,
  { badges: ResolvedProfileBadge[]; comments: Event[]; superchats: Event[]; lastUpdated: number }
>()

const wallRefreshListenersByPubkey = new Map<string, Set<() => void>>()

function normalizeWallRefreshPubkey(pubkey: string): string | null {
  const pk = (userIdToPubkey(pubkey) || pubkey).trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(pk) ? pk : null
}

/** Invalidate in-memory wall cache and schedule a re-fetch when a profile wall hook is mounted. */
export function requestProfileWallRefresh(pubkey: string): void {
  const pk = normalizeWallRefreshPubkey(pubkey)
  if (!pk) return
  for (const key of wallCacheByKey.keys()) {
    if (key.startsWith(`${pk}-`) || key.startsWith(`${pubkey.trim().toLowerCase()}-`)) {
      wallCacheByKey.delete(key)
    }
  }
  const listeners = wallRefreshListenersByPubkey.get(pk)
  if (!listeners?.size) return
  for (const listener of listeners) listener()
}

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
  const hasUsefulWallCache =
    !!cached &&
    (cached.badges.length > 0 || (cached.superchats?.length ?? 0) > 0) &&
    Date.now() - cached.lastUpdated < CACHE_DURATION

  const pkNormForHydrate = useMemo(() => userIdToPubkey(pubkey) || pubkey, [pubkey])
  const [badges, setBadges] = useState<ResolvedProfileBadge[]>(
    hasUsefulWallCache ? cached!.badges : []
  )
  const [comments, setComments] = useState<Event[]>(hasUsefulWallCache ? cached!.comments : [])
  const [superchats, setSuperchats] = useState<Event[]>(hasUsefulWallCache ? (cached!.superchats ?? []) : [])
  const [isLoading, setIsLoading] = useState(!hasUsefulWallCache)
  const [refreshToken, setRefreshToken] = useState(0)
  const badgesRef = useRef(badges)
  const superchatsRef = useRef(superchats)
  badgesRef.current = badges
  superchatsRef.current = superchats

  const setLoadingUnlessWallVisible = useCallback(() => {
    setIsLoading(badgesRef.current.length === 0 && superchatsRef.current.length === 0)
  }, [])

  const applyLocalWallHydrate = useCallback(
    (local: { badges: ResolvedProfileBadge[]; superchats: Event[] }) => {
      if (local.badges.length > 0) {
        setBadges((prev) => (prev.length > 0 ? prev : local.badges))
      }
      if (local.superchats.length > 0) {
        setSuperchats((prev) => (prev.length > 0 ? prev : local.superchats))
      }
      if (local.badges.length > 0 || local.superchats.length > 0) {
        setIsLoading(false)
      }
    },
    []
  )

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
  const runGenRef = useRef(0)
  const manualRefreshBumpScheduledRef = useRef(false)
  const relayListsKeyRef = useRef(relayListsKey)

  const bumpWallRefetch = useCallback(() => {
    wallCacheByKey.delete(cacheKey)
    queueMicrotask(() => {
      setLoadingUnlessWallVisible()
      setRefreshToken((t) => t + 1)
    })
  }, [cacheKey, setLoadingUnlessWallVisible])

  const scheduleManualWallRefetch = useCallback(() => {
    if (manualRefreshBumpScheduledRef.current) return
    manualRefreshBumpScheduledRef.current = true
    wallCacheByKey.delete(cacheKey)
    queueMicrotask(() => {
      manualRefreshBumpScheduledRef.current = false
      setLoadingUnlessWallVisible()
      setRefreshToken((t) => t + 1)
    })
  }, [cacheKey, setLoadingUnlessWallVisible])

  useEffect(() => {
    if (!isValidPubkey(pkNormForHydrate)) return
    let cancelled = false
    void hydrateProfileWallFromLocalCache(
      pkNormForHydrate,
      profileEventId,
      isEventDeletedRef.current
    ).then((local) => {
      if (cancelled) return
      applyLocalWallHydrate(local)
    })
    return () => {
      cancelled = true
    }
  }, [pkNormForHydrate, profileEventId, applyLocalWallHydrate])

  useEffect(() => {
    const pk = normalizeWallRefreshPubkey(pkNormForHydrate)
    if (!pk) return

    const onWallPaymentEvent = (data: globalThis.Event) => {
      const evt = (data as CustomEvent<Event>).detail
      if (!evt) return
      if (evt.kind === ExtendedKind.PAYMENT_ATTESTATION) {
        if (evt.pubkey.toLowerCase() !== pk) return
        if (!getPaymentAttestationTargetId(evt)) return
      } else if (evt.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
        const recipient = evt.tags.find((t) => t[0] === 'p')?.[1]
        if (!recipient || recipient.toLowerCase() !== pk) return
      } else {
        return
      }
      bumpWallRefetch()
    }

    client.addEventListener('newEvent', onWallPaymentEvent)

    const listeners = wallRefreshListenersByPubkey.get(pk) ?? new Set()
    listeners.add(scheduleManualWallRefetch)
    wallRefreshListenersByPubkey.set(pk, listeners)

    const onAuthorReplaceablesRefreshed: EventListener = (domEvt) => {
      const detailPk = (domEvt as CustomEvent<{ pubkey?: string }>).detail?.pubkey?.toLowerCase()
      if (detailPk !== pk) return
      bumpWallRefetch()
    }
    window.addEventListener(
      ReplaceableEventService.AUTHOR_REPLACEABLES_REFRESHED_EVENT,
      onAuthorReplaceablesRefreshed
    )
    return () => {
      client.removeEventListener('newEvent', onWallPaymentEvent)
      listeners.delete(scheduleManualWallRefetch)
      if (listeners.size === 0) {
        wallRefreshListenersByPubkey.delete(pk)
      }
      window.removeEventListener(
        ReplaceableEventService.AUTHOR_REPLACEABLES_REFRESHED_EVENT,
        onAuthorReplaceablesRefreshed
      )
    }
  }, [pkNormForHydrate, scheduleManualWallRefetch, bumpWallRefetch])

  useEffect(() => {
    if (relayListsKeyRef.current === relayListsKey) return
    relayListsKeyRef.current = relayListsKey
    bumpWallRefetch()
  }, [relayListsKey, bumpWallRefetch])

  useEffect(() => {
    let cancelled = false
    const runGen = ++runGenRef.current

    const run = async () => {
      const mem = wallCacheByKey.get(cacheKey)
      // Do not reuse empty cache (transient abort when secondary panel opens used to cache [] for 5m).
      if (
        mem &&
        (mem.badges.length > 0 || (mem.superchats?.length ?? 0) > 0) &&
        Date.now() - mem.lastUpdated < CACHE_DURATION &&
        refreshToken === 0
      ) {
        if (runGen === runGenRef.current) {
          setBadges((prev) => (prev === mem.badges ? prev : mem.badges))
          setComments((prev) => (prev === mem.comments ? prev : mem.comments))
          setSuperchats((prev) => (prev === (mem.superchats ?? []) ? prev : (mem.superchats ?? [])))
          setIsLoading((prev) => (prev ? false : prev))
        }
        return
      }
      if (mem?.badges.length === 0) {
        wallCacheByKey.delete(cacheKey)
      }

      try {
        const pkNorm = userIdToPubkey(pubkey) || pubkey
        if (!isValidPubkey(pkNorm)) {
          if (!cancelled && runGen === runGenRef.current) setIsLoading(false)
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

        const relayUrls = appendMoneroNostrRelays(
          buildProfilePageReadRelayUrls(
            favoriteRelaysRef.current,
            blockedRelaysRef.current,
            authorRl,
            false,
            false,
            [
              ExtendedKind.COMMENT,
              ExtendedKind.PROFILE_BADGES_LIST,
              ExtendedKind.BADGE_DEFINITION,
              ExtendedKind.PAYMENT_NOTIFICATION,
              ExtendedKind.PAYMENT_ATTESTATION,
              ExtendedKind.MONERO_TIP_DISCLOSURE,
              ExtendedKind.MONERO_TIP_RECEIPT
            ],
            useGlobalRelayBootstrapRef.current
          )
        )

        const localWall = await hydrateProfileWallFromLocalCache(
          pkNorm,
          profileEventId,
          isEventDeletedRef.current
        )
        if (!cancelled) {
          applyLocalWallHydrate(localWall)
          if (localWall.badges.length === 0 && localWall.superchats.length === 0) {
            setIsLoading(true)
          }
        }

        // --- Badges (NIP-58): IndexedDB first; relay refresh may upgrade list/definitions ---
        let listEvent = await fetchProfileBadgesListEvent(pkNorm, relayUrls, {
          foreground: true,
          cacheFirst: true
        })
        if (!listEvent || !isNip58ProfileBadgesListEvent(listEvent)) {
          const legacy = await fetchLegacyProfileBadgesListEvent(pkNorm, relayUrls, {
            cacheFirst: true
          })
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

        if (cancelled) return
        if (resolvedBadges.length > 0 || localWall.badges.length === 0) {
          setBadges(resolvedBadges)
        }

        // --- Wall comments (kind 1111) and attested superchats (9735 / 9740 + 9741) ---
        let wallComments: Event[] = []
        let wallSuperchats: Event[] = localWall.superchats
        const profileId = normalizeProfileEventId(profileEventId)
        const filters = buildProfileWallSuperchatFilters(pkNorm, profileId)
        const pool = new Map<string, Event>()

        for (const e of localWall.superchats) pool.set(e.id, e)
        try {
          for (const e of await indexedDb.getPaymentNotificationsForRecipient(pkNorm, 200)) {
            pool.set(e.id, e)
          }
        } catch {
          /* optional */
        }
        try {
          for (const e of await indexedDb.getPaymentAttestationsForAuthor(pkNorm, 500)) {
            pool.set(e.id, e)
          }
        } catch {
          /* optional */
        }
        try {
          for (const e of await indexedDb.getPaymentSuperchatEventsMatchingFilters(filters, 800)) {
            pool.set(e.id, e)
          }
        } catch {
          /* optional */
        }
        try {
          const localMatches = await client.getLocalFeedEvents(
            filters.map((filter) => ({ urls: [], filter: filter as TSubRequestFilter })),
            { maxMatches: 800 }
          )
          for (const e of localMatches) pool.set(e.id, e)
        } catch {
          /* optional */
        }

        if (relayUrls.length > 0) {
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
            /* optional */
          }
        }

        const attestations = [...pool.values()].filter(
          (e) => e.kind === ExtendedKind.PAYMENT_ATTESTATION
        )
        let attestedIds = mergeAttestedPaymentIdSets(
          resolveAttestedPaymentIdSetSync(pkNorm),
          buildAttestedPaymentIdSet(attestations, pkNorm)
        )
        for (const e of await hydrateAttestedSuperchatTargetEvents(attestedIds, relayUrls, {
          foreground: true
        })) {
          pool.set(e.id, e)
        }
        attestedIds = await resolveAttestedPaymentIdSet(pkNorm, attestations)
        for (const e of await hydrateAttestedSuperchatTargetEvents(attestedIds, relayUrls, {
          foreground: true
        })) {
          pool.set(e.id, e)
        }

        if (profileId) {
          wallComments = [...pool.values()]
            .filter(
              (e) =>
                e.kind === ExtendedKind.COMMENT &&
                !isEventDeletedRef.current(e) &&
                isDirectProfileWallComment(e, profileId, pkNorm)
            )
            .sort((a, b) => b.created_at - a.created_at)
        }

        const paymentEvents = [...pool.values()].filter(
          (e) =>
            (e.kind === ExtendedKind.PAYMENT_NOTIFICATION ||
              e.kind === kinds.Zap ||
              e.kind === ExtendedKind.ZAP_RECEIPT ||
              e.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
              e.kind === ExtendedKind.MONERO_TIP_RECEIPT) &&
            !isEventDeletedRef.current(e)
        )
        wallSuperchats = filterAttestedProfileWallSuperchats(
          paymentEvents,
          attestations,
          pkNorm,
          profileId,
          attestedIds
        )

        if (cancelled) return
        setComments(wallComments)
        setSuperchats(wallSuperchats)
        if (resolvedBadges.length > 0 || wallComments.length > 0 || wallSuperchats.length > 0) {
          wallCacheByKey.set(cacheKey, {
            badges: resolvedBadges,
            comments: wallComments,
            superchats: wallSuperchats,
            lastUpdated: Date.now()
          })
        } else {
          wallCacheByKey.delete(cacheKey)
        }
      } finally {
        if (!cancelled && runGen === runGenRef.current) setIsLoading(false)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [pubkey, profileEventId, cacheKey, refreshToken, applyLocalWallHydrate])

  const refresh = useCallback(() => {
    scheduleManualWallRefetch()
  }, [scheduleManualWallRefetch])

  return { badges, comments, superchats, isLoading, refresh }
}
