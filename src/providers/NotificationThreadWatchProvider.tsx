import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { buildATag, buildETag, createReplaceablePersonalListDraftEvent } from '@/lib/draft-event'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent, normalizeReplaceableCoordinateString } from '@/lib/event'
import {
  bookmarkListTagsAfterRemovingRef,
  decodePersonalListBech32Ref,
  type TPersonalListBech32Ref
} from '@/lib/personal-list-mutations'
import { fetchLatestReplaceableListEvent } from '@/lib/replaceable-list-latest'
import {
  listTagsAfterRemovingThreadWatchMatches,
  parseThreadWatchListRefs,
  threadWatchMatchesRefs
} from '@/lib/notification-thread-watch'
import logger from '@/lib/logger'
import { ExtendedKind } from '@/constants'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'
import { useCallback, useContext, useEffect, useMemo, useState, createContext, type ReactNode } from 'react'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'

export type TNotificationThreadWatchContext = {
  eventsIFollowListEvent: Event | null
  eventsIMutedListEvent: Event | null
  followRefs: ReturnType<typeof parseThreadWatchListRefs>
  mutedRefs: ReturnType<typeof parseThreadWatchListRefs>
  isFollowedForNotifications: (event: Event) => boolean
  isMutedForNotifications: (event: Event) => boolean
  followThreadForNotifications: (event: Event) => Promise<void>
  muteThreadForNotifications: (event: Event) => Promise<void>
  unfollowThreadForNotifications: (event: Event) => Promise<boolean>
  unmuteThreadForNotifications: (event: Event) => Promise<boolean>
  /** Refetch both lists from relays + IDB and update local state (e.g. settings list editor). */
  refreshNotificationThreadListsFromRelays: () => Promise<void>
  removeFollowRefByBech32: (bech32Id: string) => Promise<boolean>
  removeMuteRefByBech32: (bech32Id: string) => Promise<boolean>
}

const NotificationThreadWatchContext = createContext<TNotificationThreadWatchContext | undefined>(undefined)

function refKeyForEvent(event: Event): TPersonalListBech32Ref {
  if (isReplaceableEvent(event.kind)) {
    const n = normalizeReplaceableCoordinateString(getReplaceableCoordinateFromEvent(event))
    return { aCoordLower: n }
  }
  return { eIdLower: event.id.toLowerCase() }
}

function listTagsWithoutRef(tags: string[][], ref: TPersonalListBech32Ref): string[][] | null {
  return bookmarkListTagsAfterRemovingRef(tags, ref)
}

function mergeTagsPreservingMeta(baseTags: string[][], refTags: string[][]): string[][] {
  const meta = baseTags.filter(
    (t) => t[0] === 'title' || t[0] === 'image' || t[0] === 'description' || t[0] === 'd'
  )
  const seenE = new Set<string>()
  const seenA = new Set<string>()
  const refs: string[][] = []
  const pushRef = (t: string[]) => {
    if (t[0] === 'e' || t[0] === 'E') {
      const id = t[1]?.toLowerCase()
      if (id && !seenE.has(id)) {
        seenE.add(id)
        refs.push(t)
      }
    } else if (t[0] === 'a' || t[0] === 'A') {
      const n = normalizeReplaceableCoordinateString(t[1] ?? '')
      if (n && !seenA.has(n)) {
        seenA.add(n)
        refs.push([t[0], n, ...t.slice(2)])
      }
    }
  }
  for (const t of baseTags) pushRef(t)
  for (const t of refTags) pushRef(t)
  return [...meta, ...refs]
}

