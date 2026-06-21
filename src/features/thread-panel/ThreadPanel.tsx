import { ExtendedKind } from '@/constants'
import {
  getParentETag,
  isMentioningMutedUsers,
  isNip18RepostKind
} from '@/lib/event'
import logger from '@/lib/logger'
import activityTrace from '@/lib/activity-trace'
import {
  isNestedThreadReplyParentKind,
  isSuperchatKind
} from '@/lib/superchat'
import { muteSetHas } from '@/lib/mute-set'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { shouldHideThreadResponseEvent } from '@/lib/thread-response-filter'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { toNote } from '@/lib/link'
import { generateBech32IdFromETag } from '@/lib/tag'
import { useSmartNoteNavigation } from '@/PageManager'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import storage from '@/services/local-storage.service'
import { useMuteList } from '@/contexts/mute-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { useDeletedEventSafe } from '@/providers/DeletedEventProvider'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import {
  NoteFeedProfileContext,
  type NoteFeedProfileContextValue,
  useNoteFeedProfileContext
} from '@/providers/NoteFeedProfileContext'
import client, { eventService, queryService } from '@/services/client.service'
import { resolveLocalEventsByHexIds } from '@/lib/local-event-resolve'
import noteStatsService from '@/services/note-stats.service'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { collectProfilePubkeysFromEvents } from '@/lib/profile-batch-coordinator'
import { buildReplyReadRelayList, relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { appendMoneroNostrRelays } from '@/lib/monero-nostr-relays'
import { buildThreadInteractionFilters, buildThreadSuperchatPriorityFilters } from '@/lib/thread-interaction-req'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import {
  buildRssWebNostrQueryRelayUrls,
  isRssArticleUrlThreadInteraction
} from '@/lib/rss-web-feed'
import type { TProfile } from '@/types'
import { Filter, Event as NEvent, kinds } from 'nostr-tools'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingBar } from '@/components/LoadingBar'
import ReplyNote, { ReplyNoteSkeleton } from '@/components/ReplyNote'
import ThreadQuoteBacklink, { BacklinkAvatarStrip } from './components/ThreadQuoteBacklink'
import threadPanelCache from './thread-panel-cache'
import {
  MAX_PARENT_IDS_PER_NESTED_REQ,
  THREAD_PROFILE_BATCH_DEBOUNCE_MS,
  THREAD_PROFILE_CHUNK,
  THREAD_REPLY_LIMIT,
  THREAD_REPLY_SHOW_COUNT
} from './constants'
import {
  backlinkRunSectionClass,
  buildNoteStatsReplyIdSet,
  buildRepliesListAlignedWithNoteStats,
  fetchPaymentAttestationsForRecipient,
  hydrateThreadRepliesFromStats,
  isPollVoteKind,
  loadThreadRepliesFromLocalStores,
  mergeFetchedKind7ReactionsIntoRootNoteStats,
  openNoteHexId,
  replyIdPresentInRepliesMap,
  replyMatchesThreadForList,
  seedThreadWalkFromLocalContext,
  shouldIncludeSuperchatInThreadReply,
  threadBacklinkRelationLabel,
  threadResponseFilterOptions,
  type TThreadFeedItem
} from './thread-panel-utils'
import {
  buildThreadPanelDisplayRows,
  buildThreadPanelMergedFeed,
  buildThreadPanelQuoteUiIdSet,
  buildThreadPanelReplies,
  buildThreadPanelStatsMissingPartition,
  buildThreadPanelVisibleFeed,
  isDiscussionThreadRoot
} from './buildThreadPanelView'
import MissingThreadReply from './components/MissingThreadReply'
import { useThreadRootInfo } from './useThreadRootInfo'
import { useThreadAttestedPayments } from './thread-attested-payments'
import { useThreadPanelStore } from './useThreadPanel'
import { ThreadPanelEngine } from './ThreadPanelEngine'
import { ThreadPanelProvider } from './ThreadPanelContext'

