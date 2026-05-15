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
  eventHasExactNotificationThreadWatchRef,
  parseThreadWatchListRefs
} from '@/lib/notification-thread-watch'
import logger from '@/lib/logger'
import { ExtendedKind } from '@/constants'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  type ReactNode
} from 'react'
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
  const { pubkey: accountPubkey, publish, signEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [eventsIFollowListEvent, setEventsIFollowListEvent] = useState<Event | null>(null)
  const [eventsIMutedListEvent, setEventsIMutedListEvent] = useState<Event | null>(null)
  /** Same as state, updated during render so async handlers never read a stale list before effects run. */
  const eventsIFollowListEventRef = useRef<Event | null>(null)
  const eventsIMutedListEventRef = useRef<Event | null>(null)
  eventsIFollowListEventRef.current = eventsIFollowListEvent
  eventsIMutedListEventRef.current = eventsIMutedListEvent

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
    if (f) await indexedDb.putReplaceableEvent(f)
    if (m) await indexedDb.putReplaceableEvent(m)
    setEventsIFollowListEvent(f ?? null)
    setEventsIMutedListEvent(m ?? null)
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
    (event: Event) => eventHasExactNotificationThreadWatchRef(event, followRefs),
    [followRefs]
  )
  const isMutedForNotifications = useCallback(
    (event: Event) => eventHasExactNotificationThreadWatchRef(event, mutedRefs),
    [mutedRefs]
  )

  const relayPublishList = useCallback(
    async (kind: number, nextTags: string[][], content: string) => {
      if (!accountPubkey) throw new Error('Not logged in')
      const comprehensiveRelays = await buildComprehensiveRelayList()
      const draft = createReplaceablePersonalListDraftEvent(kind, nextTags, content)
      const ev = await publish(draft, { specifiedRelayUrls: comprehensiveRelays })
      const stored = await indexedDb.putReplaceableEvent(ev)
      if (kind === ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST) {
        setEventsIFollowListEvent(stored)
      } else {
        setEventsIMutedListEvent(stored)
      }
      return stored
    },
    [accountPubkey, buildComprehensiveRelayList, publish]
  )

  const signApplyListLocal = useCallback(
    async (kind: number, nextTags: string[][], content: string): Promise<Event> => {
      const draft = createReplaceablePersonalListDraftEvent(kind, nextTags, content)
      const ev = await signEvent(draft)
      if (kind === ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST) {
        setEventsIFollowListEvent(ev)
      } else {
        setEventsIMutedListEvent(ev)
      }
      void indexedDb.putReplaceableEvent(ev).catch((err) =>
        logger.warn('NotificationThreadWatchProvider: optimistic IndexedDB write failed', { err })
      )
      return ev
    },
    [signEvent]
  )

  const restoreListSnapshots = useCallback(async (snapFollow: Event | null, snapMuted: Event | null) => {
    setEventsIFollowListEvent(snapFollow)
    setEventsIMutedListEvent(snapMuted)
    try {
      await Promise.all([
        snapFollow ? indexedDb.putReplaceableEvent(snapFollow) : Promise.resolve(),
        snapMuted ? indexedDb.putReplaceableEvent(snapMuted) : Promise.resolve()
      ])
    } catch (err) {
      logger.warn('NotificationThreadWatchProvider: rollback IndexedDB write failed', { err })
    }
  }, [])

  const followThreadForNotifications = useCallback(
    async (event: Event) => {
      if (!accountPubkey) return
      const prevF = eventsIFollowListEventRef.current
      const prevM = eventsIMutedListEventRef.current
      const snapF = prevF
      const snapM = prevM

      const refTag = isReplaceableEvent(event.kind) ? buildATag(event) : buildETag(event.id, event.pubkey)
      const ref = refKeyForEvent(event)

      const mutedStripped = prevM ? listTagsWithoutRef(prevM.tags, ref) : null

      const curFollowRefs = parseThreadWatchListRefs(prevF)
      if (eventHasExactNotificationThreadWatchRef(event, curFollowRefs)) {
        if (prevF) {
          try {
            await indexedDb.putReplaceableEvent(prevF)
          } catch {
            /* ignore */
          }
          setEventsIFollowListEvent(prevF)
        }
        return
      }

      const nextFollowTags = mergeTagsPreservingMeta(prevF?.tags ?? [], [refTag])
      const followContent = prevF?.content ?? ''

      try {
        if (mutedStripped && prevM) {
          await signApplyListLocal(
            ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST,
            mutedStripped,
            prevM.content
          )
        }
        await signApplyListLocal(
          ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST,
          nextFollowTags,
          followContent
        )

        if (mutedStripped && prevM) {
          await relayPublishList(
            ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST,
            mutedStripped,
            prevM.content
          )
        }
        await relayPublishList(
          ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST,
          nextFollowTags,
          followContent
        )
        logger.component('NotificationThreadWatchProvider', 'follow thread for notifications', {
          kind: event.kind
        })
      } catch (e) {
        await restoreListSnapshots(snapF, snapM)
        throw e
      }
    },
    [accountPubkey, relayPublishList, restoreListSnapshots, signApplyListLocal]
  )

  const muteThreadForNotifications = useCallback(
    async (event: Event) => {
      if (!accountPubkey) return
      const prevF = eventsIFollowListEventRef.current
      const prevM = eventsIMutedListEventRef.current
      const snapF = prevF
      const snapM = prevM

      const refTag = isReplaceableEvent(event.kind) ? buildATag(event) : buildETag(event.id, event.pubkey)
      const ref = refKeyForEvent(event)

      const followStripped = prevF ? listTagsWithoutRef(prevF.tags, ref) : null

      const curMutedRefs = parseThreadWatchListRefs(prevM)
      if (eventHasExactNotificationThreadWatchRef(event, curMutedRefs)) {
        if (prevM) {
          try {
            await indexedDb.putReplaceableEvent(prevM)
          } catch {
            /* ignore */
          }
          setEventsIMutedListEvent(prevM)
        }
        return
      }

      const nextMutedTags = mergeTagsPreservingMeta(prevM?.tags ?? [], [refTag])
      const mutedContent = prevM?.content ?? ''

      try {
        if (followStripped && prevF) {
          await signApplyListLocal(
            ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST,
            followStripped,
            prevF.content
          )
        }
        await signApplyListLocal(
          ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST,
          nextMutedTags,
          mutedContent
        )

        if (followStripped && prevF) {
          await relayPublishList(
            ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST,
            followStripped,
            prevF.content
          )
        }
        await relayPublishList(
          ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST,
          nextMutedTags,
          mutedContent
        )
      } catch (e) {
        await restoreListSnapshots(snapF, snapM)
        throw e
      }
    },
    [accountPubkey, relayPublishList, restoreListSnapshots, signApplyListLocal]
  )

  const unfollowThreadForNotifications = useCallback(
    async (event: Event): Promise<boolean> => {
      if (!accountPubkey) return false
      const pk = accountPubkey.trim().toLowerCase()
      let prevF =
        eventsIFollowListEventRef.current ??
        (await indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST))
      if (!prevF) return false
      const next = listTagsWithoutRef(prevF.tags, refKeyForEvent(event))
      if (!next) return false
      const snapF = prevF
      const snapM = eventsIMutedListEventRef.current
      try {
        await signApplyListLocal(ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST, next, prevF.content)
        await relayPublishList(ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST, next, prevF.content)
        return true
      } catch (e) {
        await restoreListSnapshots(snapF, snapM)
        throw e
      }
    },
    [accountPubkey, relayPublishList, restoreListSnapshots, signApplyListLocal]
  )

  const unmuteThreadForNotifications = useCallback(
    async (event: Event): Promise<boolean> => {
      if (!accountPubkey) return false
      const pk = accountPubkey.trim().toLowerCase()
      let prevM =
        eventsIMutedListEventRef.current ??
        (await indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST))
      if (!prevM) return false
      const next = listTagsWithoutRef(prevM.tags, refKeyForEvent(event))
      if (!next) return false
      const snapF = eventsIFollowListEventRef.current
      const snapM = prevM
      try {
        await signApplyListLocal(ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST, next, prevM.content)
        await relayPublishList(ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST, next, prevM.content)
        return true
      } catch (e) {
        await restoreListSnapshots(snapF, snapM)
        throw e
      }
    },
    [accountPubkey, relayPublishList, restoreListSnapshots, signApplyListLocal]
  )

  const removeFollowRefByBech32 = useCallback(
    async (bech32Id: string): Promise<boolean> => {
      const ref = decodePersonalListBech32Ref(bech32Id)
      if (!ref || !accountPubkey) return false
      const pk = accountPubkey.trim().toLowerCase()
      let followEv =
        eventsIFollowListEventRef.current ??
        (await indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST))
      if (!followEv) return false
      const next = listTagsWithoutRef(followEv.tags, ref)
      if (!next) return false
      const snapF = followEv
      const snapM = eventsIMutedListEventRef.current
      try {
        await signApplyListLocal(ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST, next, followEv.content)
        await relayPublishList(ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST, next, followEv.content)
        return true
      } catch (e) {
        await restoreListSnapshots(snapF, snapM)
        throw e
      }
    },
    [accountPubkey, relayPublishList, restoreListSnapshots, signApplyListLocal]
  )

  const removeMuteRefByBech32 = useCallback(
    async (bech32Id: string): Promise<boolean> => {
      const ref = decodePersonalListBech32Ref(bech32Id)
      if (!ref || !accountPubkey) return false
      const pk = accountPubkey.trim().toLowerCase()
      let mutedEv =
        eventsIMutedListEventRef.current ??
        (await indexedDb.getReplaceableEvent(pk, ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST))
      if (!mutedEv) return false
      const next = listTagsWithoutRef(mutedEv.tags, ref)
      if (!next) return false
      const snapF = eventsIFollowListEventRef.current
      const snapM = mutedEv
      try {
        await signApplyListLocal(ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST, next, mutedEv.content)
        await relayPublishList(ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST, next, mutedEv.content)
        return true
      } catch (e) {
        await restoreListSnapshots(snapF, snapM)
        throw e
      }
    },
    [accountPubkey, relayPublishList, restoreListSnapshots, signApplyListLocal]
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