export function NotificationThreadWatchProvider({ children }: { children: ReactNode }) {
  const { pubkey: accountPubkey, publish } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [eventsIFollowListEvent, setEventsIFollowListEvent] = useState<Event | null>(null)
  const [eventsIMutedListEvent, setEventsIMutedListEvent] = useState<Event | null>(null)

  const buildComprehensiveRelayList = useCallback(async () => {
    if (!accountPubkey) return [] as string[]
    return buildAccountListRelayUrlsForMerge({
      accountPubkey,
      favoriteRelays: favoriteRelays ?? [],
      blockedRelays
    })
  }, [accountPubkey, favoriteRelays, blockedRelays])

  const hydrateFromStorage = useCallback(async () => {
    if (!accountPubkey) {
      setEventsIFollowListEvent(null)
      setEventsIMutedListEvent(null)
      return
    }
    const pk = accountPubkey.trim().toLowerCase()
    const [fromIdbFollow, fromIdbMuted] = await Promise.all([
      indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST),
      indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST)
    ])
    if (fromIdbFollow) setEventsIFollowListEvent(fromIdbFollow)
    if (fromIdbMuted) setEventsIMutedListEvent(fromIdbMuted)
  }, [accountPubkey])

  const refreshNotificationThreadListsFromRelays = useCallback(async () => {
    if (!accountPubkey) {
      setEventsIFollowListEvent(null)
      setEventsIMutedListEvent(null)
      return
    }
    const urls = await buildComprehensiveRelayList()
    if (!urls.length) {
      await hydrateFromStorage()
      return
    }
    const pk = accountPubkey.trim().toLowerCase()
    const [remoteFollow, remoteMuted] = await Promise.all([
      fetchLatestReplaceableListEvent(pk, ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST, urls),
      fetchLatestReplaceableListEvent(pk, ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST, urls)
    ])
    const [idbFollow, idbMuted] = await Promise.all([
      indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST),
      indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST)
    ])
    const pick = (remote: Event | undefined, idb: Event | null | undefined) => {
      if (remote && idb) return remote.created_at >= idb.created_at ? remote : idb
      return remote ?? idb ?? null
    }
    const f = pick(remoteFollow, idbFollow ?? undefined)
    const m = pick(remoteMuted, idbMuted ?? undefined)
    if (f) {
      await indexedDb.putReplaceableEvent(f)
      setEventsIFollowListEvent(f)
    }
    if (m) {
      await indexedDb.putReplaceableEvent(m)
      setEventsIMutedListEvent(m)
    }
  }, [accountPubkey, buildComprehensiveRelayList, hydrateFromStorage])

  useEffect(() => {
    void hydrateFromStorage()
  }, [hydrateFromStorage])

  useEffect(() => {
    if (!accountPubkey) {
      setEventsIFollowListEvent(null)
      setEventsIMutedListEvent(null)
      return
    }
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await refreshNotificationThreadListsFromRelays()
    })()
    return () => {
      cancelled = true
    }
  }, [accountPubkey, refreshNotificationThreadListsFromRelays])

  const followRefs = useMemo(
    () => parseThreadWatchListRefs(eventsIFollowListEvent),
    [eventsIFollowListEvent]
  )
  const mutedRefs = useMemo(
    () => parseThreadWatchListRefs(eventsIMutedListEvent),
    [eventsIMutedListEvent]
  )

  const isFollowedForNotifications = useCallback(
    (event: Event) => threadWatchMatchesRefs(event, followRefs),
    [followRefs]
  )
  const isMutedForNotifications = useCallback(
    (event: Event) => threadWatchMatchesRefs(event, mutedRefs),
    [mutedRefs]
  )

  const publishList = useCallback(
    async (kind: number, nextTags: string[][], content: string) => {
      if (!accountPubkey) return
      const comprehensiveRelays = await buildComprehensiveRelayList()
      const draft = createReplaceablePersonalListDraftEvent(kind, nextTags, content)
      const ev = await publish(draft, { specifiedRelayUrls: comprehensiveRelays })
      const stored = await indexedDb.putReplaceableEvent(ev)
      if (kind === ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST) {
        setEventsIFollowListEvent(stored)
      } else {
        setEventsIMutedListEvent(stored)
      }
    },
    [accountPubkey, buildComprehensiveRelayList, publish]
  )

  const followThreadForNotifications = useCallback(
    async (event: Event) => {
      if (!accountPubkey) return
      const comprehensiveRelays = await buildComprehensiveRelayList()
      const refTag = isReplaceableEvent(event.kind) ? buildATag(event) : buildETag(event.id, event.pubkey)
      let followEv =
        (await fetchLatestReplaceableListEvent(
          accountPubkey,
          ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST,
          comprehensiveRelays
        )) ?? null
      if (!followEv) {
        followEv =
          (await indexedDb.getReplaceableEvent(
            accountPubkey.trim().toLowerCase(),
            ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST
          )) ?? null
      }
      let mutedEv =
        (await fetchLatestReplaceableListEvent(
          accountPubkey,
          ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST,
          comprehensiveRelays
        )) ?? null
      if (!mutedEv) {
        mutedEv =
          (await indexedDb.getReplaceableEvent(
            accountPubkey.trim().toLowerCase(),
            ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST
          )) ?? null
      }

      const mutedStripped = mutedEv ? listTagsAfterRemovingThreadWatchMatches(mutedEv.tags, event) : null
      if (mutedStripped) {
        await publishList(ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST, mutedStripped, mutedEv.content)
      }

      const curTags = followEv?.tags ?? []
      const curFollowRefs = parseThreadWatchListRefs(followEv)
      if (threadWatchMatchesRefs(event, curFollowRefs)) {
        return
      }
      const next = mergeTagsPreservingMeta(curTags, [refTag])
      await publishList(ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST, next, followEv?.content ?? '')
      logger.component('NotificationThreadWatchProvider', 'follow thread for notifications', {
        kind: event.kind
      })
    },
    [accountPubkey, buildComprehensiveRelayList, publishList]
  )

  const muteThreadForNotifications = useCallback(
    async (event: Event) => {
      if (!accountPubkey) return
      const comprehensiveRelays = await buildComprehensiveRelayList()
      const refTag = isReplaceableEvent(event.kind) ? buildATag(event) : buildETag(event.id, event.pubkey)
      let mutedEv =
        (await fetchLatestReplaceableListEvent(
          accountPubkey,
          ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST,
          comprehensiveRelays
        )) ?? null
      if (!mutedEv) {
        mutedEv =
          (await indexedDb.getReplaceableEvent(
            accountPubkey.trim().toLowerCase(),
            ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST
          )) ?? null
      }
      let followEv =
        (await fetchLatestReplaceableListEvent(
          accountPubkey,
          ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST,
          comprehensiveRelays
        )) ?? null
      if (!followEv) {
        followEv =
          (await indexedDb.getReplaceableEvent(
            accountPubkey.trim().toLowerCase(),
            ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST
          )) ?? null
      }

      const followStripped = followEv ? listTagsAfterRemovingThreadWatchMatches(followEv.tags, event) : null
      if (followStripped) {
        await publishList(ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST, followStripped, followEv.content)
      }

      const curTags = mutedEv?.tags ?? []
      const curMutedRefs = parseThreadWatchListRefs(mutedEv)
      if (threadWatchMatchesRefs(event, curMutedRefs)) {
        return
      }
      const next = mergeTagsPreservingMeta(curTags, [refTag])
      await publishList(ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST, next, mutedEv?.content ?? '')
    },
    [accountPubkey, buildComprehensiveRelayList, publishList]
  )

  const unfollowThreadForNotifications = useCallback(
    async (event: Event): Promise<boolean> => {
      if (!accountPubkey) return false
      const comprehensiveRelays = await buildComprehensiveRelayList()
      let followEv =
        (await fetchLatestReplaceableListEvent(
          accountPubkey,
          ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST,
          comprehensiveRelays
        )) ?? null
      if (!followEv) {
        followEv =
          (await indexedDb.getReplaceableEvent(
            accountPubkey.trim().toLowerCase(),
            ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST
          )) ?? null
      }
      if (!followEv) return false
      const next = listTagsAfterRemovingThreadWatchMatches(followEv.tags, event)
      if (!next) return false
      await publishList(ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST, next, followEv.content)
      return true
    },
    [accountPubkey, buildComprehensiveRelayList, publishList]
  )

  const unmuteThreadForNotifications = useCallback(
    async (event: Event): Promise<boolean> => {
      if (!accountPubkey) return false
      const comprehensiveRelays = await buildComprehensiveRelayList()
      let mutedEv =
        (await fetchLatestReplaceableListEvent(
          accountPubkey,
          ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST,
          comprehensiveRelays
        )) ?? null
      if (!mutedEv) {
        mutedEv =
          (await indexedDb.getReplaceableEvent(
            accountPubkey.trim().toLowerCase(),
            ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST
          )) ?? null
      }
      if (!mutedEv) return false
      const next = listTagsAfterRemovingThreadWatchMatches(mutedEv.tags, event)
      if (!next) return false
      await publishList(ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST, next, mutedEv.content)
      return true
    },
    [accountPubkey, buildComprehensiveRelayList, publishList]
  )

  const removeFollowRefByBech32 = useCallback(
    async (bech32Id: string): Promise<boolean> => {
      const ref = decodePersonalListBech32Ref(bech32Id)
      if (!ref || !accountPubkey) return false
      const comprehensiveRelays = await buildComprehensiveRelayList()
      let followEv =
        (await fetchLatestReplaceableListEvent(
          accountPubkey,
          ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST,
          comprehensiveRelays
        )) ?? null
      if (!followEv) {
        followEv =
          (await indexedDb.getReplaceableEvent(
            accountPubkey.trim().toLowerCase(),
            ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST
          )) ?? null
      }
      if (!followEv) return false
      const next = listTagsWithoutRef(followEv.tags, ref)
      if (!next) return false
      await publishList(ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST, next, followEv.content)
      return true
    },
    [accountPubkey, buildComprehensiveRelayList, publishList]
  )

  const removeMuteRefByBech32 = useCallback(
    async (bech32Id: string): Promise<boolean> => {
      const ref = decodePersonalListBech32Ref(bech32Id)
      if (!ref || !accountPubkey) return false
      const comprehensiveRelays = await buildComprehensiveRelayList()
      let mutedEv =
        (await fetchLatestReplaceableListEvent(
          accountPubkey,
          ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST,
          comprehensiveRelays
        )) ?? null
      if (!mutedEv) {
        mutedEv =
          (await indexedDb.getReplaceableEvent(
            accountPubkey.trim().toLowerCase(),
            ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST
          )) ?? null
      }
      if (!mutedEv) return false
      const next = listTagsWithoutRef(mutedEv.tags, ref)
      if (!next) return false
      await publishList(ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST, next, mutedEv.content)
      return true
    },
    [accountPubkey, buildComprehensiveRelayList, publishList]
  )

  const value = useMemo(
    () => ({
      eventsIFollowListEvent,
      eventsIMutedListEvent,
      followRefs,
      mutedRefs,
      isFollowedForNotifications,
      isMutedForNotifications,
      followThreadForNotifications,
      muteThreadForNotifications,
      unfollowThreadForNotifications,
      unmuteThreadForNotifications,
      refreshNotificationThreadListsFromRelays,
      removeFollowRefByBech32,
      removeMuteRefByBech32
    }),
    [
      eventsIFollowListEvent,
      eventsIMutedListEvent,
      followRefs,
      mutedRefs,
      isFollowedForNotifications,
      isMutedForNotifications,
      followThreadForNotifications,
      muteThreadForNotifications,
      unfollowThreadForNotifications,
      unmuteThreadForNotifications,
      refreshNotificationThreadListsFromRelays,
      removeFollowRefByBech32,
      removeMuteRefByBech32
    ]
  )

  return (
    <NotificationThreadWatchContext.Provider value={value}>{children}</NotificationThreadWatchContext.Provider>
  )
}

export function useNotificationThreadWatch(): TNotificationThreadWatchContext {
  const ctx = useContext(NotificationThreadWatchContext)
  if (!ctx) {
    throw new Error('useNotificationThreadWatch must be used within NotificationThreadWatchProvider')
  }
  return ctx
}

export function useNotificationThreadWatchOptional(): TNotificationThreadWatchContext | undefined {
  return useContext(NotificationThreadWatchContext)
}