function ThreadPanel({
  index: _pageIndex,
  event,
  sort = 'oldest',
  showQuotes = true,
  duplicateWebPreviewCleanedUrlHints,
  statsForeground = false,
  refreshToken = 0,
  singleRelayAuthoritativeRead
}: {
  index?: number
  event: NEvent
  sort?: 'newest' | 'oldest' | 'top' | 'controversial' | 'most-zapped'
  /** When false, omit the quotes section (e.g. discussion threads). */
  showQuotes?: boolean
  /** Suppress WebPreview for these URLs in replies (e.g. article URL already shown as OP). */
  duplicateWebPreviewCleanedUrlHints?: string[]
  /** Passed through to reply row `NoteStats` on note & article pages. */
  statsForeground?: boolean
  /** Bump to force the relay reply scan to run again. */
  refreshToken?: number
  /** Explore single-relay: only query the active browsing relay (see `useCurrentRelays`). */
  singleRelayAuthoritativeRead?: boolean
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const noteStats = useNoteStatsById(event.id)
  const { mutePubkeySet } = useMuteList()
  const hideContentMentioningMutedUsers =
    useContentPolicyOptional()?.hideContentMentioningMutedUsers ??
    storage.getHideContentMentioningMutedUsers()
  const { pubkey: userPubkey } = useNostr()
  const { isEventDeleted, tombstoneEpoch } = useDeletedEventSafe()
  const { blockedRelays, favoriteRelays } = useFavoriteRelays()
  const { relayUrls: browsingRelayUrls } = useCurrentRelays()
  const relayAuthoritativeRead =
    singleRelayAuthoritativeRead ?? browsingRelayUrls.length === 1
  const rootInfo = useThreadRootInfo(event)
  const { repliesMap, addReplies, ingest } = useThreadPanelStore(event)
  const repliesMapRef = useRef(repliesMap)
  repliesMapRef.current = repliesMap
  const isDiscussionRoot = isDiscussionThreadRoot(event)
  const threadRelayUrlsRef = useRef<string[]>([])
  const threadPanelEngineRef = useRef(new ThreadPanelEngine())
  const replyFetchGenRef = useRef(0)
  const panelRootRef = useRef<HTMLDivElement>(null)
  const [effectsActive, setEffectsActive] = useState(true)
  const shouldIncludeAttestedSuperchatRef = useRef<(evt: NEvent) => boolean>(() => true)
  shouldIncludeAttestedSuperchatRef.current = (evt: NEvent) => {
    const threadWalk = new Map<string, NEvent>()
    for (const { events: bucket } of repliesMapRef.current.values()) {
      for (const e of bucket) threadWalk.set(e.id.toLowerCase(), e)
    }
    return shouldIncludeSuperchatInThreadReply(
      evt,
      event,
      rootInfo,
      isDiscussionRoot,
      threadWalk,
      event.pubkey
    )
  }
  const { attestedPaymentIds, applyAttestedSuperchatWave } = useThreadAttestedPayments(
    event.pubkey,
    addReplies,
    threadRelayUrlsRef,
    browsingRelayUrls,
    replyFetchGenRef,
    shouldIncludeAttestedSuperchatRef
  )
  const applyAttestedSuperchatWaveRef = useRef(applyAttestedSuperchatWave)
  applyAttestedSuperchatWaveRef.current = applyAttestedSuperchatWave

  const replyDuplicateWebPreviewHints = useMemo(() => {
    const out: string[] = [...(duplicateWebPreviewCleanedUrlHints ?? [])]
    if (rootInfo?.type === 'I') out.push(rootInfo.id)
    return out.length ? out : undefined
  }, [duplicateWebPreviewCleanedUrlHints, rootInfo])

  const statsReplyIds = useMemo(
    () => buildNoteStatsReplyIdSet(noteStats?.replies),
    [noteStats?.replies, noteStats?.updatedAt]
  )
  const threadResponseHideOpts = useMemo(
    () => threadResponseFilterOptions(rootInfo),
    [rootInfo?.type]
  )

  const viewBuildBase = useMemo(
    () => ({
      event,
      rootInfo,
      repliesMap,
      isDiscussionRoot,
      mutePubkeySet,
      hideContentMentioningMutedUsers,
      statsReplies: noteStats?.replies,
      statsUpdatedAt: noteStats?.updatedAt,
      attestedPaymentIds,
      sort,
      showQuotes,
      isEventDeleted,
      bookmarkAuthorPubkeys: noteStats?.bookmarkPubkeySet
    }),
    [
      event,
      rootInfo,
      repliesMap,
      isDiscussionRoot,
      mutePubkeySet,
      hideContentMentioningMutedUsers,
      noteStats?.replies,
      noteStats?.updatedAt,
      noteStats?.bookmarkPubkeySet,
      attestedPaymentIds,
      sort,
      showQuotes,
      isEventDeleted,
      tombstoneEpoch
    ]
  )

  const replies: NEvent[] = useMemo(
    () => buildThreadPanelReplies(viewBuildBase),
    [viewBuildBase]
  )

  /** Render with quote card chrome (tail stream + kind 1 #q-only of E/A root). */
  const quoteUiIdSet = useMemo(
    () => buildThreadPanelQuoteUiIdSet(replies, rootInfo),
    [replies, rootInfo]
  )
  const statsMissingPartition = useMemo(
    () =>
      buildThreadPanelStatsMissingPartition({
        statsReplies: noteStats?.replies,
        replies,
        rootInfo,
        repliesMap,
        bookmarkAuthorPubkeys: noteStats?.bookmarkPubkeySet
      }),
    [noteStats?.replies, noteStats?.updatedAt, noteStats?.bookmarkPubkeySet, replies, rootInfo, repliesMap]
  )
  const mergedFeed = useMemo(
    (): TThreadFeedItem[] =>
      buildThreadPanelMergedFeed({
        ...viewBuildBase,
        replies,
        statsMissingPartition
      }),
    [viewBuildBase, replies, statsMissingPartition]
  )

  const parentNoteFeed = useNoteFeedProfileContext()
  const threadProfileLoadedRef = useRef<Set<string>>(new Set())
  const threadProfileBatchGenRef = useRef(0)
  const [threadProfileBatch, setThreadProfileBatch] = useState<{
    profiles: Map<string, TProfile>
    pending: Set<string>
    version: number
  }>(() => ({ profiles: new Map(), pending: new Set(), version: 0 }))

  useEffect(() => {
    threadProfileLoadedRef.current.clear()
    threadProfileBatchGenRef.current += 1
    setThreadProfileBatch({ profiles: new Map(), pending: new Set(), version: 0 })
  }, [event.id])

  const threadNoteFeedProfileValue = useMemo<NoteFeedProfileContextValue>(() => {
    const profiles = new Map<string, TProfile>(parentNoteFeed?.profiles ?? [])
    for (const [k, v] of threadProfileBatch.profiles) profiles.set(k, v)
    const pending = new Set<string>(parentNoteFeed?.pendingPubkeys ?? [])
    threadProfileBatch.pending.forEach((p) => pending.add(p))
    return {
      profiles,
      pendingPubkeys: pending,
      version: (parentNoteFeed?.version ?? 0) * 1_000_000 + threadProfileBatch.version
    }
  }, [parentNoteFeed, threadProfileBatch])

  const mergedFeedEvents = useMemo(
    () => mergedFeed.flatMap((item) => (item.type === 'event' ? [item.event] : [])),
    [mergedFeed]
  )

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const gen = threadProfileBatchGenRef.current
      const candidates = new Set(collectProfilePubkeysFromEvents([event, ...mergedFeedEvents]))

      const parentProfiles = parentNoteFeed?.profiles
      const parentPending = parentNoteFeed?.pendingPubkeys
      const need = [...candidates].filter((pk) => {
        if (parentProfiles?.has(pk)) return false
        if (parentPending?.has(pk)) return false
        if (threadProfileLoadedRef.current.has(pk)) return false
        return true
      })
      if (need.length === 0) return

      need.forEach((pk) => threadProfileLoadedRef.current.add(pk))

      setThreadProfileBatch((prev) => {
        const pending = new Set(prev.pending)
        let changed = false
        for (const pk of need) {
          if (!pending.has(pk)) {
            pending.add(pk)
            changed = true
          }
        }
        if (!changed) return prev
        return { ...prev, pending }
      })

      void (async () => {
        const chunks: string[][] = []
        for (let i = 0; i < need.length; i += THREAD_PROFILE_CHUNK) {
          chunks.push(need.slice(i, i + THREAD_PROFILE_CHUNK))
        }
        const settled = await Promise.allSettled(
          chunks.map((chunk) => client.fetchProfilesForPubkeys(chunk))
        )
        if (gen !== threadProfileBatchGenRef.current) return

        setThreadProfileBatch((prev) => {
          const next = new Map(prev.profiles)
          const pend = new Set(prev.pending)
          settled.forEach((res, idx) => {
            const chunk = chunks[idx]!
            if (res.status === 'rejected') {
              chunk.forEach((pk) => threadProfileLoadedRef.current.delete(pk))
              chunk.forEach((pk) => pend.delete(pk))
              return
            }
            const profiles = res.value
            for (const p of profiles) {
              const pkNorm = p.pubkey.toLowerCase()
              next.set(pkNorm, { ...p, pubkey: pkNorm })
              pend.delete(pkNorm)
            }
            for (const pk of chunk) {
              const pkNorm = pk.toLowerCase()
              pend.delete(pkNorm)
              if (!next.has(pkNorm)) {
                next.set(pkNorm, {
                  pubkey: pkNorm,
                  npub: pubkeyToNpub(pkNorm) ?? '',
                  username: formatPubkey(pkNorm),
                  batchPlaceholder: true
                })
              }
            }
          })
          return { profiles: next, pending: pend, version: prev.version + 1 }
        })
      })()
    }, THREAD_PROFILE_BATCH_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [
    event,
    mergedFeedEvents,
    parentNoteFeed?.profiles,
    parentNoteFeed?.pendingPubkeys
  ])

  const [loading, setLoading] = useState<boolean>(false)
  /** Bumped when thread relay URLs are known — re-runs stats id hydration with inbox relays. */
  const [threadRelaysRevision, setThreadRelaysRevision] = useState(0)
  const [showCount, setShowCount] = useState(THREAD_REPLY_SHOW_COUNT)
  const [highlightReplyId, setHighlightReplyId] = useState<string | undefined>(undefined)
  const replyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)

  /** When note-stats counted replies we did not REQ in the thread, fetch by id from archive/session. */
  const statsHydratedReplyIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    statsHydratedReplyIdsRef.current.clear()
    setThreadRelaysRevision(0)
  }, [event.id])

  /** Pause relay fetch / live work when the panel is off-screen or the tab is hidden. */
  useEffect(() => {
    const el = panelRootRef.current
    if (!el) return

    let intersecting = true
    const syncActive = () => {
      setEffectsActive(intersecting && document.visibilityState === 'visible')
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        intersecting = entry?.isIntersecting ?? false
        syncActive()
      },
      { threshold: 0 }
    )
    observer.observe(el)
    document.addEventListener('visibilitychange', syncActive)
    syncActive()

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', syncActive)
    }
  }, [event.id])

  useEffect(() => {
    if (effectsActive) return
    const nextGen = threadPanelEngineRef.current.bumpGeneration()
    replyFetchGenRef.current = nextGen
  }, [effectsActive])

  useEffect(() => {
    if (!effectsActive) return
    const fromStats = noteStats?.replies
    if (!fromStats?.length) return

    const map = repliesMapRef.current
    const statsIdSet = buildNoteStatsReplyIdSet(fromStats)
    const sessionHits = eventService
      .getSessionEventsForNoteStatsTarget(event, { maxScan: 40_000 })
      .filter((e) => statsIdSet.has(e.id))
    if (sessionHits.length > 0) addReplies(sessionHits)

    const candidates = fromStats.filter(
      (r) =>
        !replyIdPresentInRepliesMap(map, r.id) &&
        !client.peekSessionCachedEvent(r.id) &&
        !statsHydratedReplyIdsRef.current.has(r.id)
    )
    if (candidates.length === 0) return

    let cancelled = false
    void (async () => {
      const unresolved = candidates.filter((r) => !statsHydratedReplyIdsRef.current.has(r.id))
      if (unresolved.length === 0) return
      for (const { id } of unresolved) statsHydratedReplyIdsRef.current.add(id)

      const fromArchive = await resolveLocalEventsByHexIds(unresolved.map((r) => r.id))
      if (!cancelled && fromArchive.length > 0) addReplies(fromArchive)

      const relayUrls = threadRelayUrlsRef.current
      const mapAfterArchive = repliesMapRef.current
      const stillMissing = unresolved.filter(
        (r) =>
          !replyIdPresentInRepliesMap(mapAfterArchive, r.id) &&
          !client.peekSessionCachedEvent(r.id) &&
          !fromArchive.some((e) => e.id === r.id)
      )
      if (stillMissing.length === 0) return

      const batch = await hydrateThreadRepliesFromStats(stillMissing, {
        relayUrls,
        mutePubkeySet,
        hideContentMentioningMutedUsers
      })
      if (cancelled) return
      for (const { id } of stillMissing) {
        if (!batch.some((e) => e.id === id)) statsHydratedReplyIdsRef.current.delete(id)
      }
      if (batch.length > 0) addReplies(batch)
    })()

    return () => {
      cancelled = true
    }
  }, [
    event,
    event.id,
    noteStats?.replies,
    noteStats?.updatedAt,
    addReplies,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    refreshToken,
    threadRelaysRevision,
    effectsActive
  ])

  /** When stats counted many replies but the thread REQ returned few, run the same social filters as note-stats. */
  const statsRelaySyncGenRef = useRef(0)
  useEffect(() => {
    if (!effectsActive) return
    const statsLen = noteStats?.replies?.length ?? 0
    if (statsLen < 3) return
    const resolved = buildRepliesListAlignedWithNoteStats(
      noteStats?.replies,
      repliesMapRef.current,
      [],
      mutePubkeySet,
      hideContentMentioningMutedUsers,
      rootInfo,
      isEventDeleted
    )
    if (resolved.length >= statsLen) return

    const relayUrls = threadRelayUrlsRef.current
    if (!relayUrls.length) return

    const socialFilters = noteStatsService.getSocialStatsFiltersForEvent(event)
    if (!socialFilters.length) return

    const gen = ++statsRelaySyncGenRef.current
    void queryService
      .fetchEvents(relayUrls, socialFilters, {
        foreground: true,
        globalTimeout: 14_000,
        firstRelayResultGraceMs: 900,
        relayOpSource: 'ReplyNoteList.statsSocialSync',
        onevent: (evt: NEvent) => {
          if (gen !== statsRelaySyncGenRef.current) return
          if (isPollVoteKind(evt)) return
          if (!statsReplyIds.has(evt.id)) return
          if (
            shouldHideThreadResponseEvent(
              evt,
              mutePubkeySet,
              hideContentMentioningMutedUsers,
              threadResponseHideOpts
            )
          ) {
            return
          }
          addReplies([evt])
        }
      })
      .then((batch) => {
        if (gen !== statsRelaySyncGenRef.current) return
        const ok = batch.filter(
          (evt) =>
            statsReplyIds.has(evt.id) &&
            !isPollVoteKind(evt) &&
            !shouldHideThreadResponseEvent(
              evt,
              mutePubkeySet,
              hideContentMentioningMutedUsers,
              threadResponseHideOpts
            )
        )
        if (ok.length > 0) addReplies(ok)
      })
      .catch(() => {
        /* optional */
      })
  }, [
    event,
    noteStats?.replies?.length,
    noteStats?.updatedAt,
    statsReplyIds,
    addReplies,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    refreshToken,
    rootInfo,
    isEventDeleted,
    threadResponseHideOpts,
    effectsActive
  ])

  const onNewReply = useCallback(
    (evt: NEvent) => {
      if (isPollVoteKind(evt)) return
      if (isNip18RepostKind(evt.kind)) {
        if (
          rootInfo &&
          replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot) &&
          !muteSetHas(mutePubkeySet, evt.pubkey) &&
          !(
            hideContentMentioningMutedUsers === true &&
            isMentioningMutedUsers(evt, mutePubkeySet)
          )
        ) {
          noteStatsService.updateNoteStatsByEvents([evt], event.pubkey, {
            statsRootEvent: event
          })
        }
        return
      }
      if (
        shouldHideThreadResponseEvent(
          evt,
          mutePubkeySet,
          hideContentMentioningMutedUsers,
          threadResponseHideOpts
        )
      ) {
        return
      }
      addReplies([evt])
      if (rootInfo) {
        const cachedReplies = threadPanelCache.getCachedReplies(rootInfo) || []
        const without = cachedReplies.filter((r) => r.id !== evt.id)
        threadPanelCache.setCachedReplies(rootInfo, [...without, evt])
      }
    },
    [addReplies, rootInfo, mutePubkeySet, hideContentMentioningMutedUsers, event]
  )

  useEffect(() => {
    if (!rootInfo || !effectsActive) return
    const handleEventPublished = (data: Event) => {
      const ce = data as CustomEvent<NEvent>
      const evt = ce.detail
      if (!evt || !replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot)) return
      onNewReply(evt)
    }

    client.addEventListener('newEvent', handleEventPublished)
    return () => {
      client.removeEventListener('newEvent', handleEventPublished)
    }
  }, [rootInfo, event, onNewReply, isDiscussionRoot, effectsActive])

  useEffect(() => {
    if (!rootInfo || !effectsActive) return
    const fetchGeneration = threadPanelEngineRef.current.bumpGeneration()
    replyFetchGenRef.current = fetchGeneration
    activityTrace.trace('ingest', 'ThreadPanel.fetch.start', {
      generation: fetchGeneration,
      rootId: event.id.slice(0, 12)
    })

    const init = async () => {
      const cachedStatsReplies = noteStatsService.getNoteStats(event.id)?.replies
      const statsIdList = cachedStatsReplies?.map((r) => r.id) ?? []

      // Paint from in-memory thread cache (relay fetch ingests only new batches below).
      const cachedData = threadPanelCache.getCachedReplies(rootInfo)
      const hasCache = cachedData !== null
      const existingReplyCount = [...repliesMap.values()].reduce((n, b) => n + b.events.length, 0)
      const showLoadingIndicator =
        existingReplyCount === 0 && !(hasCache && cachedData && cachedData.length > 0)

      if (hasCache && cachedData) {
        addReplies(cachedData, 'session')
      }
      if (showLoadingIndicator) {
        setLoading(true)
      } else {
        setLoading(false)
      }

      try {
        const localRows = await loadThreadRepliesFromLocalStores(
          rootInfo,
          event,
          isDiscussionRoot,
          mutePubkeySet,
          hideContentMentioningMutedUsers,
          { statsReplyIds: statsIdList }
        )
        if (fetchGeneration !== threadPanelEngineRef.current.currentGeneration()) return
        if (localRows.length > 0) {
          addReplies(localRows, 'idb')
          threadPanelCache.setCachedReplies(rootInfo, localRows)
          setLoading(false)
        }
      } catch (e) {
        logger.debug('[ThreadPanel] Local thread load failed', e)
      }

      void fetchFromRelays()
      
      async function fetchFromRelays() {
        if (!rootInfo) return // Type guard

        const streamWalk = new Map<string, NEvent>()
        seedThreadWalkFromLocalContext(streamWalk, rootInfo, event)
        try {
          // READ from: thread hints, author/user NIP-65, favorites, cache — then DEFAULT_FAVORITE_RELAYS fallback.
          const opAuthorPubkey = rootInfo.type === 'E' || rootInfo.type === 'A' ? rootInfo.pubkey : undefined
          const seenOn = client.getSeenEventRelayUrls(event.id).map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean)
          const fromBrowsingFeed = browsingRelayUrls.map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean)
          const threadRelayHints = sanitizeRelayUrlsForFetch([
            ...new Set([...relayHintsFromEventTags(event), ...seenOn, ...fromBrowsingFeed])
          ])
          const replyBlockedRelays = [
            ...(blockedRelays || [])
          ]
          const finalRelayUrls = await buildReplyReadRelayList(
            opAuthorPubkey,
            userPubkey || undefined,
            replyBlockedRelays,
            threadRelayHints,
            relayAuthoritativeRead ? { relayAuthoritative: true } : undefined
          )

          // URL/article threads (NIP-22 `#i`): synthetic root has no e-tags or seen-relay hints — merge the same
          // relay stack as RSS+Web discovery / {@link RssUrlThreadStatsBar} so replies match feed stats.
          if (rootInfo.type === 'I') {
            const rssLayer = await buildRssWebNostrQueryRelayUrls({
              accountPubkey: userPubkey ?? null,
              favoriteRelays: favoriteRelays ?? [],
              blockedRelays: blockedRelays ?? []
            })
            const seenNorm = new Set(
              finalRelayUrls.map((u) => (normalizeAnyRelayUrl(u) || u).toLowerCase()).filter(Boolean)
            )
            for (const u of rssLayer) {
              const n = normalizeAnyRelayUrl(u) || u?.trim()
              if (!n) continue
              const k = n.toLowerCase()
              if (seenNorm.has(k)) continue
              seenNorm.add(k)
              finalRelayUrls.push(n)
            }
          }

          if (rootInfo.type === 'A' && rootInfo.relay) {
            finalRelayUrls.push(rootInfo.relay)
          }

          const filters = buildThreadInteractionFilters({
            root: rootInfo,
            opEventKind: event.kind,
            opEventHexId: openNoteHexId(event),
            limit: THREAD_REPLY_LIMIT
          })

          const relayUrlsForThreadReq = sanitizeRelayUrlsForFetch(
            appendMoneroNostrRelays(
              feedRelayPolicyUrls([{ source: 'fallback', urls: finalRelayUrls }], {
                operation: 'read',
                blockedRelays: replyBlockedRelays,
                applySocialKindBlockedFilter: false,
                allowThirdPartyLocalRelays: false
              })
            )
          )
          threadRelayUrlsRef.current = relayUrlsForThreadReq
          setThreadRelaysRevision((n) => n + 1)
          const recipientPubkey = event.pubkey

          // Stream replies as relays return them (aggr is first in the list) instead of waiting for full EOSE.
          const statsIdsStream = buildNoteStatsReplyIdSet(
            noteStatsService.getNoteStats(event.id)?.replies
          )

          const streamThreadReply = (evt: NEvent) => {
            if (fetchGeneration !== threadPanelEngineRef.current.currentGeneration()) return
            if (isPollVoteKind(evt)) return
            if (rootInfo.type === 'I') {
              if (!isRssArticleUrlThreadInteraction(evt, rootInfo.id)) return
            }
            if (
              shouldHideThreadResponseEvent(
                evt,
                mutePubkeySet,
                hideContentMentioningMutedUsers,
                threadResponseHideOpts
              )
            )
              return
            streamWalk.set(evt.id.toLowerCase(), evt)
            if (statsIdsStream.has(evt.id)) {
              addReplies([evt])
              setLoading(false)
              return
            }
            if (!replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot, streamWalk)) {
              return
            }
            addReplies([evt])
            setLoading(false)
          }

          const superchatFilters = buildThreadSuperchatPriorityFilters({
            root: rootInfo,
            opEventKind: event.kind,
            limit: THREAD_REPLY_LIMIT
          })
          if (superchatFilters.length > 0) {
            void queryService
              .fetchEvents(relayUrlsForThreadReq, superchatFilters, {
                onevent: streamThreadReply,
                foreground: true,
                firstRelayResultGraceMs: 400,
                globalTimeout: 8000,
                relayOpSource: 'ReplyNoteList.threadSuperchats'
              })
              .catch(() => {
                /* optional early wave */
              })
          }

          const attestationTask = recipientPubkey
            ? fetchPaymentAttestationsForRecipient(recipientPubkey, relayUrlsForThreadReq, {
                foreground: true
              })
            : Promise.resolve([] as NEvent[])

          void attestationTask.then((relayAttestations) => {
            if (fetchGeneration !== threadPanelEngineRef.current.currentGeneration()) return
            void applyAttestedSuperchatWaveRef.current(
              relayAttestations,
              relayUrlsForThreadReq,
              fetchGeneration,
              true
            )
          })

          const allReplies = await queryService.fetchEvents(relayUrlsForThreadReq, filters, {
            onevent: streamThreadReply,
            foreground: true,
            firstRelayResultGraceMs: 900,
            globalTimeout: 12_000,
            relayOpSource: 'ReplyNoteList.thread'
          })

          if (fetchGeneration !== threadPanelEngineRef.current.currentGeneration()) return

          mergeFetchedKind7ReactionsIntoRootNoteStats(allReplies, rootInfo)

          const threadWalkFromBatch = new Map<string, NEvent>(
            allReplies.map((e) => [e.id.toLowerCase(), e] as const)
          )
          seedThreadWalkFromLocalContext(threadWalkFromBatch, rootInfo, event)

          const statsIdsForFetch = buildNoteStatsReplyIdSet(
            noteStatsService.getNoteStats(event.id)?.replies
          )

          // Filter and add replies (URL threads include kind 9802 highlights of this page)
          const regularReplies = allReplies.filter((evt) => {
            if (isPollVoteKind(evt)) return false
            if (
              shouldHideThreadResponseEvent(
                evt,
                mutePubkeySet,
                hideContentMentioningMutedUsers,
                threadResponseHideOpts
              )
            ) {
              return false
            }
            if (statsIdsForFetch.has(evt.id)) return true
            return replyMatchesThreadForList(
              evt,
              event,
              rootInfo,
              isDiscussionRoot,
              threadWalkFromBatch
            )
          })
          
          // Store in cache (merges with session/local/archives rows already ingested above).
          threadPanelCache.setCachedReplies(rootInfo, regularReplies)

          const mergedCachedReplies = threadPanelCache.getCachedReplies(rootInfo)
          const mergedForUi =
            mergedCachedReplies === null ? regularReplies : mergedCachedReplies
          if (mergedCachedReplies === null) {
            logger.warn('[ThreadPanel] Cache returned null after store, using fetched replies only')
          }

          // Ingest only this relay batch — cached/session rows were already added at init.
          addReplies(regularReplies, 'relay')

          const statsBatch =
            mergedCachedReplies !== null && mergedCachedReplies.length > 0
              ? mergedCachedReplies
              : regularReplies
          if (statsBatch.length > 0) {
            noteStatsService.updateNoteStatsByEvents(statsBatch, event.pubkey, {
              statsRootEvent: event
            })
          }

          const repliesForStatsPrime = mergedForUi
          if (repliesForStatsPrime.length > 0) {
            for (const reply of repliesForStatsPrime) {
              const sessionEdge = eventService.getSessionEventsForNoteStatsTarget(reply)
              if (sessionEdge.length > 0) {
                noteStatsService.updateNoteStatsByEvents(sessionEdge, reply.pubkey)
              }
            }
            const threadRootHexId =
              rootInfo.type === 'E'
                ? rootInfo.id
                : rootInfo.type === 'A' && /^[0-9a-f]{64}$/i.test(rootInfo.eventId)
                  ? rootInfo.eventId.toLowerCase()
                  : undefined
            window.setTimeout(() => {
              if (fetchGeneration !== threadPanelEngineRef.current.currentGeneration()) return
              void noteStatsService.fetchThreadReplyNoteStatsBatch(
                repliesForStatsPrime,
                relayUrlsForThreadReq,
                userPubkey ?? null,
                { foreground: statsForeground, threadRootHexId }
              )
            }, 0)
          }

          const statsAfterFetch = noteStatsService.getNoteStats(event.id)?.replies
          if (statsAfterFetch?.length) {
            const resolvedIds = new Set(mergedForUi.map((e) => e.id))
            const missingStats = statsAfterFetch.filter(
              (r) => !resolvedIds.has(r.id) && !client.peekSessionCachedEvent(r.id)
            )
            if (missingStats.length > 0) {
              const hydrated = await hydrateThreadRepliesFromStats(missingStats, {
                relayUrls: relayUrlsForThreadReq,
                mutePubkeySet,
                hideContentMentioningMutedUsers
              })
              if (threadPanelEngineRef.current.isCurrent(fetchGeneration) && hydrated.length > 0) {
                addReplies(hydrated)
              }
            }
          }

          // Second pass for URL threads: fetch replies to individual comments that may omit the
          // root I tag (non-NIP-22-compliant clients). NoteStats counts them via #e; without this
          // pass they appear as reply counts only, with no actual content shown.
          if (rootInfo.type === 'I' && regularReplies.length > 0) {
            const commentKinds = [
              ExtendedKind.COMMENT,
              ExtendedKind.VOICE_COMMENT,
              kinds.ShortTextNote
            ]
            const parentIds = regularReplies
              .filter((evt) => isNestedThreadReplyParentKind(evt.kind))
              .map((evt) => evt.id)
            if (parentIds.length > 0) {
              const nestedAccum: NEvent[] = []
              for (let off = 0; off < parentIds.length; off += MAX_PARENT_IDS_PER_NESTED_REQ) {
                const idChunk = parentIds.slice(off, off + MAX_PARENT_IDS_PER_NESTED_REQ)
                const nestedFilters: Filter[] = [
                  { '#e': idChunk, kinds: commentKinds, limit: THREAD_REPLY_LIMIT }
                ]
                const nestedReplies = await queryService.fetchEvents(relayUrlsForThreadReq, nestedFilters, {
                  onevent: (evt: NEvent) => {
                    if (fetchGeneration !== threadPanelEngineRef.current.currentGeneration()) return
                    if (isPollVoteKind(evt)) return
                    if (
                      shouldHideThreadResponseEvent(
                        evt,
                        mutePubkeySet,
                        hideContentMentioningMutedUsers,
                        threadResponseHideOpts
                      )
                    )
                      return
                    addReplies([evt])
                  }
                })
                if (fetchGeneration !== threadPanelEngineRef.current.currentGeneration()) return
                nestedAccum.push(...nestedReplies)
              }
              const validNested = nestedAccum.filter(
                (evt) =>
                  !isPollVoteKind(evt) &&
                  !shouldHideThreadResponseEvent(
              evt,
              mutePubkeySet,
              hideContentMentioningMutedUsers,
              threadResponseHideOpts
            )
              )
              if (validNested.length > 0) {
                threadPanelCache.setCachedReplies(rootInfo, validNested)
                addReplies(validNested, 'nested')
              }
            }
          }

          // Second pass for discussions, plain kind-1 threads, and replaceable (longform/wiki) roots:
          // nested 1 / 1111 / 1244 often tag only the parent's #e; root-scoped REQ misses them (same
          // idea as URL-thread #I follow-up above).
          if (
            (rootInfo.type === 'E' &&
              [
                ExtendedKind.DISCUSSION,
                ExtendedKind.COMMENT,
                ExtendedKind.VOICE_COMMENT,
                kinds.ShortTextNote
              ].includes(event.kind)) ||
            rootInfo.type === 'A'
          ) {
            const commentKindsNested = [
              ExtendedKind.COMMENT,
              ExtendedKind.VOICE_COMMENT,
              kinds.ShortTextNote
            ]
            const focusedParentId =
              commentKindsNested.includes(event.kind) && /^[0-9a-f]{64}$/i.test(event.id)
                ? event.id.toLowerCase()
                : undefined
            const parentIdsNested = Array.from(
              new Set(
                [
                  focusedParentId,
                  ...regularReplies
                    .filter((evt) => isNestedThreadReplyParentKind(evt.kind))
                    .map((evt) => evt.id)
                ].filter(Boolean) as string[]
              )
            )
            if (parentIdsNested.length > 0) {
              const nestedAccum: NEvent[] = []
              const streamWalkById = new Map<string, NEvent>(
                regularReplies.map((e) => [e.id.toLowerCase(), e] as const)
              )
              for (let off = 0; off < parentIdsNested.length; off += MAX_PARENT_IDS_PER_NESTED_REQ) {
                const idChunk = parentIdsNested.slice(off, off + MAX_PARENT_IDS_PER_NESTED_REQ)
                const nestedFilters: Filter[] = [
                  { '#e': idChunk, kinds: commentKindsNested, limit: THREAD_REPLY_LIMIT },
                  {
                    '#E': idChunk,
                    kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
                    limit: THREAD_REPLY_LIMIT
                  }
                ]
                const nestedReplies = await queryService.fetchEvents(relayUrlsForThreadReq, nestedFilters, {
                  onevent: (evt: NEvent) => {
                    if (fetchGeneration !== threadPanelEngineRef.current.currentGeneration()) return
                    if (isPollVoteKind(evt)) return
                    if (
                      shouldHideThreadResponseEvent(
                        evt,
                        mutePubkeySet,
                        hideContentMentioningMutedUsers,
                        threadResponseHideOpts
                      )
                    )
                      return
                    streamWalkById.set(evt.id.toLowerCase(), evt)
                    if (!replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot, streamWalkById)) return
                    addReplies([evt])
                  }
                })
                if (fetchGeneration !== threadPanelEngineRef.current.currentGeneration()) return
                nestedAccum.push(...nestedReplies)
              }
              const nestedWalkMerged = new Map<string, NEvent>(streamWalkById)
              for (const e of nestedAccum) nestedWalkMerged.set(e.id.toLowerCase(), e)
              const validNested = nestedAccum.filter(
                (evt) =>
                  !isPollVoteKind(evt) &&
                  !shouldHideThreadResponseEvent(
              evt,
              mutePubkeySet,
              hideContentMentioningMutedUsers,
              threadResponseHideOpts
            ) &&
                  replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot, nestedWalkMerged)
              )
              if (validNested.length > 0) {
                threadPanelCache.setCachedReplies(rootInfo, validNested)
                addReplies(validNested, 'nested')
              }
            }
          }
        } catch (error) {
          logger.error('[ThreadPanel] Error fetching replies:', error)
        } finally {
          if (threadPanelEngineRef.current.isCurrent(fetchGeneration)) {
            try {
              const statsIdList =
                noteStatsService.getNoteStats(event.id)?.replies?.map((r) => r.id) ?? []
              const lateLocal = await loadThreadRepliesFromLocalStores(
                rootInfo,
                event,
                isDiscussionRoot,
                mutePubkeySet,
                hideContentMentioningMutedUsers,
                { statsReplyIds: statsIdList }
              )
              if (threadPanelEngineRef.current.isCurrent(fetchGeneration) && lateLocal.length > 0) {
                addReplies(lateLocal)
                threadPanelCache.setCachedReplies(rootInfo, lateLocal)
              }
            } catch (e) {
              logger.debug('[ThreadPanel] Late local thread load failed', e)
            }
            setLoading(false)
          }
        }
      }
    }

    init()

    return () => {
      threadPanelEngineRef.current.bumpGeneration()
      noteStatsService.cancelInFlightStatsFetches()
    }
  }, [
    rootInfo,
    userPubkey,
    event.id,
    event.kind,
    blockedRelays,
    favoriteRelays,
    browsingRelayUrls,
    refreshToken,
    addReplies,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    isDiscussionRoot,
    statsForeground,
    effectsActive
  ])

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 0.1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && showCount < mergedFeed.length) {
        setShowCount((prev) => prev + THREAD_REPLY_SHOW_COUNT)
      }
    }, options)

    const currentBottomRef = bottomRef.current

    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [mergedFeed.length, showCount])

  /** Expand the visible window as stats-backed replies hydrate (count badge can be 99+). */
  useEffect(() => {
    const statsLen = noteStats?.replies?.length ?? 0
    if (statsLen === 0) return
    setShowCount((prev) => Math.max(prev, Math.min(mergedFeed.length, statsLen)))
  }, [mergedFeed.length, noteStats?.replies?.length])

  const highlightReply = useCallback((eventId: string, scrollTo = true) => {
    if (scrollTo) {
      const ref = replyRefs.current[eventId]
      if (ref) {
        // Use setTimeout to ensure DOM is updated before scrolling
        setTimeout(() => {
          ref.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 0)
      }
    }
    setHighlightReplyId(eventId)
    setTimeout(() => {
      setHighlightReplyId((pre) => (pre === eventId ? undefined : pre))
    }, 1500)
  }, [])

  /** Paginate replies only; always show the backlinks tail (quotes, highlights, bookmarks, …). */
  const visibleFeed = useMemo(
    () => buildThreadPanelVisibleFeed(mergedFeed, showCount, quoteUiIdSet, rootInfo, repliesMap),
    [mergedFeed, showCount, quoteUiIdSet, rootInfo, repliesMap]
  )

  const shouldShowFeedItem = useCallback(
    (item: NEvent) => {
      if (isPollVoteKind(item)) return false
      if (
        shouldHideThreadResponseEvent(
          item,
          mutePubkeySet,
          hideContentMentioningMutedUsers,
          threadResponseHideOpts
        )
      ) {
        return false
      }
      const isQuote = quoteUiIdSet.has(item.id)
      // Attested superchats are public payment records — always show when they passed mute filters.
      if (isSuperchatKind(item.kind)) return true
      // Backlink rows (quotes, highlights, …): show even when author is not in the trust list.
      if (isQuote) return true
      return true
    },
    [
      mutePubkeySet,
      hideContentMentioningMutedUsers,
      quoteUiIdSet,
      rootInfo?.type,
      repliesMap,
      event,
      isDiscussionRoot
    ]
  )

  const threadRootHex =
    rootInfo?.type === 'E' && /^[0-9a-f]{64}$/i.test(rootInfo.id)
      ? rootInfo.id.toLowerCase()
      : undefined

  const visibleForRender = useMemo(
    () =>
      visibleFeed.filter((item) => {
        if (item.type === 'missing') return true
        const e = item.event
        if (!shouldShowFeedItem(e)) return false
        if (e.id === event.id) return false
        if (threadRootHex && e.id.toLowerCase() === threadRootHex) return false
        return true
      }),
    [visibleFeed, shouldShowFeedItem, event.id, threadRootHex]
  )

  const displayRows = useMemo(
    () => buildThreadPanelDisplayRows(visibleForRender, quoteUiIdSet),
    [visibleForRender, quoteUiIdSet]
  )

  return (
    <ThreadPanelProvider ingest={ingest}>
    <NoteFeedProfileContext.Provider value={threadNoteFeedProfileValue}>
    <div className="pb-12" ref={panelRootRef}>
      {loading && <LoadingBar />}
      <div>
        {displayRows.map((row, ri) => {
          const prevRow = ri > 0 ? displayRows[ri - 1] : undefined
          if (row.type === 'missing-reply') {
            return (
              <div key={`missing-reply-${row.id}`} className="scroll-mt-12">
                <MissingThreadReply
                  id={row.id}
                  pubkey={row.pubkey}
                  createdAt={row.created_at}
                  onFound={(ev) => addReplies([ev])}
                />
              </div>
            )
          }
          if (row.type === 'reply') {
            const reply = row.event
            const parentETag = getParentETag(reply)
            const parentEventHexId = parentETag?.[1]
            const parentEventId = parentETag ? generateBech32IdFromETag(parentETag) : undefined

            const belongsToSameThread =
              rootInfo && replyMatchesThreadForList(reply, event, rootInfo, isDiscussionRoot)

            return (
              <div
                ref={(el) => (replyRefs.current[reply.id] = el)}
                key={reply.id}
                className="scroll-mt-12"
              >
                <ReplyNote
                  event={reply}
                  parentEventId={event.id !== parentEventHexId ? parentEventId : undefined}
                  duplicateWebPreviewCleanedUrlHints={replyDuplicateWebPreviewHints}
                  foregroundStats={statsForeground}
                  deferAuthorAvatar
                  hideEngagementChrome={!statsForeground}
                  onClickParent={() => {
                    if (!parentEventHexId) return
                    if (replies.every((r) => r.id !== parentEventHexId)) {
                      const pid = parentEventId ?? parentEventHexId
                      const parentEv =
                        event.id.toLowerCase() === parentEventHexId.toLowerCase()
                          ? event
                          : client.peekSessionCachedEvent(pid)
                      navigateToNote(
                        toNote(pid),
                        parentEv ?? undefined,
                        parentEv ? getCachedThreadContextEvents(parentEv) : undefined
                      )
                      return
                    }
                    highlightReply(parentEventHexId)
                  }}
                  onClickReply={belongsToSameThread ? (replyEvent) => {
                    // Highlight only — do not push history (null pushState desynced stack vs URL on Back).
                    const replyIndex = mergedFeed.findIndex(
                      (r) => r.type === 'event' && r.event.id === replyEvent.id
                    )
                    if (replyIndex >= 0 && replyIndex >= showCount) {
                      setShowCount(replyIndex + 1)
                    }
                    setTimeout(() => {
                      highlightReply(replyEvent.id, true)
                    }, 50)
                  } : undefined}
                  highlight={highlightReplyId === reply.id}
                />
              </div>
            )
          }

          const { subsection, events: blEvents } = row
          const wrapClass = backlinkRunSectionClass(subsection, prevRow)

          if (subsection === 'bookmark') {
            return (
              <div
                key={`bl-bookmark-${blEvents[0].id}`}
                className={wrapClass}
              >
                <BacklinkAvatarStrip
                  events={blEvents}
                  sectionLabel={t('Thread backlinks bookmarks section')}
                  relationLabelForTitle={t('bookmarked this note')}
                />
              </div>
            )
          }

          if (subsection === 'list') {
            return (
              <div
                key={`bl-list-${blEvents[0].id}`}
                className={wrapClass}
              >
                <BacklinkAvatarStrip
                  events={blEvents}
                  sectionLabel={t('Thread backlinks lists section')}
                  getTitle={(e) => threadBacklinkRelationLabel(e, t)}
                />
              </div>
            )
          }

          if (subsection === 'report') {
            return (
              <div key={`bl-report-${blEvents[0].id}`} className={wrapClass}>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-950/90 dark:text-amber-100/90">
                  {t('Report events heading')}
                </h2>
                {blEvents.map((item) => (
                  <div
                    key={item.id}
                    ref={(el) => (replyRefs.current[item.id] = el)}
                    className="scroll-mt-12 mb-1"
                  >
                    <ThreadQuoteBacklink
                      event={item}
                      quoteKindLabel={threadBacklinkRelationLabel(item, t)}
                      variant="warning"
                    />
                  </div>
                ))}
              </div>
            )
          }

          return (
            <div key={`bl-primary-${blEvents[0].id}`} className={wrapClass}>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('Thread backlinks primary section')}
              </h2>
              {blEvents.map((item) => (
                <div
                  key={item.id}
                  ref={(el) => (replyRefs.current[item.id] = el)}
                  className="scroll-mt-12 mb-1"
                >
                  <ThreadQuoteBacklink
                    event={item}
                    quoteKindLabel={threadBacklinkRelationLabel(item, t)}
                    variant="default"
                  />
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {!loading && (
        <div className="text-sm mt-2 mb-3 text-center text-muted-foreground">
          {mergedFeed.length > 0 ? t('no more replies') : t('no replies')}
        </div>
      )}
      <div ref={bottomRef} />
      {loading && <ReplyNoteSkeleton />}
    </div>
    </NoteFeedProfileContext.Provider>
    </ThreadPanelProvider>
  )
}

export default ThreadPanel