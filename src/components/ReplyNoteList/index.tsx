import { ExtendedKind } from '@/constants'
import { isDiscussionDownvoteEmoji, isDiscussionUpvoteEmoji } from '@/lib/discussion-votes'
import {
  canonicalizeRssArticleUrl,
  getArticleUrlFromCommentITags
} from '@/lib/rss-article'
import {
  getParentETag,
  getReplaceableCoordinateFromEvent,
  isMentioningMutedUsers,
  isNip18RepostKind,
  isReplaceableEvent
} from '@/lib/event'
import logger from '@/lib/logger'
import {
  collectAttestedSuperchatsFromRepliesMap,
  isNestedThreadReplyParentKind,
  isSuperchatKind,
  partitionAttestedSuperchats,
  replyFeedSuperchatsFirst
} from '@/lib/superchat'
import { muteSetHas } from '@/lib/mute-set'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { shouldHideThreadResponseEvent } from '@/lib/thread-response-filter'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { toNote } from '@/lib/link'
import { generateBech32IdFromETag } from '@/lib/tag'
import { useSmartNoteNavigation } from '@/PageManager'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { useReplyIngress } from '@/hooks/useReplyIngress'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import {
  NoteFeedProfileContext,
  type NoteFeedProfileContextValue,
  useNoteFeedProfileContext
} from '@/providers/NoteFeedProfileContext'
import client, { eventService, queryService } from '@/services/client.service'
import noteStatsService from '@/services/note-stats.service'
import discussionFeedCache from '@/services/discussion-feed-cache.service'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { collectProfilePubkeysFromEvents } from '@/lib/profile-batch-coordinator'
import { buildReplyReadRelayList, relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { appendMoneroNostrRelays } from '@/lib/monero-nostr-relays'
import { buildThreadInteractionFilters, buildThreadSuperchatPriorityFilters } from '@/lib/thread-interaction-req'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { buildRssWebNostrQueryRelayUrls, isRssArticleUrlThreadInteraction } from '@/lib/rss-web-feed'
import type { TProfile } from '@/types'
import { Filter, Event as NEvent, kinds } from 'nostr-tools'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingBar } from '../LoadingBar'
import ReplyNote, { ReplyNoteSkeleton } from '../ReplyNote'
import ThreadQuoteBacklink, { BacklinkAvatarStrip } from './ThreadQuoteBacklink'
import {
  MAX_PARENT_IDS_PER_NESTED_REQ,
  THREAD_PROFILE_BATCH_DEBOUNCE_MS,
  THREAD_PROFILE_CHUNK,
  THREAD_REPLY_LIMIT,
  THREAD_REPLY_SHOW_COUNT
} from './types'
import {
  backlinkRunSectionClass,
  buildVisibleBacklinkRows,
  EA_THREAD_TAIL_REFERENCE_KINDS,
  collectDisplayedThreadReplies,
  fetchPaymentAttestationsForRecipient,
  hydrateThreadRepliesFromStats,
  isEaThreadTailBacklinkCandidate,
  isPollVoteKind,
  isWebThreadTailKind,
  loadThreadRepliesFromLocalStores,
  mergeFetchedKind7ReactionsIntoRootNoteStats,
  moveReportsToEndPreserveOrder,
  openNoteHexId,
  partitionAndSortBacklinkTail,
  replyIsInSubtreeBelowOpenNote,
  replyFeedZapsFirst,
  replyIdPresentInRepliesMap,
  replyMatchesThreadForList,
  threadBacklinkRelationLabel
} from './reply-list-utils'
import { useThreadRootInfo } from './useThreadRootInfo'
import { useThreadAttestedPayments } from './useThreadAttestedPayments'

function ReplyNoteList({
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
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const { pubkey: userPubkey } = useNostr()
  const { blockedRelays, favoriteRelays } = useFavoriteRelays()
  const { relayUrls: browsingRelayUrls } = useCurrentRelays()
  const relayAuthoritativeRead =
    singleRelayAuthoritativeRead ?? browsingRelayUrls.length === 1
  const rootInfo = useThreadRootInfo(event)
  const { repliesMap, addReplies } = useReplyIngress()
  const isDiscussionRoot = event.kind === ExtendedKind.DISCUSSION
  const threadRelayUrlsRef = useRef<string[]>([])
  const replyFetchGenRef = useRef(0)
  const { attestedPaymentIds, applyAttestedSuperchatWave } = useThreadAttestedPayments(
    event.pubkey,
    addReplies,
    threadRelayUrlsRef,
    browsingRelayUrls,
    replyFetchGenRef
  )

  const replyDuplicateWebPreviewHints = useMemo(() => {
    const out: string[] = [...(duplicateWebPreviewCleanedUrlHints ?? [])]
    if (rootInfo?.type === 'I') out.push(rootInfo.id)
    return out.length ? out : undefined
  }, [duplicateWebPreviewCleanedUrlHints, rootInfo])

  const replies: NEvent[] = useMemo(() => {
    const replyEvents = collectDisplayedThreadReplies(
      event,
      rootInfo,
      repliesMap,
      isDiscussionRoot,
      mutePubkeySet,
      hideContentMentioningMutedUsers
    )
    const replyIdSet = new Set(replyEvents.map((r) => r.id))

    const threadWalkFromRepliesMap = new Map<string, NEvent>()
    for (const { events: bucket } of repliesMap.values()) {
      for (const e of bucket) {
        threadWalkFromRepliesMap.set(e.id.toLowerCase(), e)
      }
    }

    const includeThreadReply = (evt: NEvent) => {
      if (isPollVoteKind(evt)) return false
      if (
        shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers)
      ) {
        return false
      }
      if (
        rootInfo &&
        !replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot, threadWalkFromRepliesMap)
      ) {
        return false
      }
      const opHex = openNoteHexId(event)
      if (
        opHex &&
        rootInfo?.type === 'E' &&
        rootInfo.id.trim().toLowerCase() !== opHex &&
        !replyIsInSubtreeBelowOpenNote(evt, opHex, threadWalkFromRepliesMap)
      ) {
        return false
      }
      return true
    }

    for (const evt of collectAttestedSuperchatsFromRepliesMap(
      repliesMap,
      attestedPaymentIds,
      replyIdSet,
      includeThreadReply
    )) {
      replyIdSet.add(evt.id)
      replyEvents.push(evt)
    }

    const { superchats, rest: nonZaps } = partitionAttestedSuperchats(replyEvents, attestedPaymentIds)
    const zaps = superchats
    const replyScoreById =
      sort === 'top' || sort === 'controversial' || sort === 'most-zapped'
        ? new Map(
            nonZaps.map((reply) => {
              const stats = noteStatsService.getNoteStats(reply.id)
              let upvotes = 0
              let downvotes = 0
              for (const reaction of stats?.likes ?? []) {
                if (isDiscussionRoot ? isDiscussionUpvoteEmoji(reaction.emoji) : reaction.emoji === '⬆️') {
                  upvotes++
                } else if (
                  isDiscussionRoot ? isDiscussionDownvoteEmoji(reaction.emoji) : reaction.emoji === '⬇️'
                ) {
                  downvotes++
                }
              }
              return [
                reply.id,
                {
                  vote: upvotes - downvotes,
                  controversy: Math.min(upvotes, downvotes),
                  zapAmount: (stats?.zaps ?? []).reduce((sum, zap) => sum + zap.amount, 0)
                }
              ] as const
            })
          )
        : new Map<string, { vote: number; controversy: number; zapAmount: number }>()

    // Sort notes/comments; zap receipts (9735) are always listed first, largest sats → smallest
    switch (sort) {
      case 'oldest':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => a.created_at - b.created_at),
          zaps
        )
      case 'newest':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => b.created_at - a.created_at),
          zaps
        )
      case 'top':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => {
            const scoreA = replyScoreById.get(a.id)?.vote ?? 0
            const scoreB = replyScoreById.get(b.id)?.vote ?? 0
            if (scoreA !== scoreB) {
              return scoreB - scoreA
            }
            return b.created_at - a.created_at
          }),
          zaps
        )
      case 'controversial':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => {
            const controversyA = replyScoreById.get(a.id)?.controversy ?? 0
            const controversyB = replyScoreById.get(b.id)?.controversy ?? 0
            if (controversyA !== controversyB) {
              return controversyB - controversyA
            }
            return b.created_at - a.created_at
          }),
          zaps
        )
      case 'most-zapped':
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => {
            const zapAmountA = replyScoreById.get(a.id)?.zapAmount ?? 0
            const zapAmountB = replyScoreById.get(b.id)?.zapAmount ?? 0
            if (zapAmountA !== zapAmountB) {
              return zapAmountB - zapAmountA
            }
            return b.created_at - a.created_at
          }),
          zaps
        )
      default:
        return replyFeedZapsFirst(
          [...nonZaps].sort((a, b) => b.created_at - a.created_at),
          zaps
        )
    }
  }, [
    event,
    rootInfo,
    repliesMap,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    sort,
    attestedPaymentIds,
    isDiscussionRoot,
    event.kind
  ])

  const replyIdSet = useMemo(() => new Set(replies.map((r) => r.id)), [replies])
  /** Render with quote card chrome (tail stream + kind 1 #q-only of E/A root). */
  const quoteUiIdSet = useMemo(() => {
    const s = new Set<string>()
    if (rootInfo?.type === 'E' || rootInfo?.type === 'A') {
      for (const r of replies) {
        if (isEaThreadTailBacklinkCandidate(r, rootInfo)) s.add(r.id)
      }
    }
    if (rootInfo?.type === 'I') {
      for (const r of replies) {
        if (EA_THREAD_TAIL_REFERENCE_KINDS.has(r.kind)) s.add(r.id)
      }
    }
    return s
  }, [replies, rootInfo])
  const mergedFeed = useMemo(() => {
    /** Quotes + time-sorted feeds must not interleave zap receipts chronologically */
    const zapsThenTimeSorted = (merged: NEvent[], direction: 'asc' | 'desc') => {
      const { superchats, rest: nonZaps } = partitionAttestedSuperchats(merged, attestedPaymentIds)
      const sortedNon = [...nonZaps].sort((a, b) =>
        direction === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
      )
      return moveReportsToEndPreserveOrder(replyFeedSuperchatsFirst(sortedNon, superchats))
    }

    if (!showQuotes) return replies

    // E/A: zaps (sats desc) → thread replies (1 / 1111 / 1244, excluding #q-only) → tail (quotes, highlights, long-form refs)
    if (rootInfo?.type === 'E' || rootInfo?.type === 'A') {
      const { superchats, rest: nonZaps } = partitionAttestedSuperchats(replies, attestedPaymentIds)
      const middle = nonZaps.filter((e) => !isEaThreadTailBacklinkCandidate(e, rootInfo))
      const tailFromReplies = nonZaps.filter((e) => isEaThreadTailBacklinkCandidate(e, rootInfo))
      const tailSeen = new Set<string>()
      const tail: NEvent[] = []
      const pushTail = (e: NEvent) => {
        if (tailSeen.has(e.id)) return
        tailSeen.add(e.id)
        tail.push(e)
      }
      for (const e of tailFromReplies) pushTail(e)
      const tailSorted = partitionAndSortBacklinkTail(tail)
      return [...replyFeedSuperchatsFirst(middle, superchats), ...tailSorted]
    }

    // Web article / URL thread (NIP-22): same zaps → middle → tail layout as E/A
    if (rootInfo?.type === 'I') {
      const { superchats, rest: nonZaps } = partitionAttestedSuperchats(replies, attestedPaymentIds)
      const middle = nonZaps.filter((e) => !isWebThreadTailKind(e.kind))
      const tailFromReplies = nonZaps.filter((e) => isWebThreadTailKind(e.kind))
      const tailSeen = new Set<string>()
      const tail: NEvent[] = []
      const pushTail = (e: NEvent) => {
        if (tailSeen.has(e.id)) return
        tailSeen.add(e.id)
        tail.push(e)
      }
      for (const e of tailFromReplies) pushTail(e)
      const tailSorted = partitionAndSortBacklinkTail(tail)
      return [...replyFeedSuperchatsFirst(middle, superchats), ...tailSorted]
    }

    const merged = [...replies]
    if (sort === 'oldest') return zapsThenTimeSorted(merged, 'asc')
    if (sort === 'newest') return zapsThenTimeSorted(merged, 'desc')
    if (sort === 'top' || sort === 'controversial' || sort === 'most-zapped') {
      return [...replies]
    }
    return zapsThenTimeSorted(merged, 'desc')
  }, [replies, showQuotes, sort, replyIdSet, rootInfo, event.kind, attestedPaymentIds])

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

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const gen = threadProfileBatchGenRef.current
      const candidates = new Set(collectProfilePubkeysFromEvents([event, ...mergedFeed]))

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
    mergedFeed,
    parentNoteFeed?.profiles,
    parentNoteFeed?.pendingPubkeys
  ])

  const [loading, setLoading] = useState<boolean>(false)
  const [showCount, setShowCount] = useState(THREAD_REPLY_SHOW_COUNT)
  const [highlightReplyId, setHighlightReplyId] = useState<string | undefined>(undefined)
  const replyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)

  /** When note-stats counted replies we did not REQ in the thread, fetch by id from archive/session. */
  const statsHydratedReplyIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    statsHydratedReplyIdsRef.current.clear()
  }, [event.id])

  useEffect(() => {
    if (!rootInfo) return
    const fromStats = noteStats?.replies
    if (!fromStats?.length) return

    const candidates = fromStats.filter(
      (r) =>
        !replyIdPresentInRepliesMap(repliesMap, r.id) &&
        !statsHydratedReplyIdsRef.current.has(r.id)
    )
    if (candidates.length === 0) return

    let cancelled = false
    ;(async () => {
      for (const { id } of candidates) statsHydratedReplyIdsRef.current.add(id)
      const batch = await hydrateThreadRepliesFromStats(
        candidates,
        rootInfo,
        event,
        isDiscussionRoot
      )
      if (cancelled) return
      for (const { id } of candidates) {
        if (!batch.some((e) => e.id === id)) statsHydratedReplyIdsRef.current.delete(id)
      }
      const ok = batch.filter(
        (e) =>
          !shouldHideThreadResponseEvent(
            e,
            mutePubkeySet,
            hideContentMentioningMutedUsers
          )
      )
      if (ok.length > 0) addReplies(ok)
    })()

    return () => {
      cancelled = true
    }
  }, [
    event,
    rootInfo,
    isDiscussionRoot,
    noteStats?.replies,
    noteStats?.updatedAt,
    repliesMap,
    addReplies,
    mutePubkeySet,
    hideContentMentioningMutedUsers
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
          hideContentMentioningMutedUsers
        )
      ) {
        return
      }
      addReplies([evt])
      if (rootInfo) {
        const cachedReplies = discussionFeedCache.getCachedReplies(rootInfo) || []
        const without = cachedReplies.filter((r) => r.id !== evt.id)
        discussionFeedCache.setCachedReplies(rootInfo, [...without, evt])
      }
    },
    [addReplies, rootInfo, mutePubkeySet, hideContentMentioningMutedUsers, event]
  )

  useEffect(() => {
    if (!rootInfo) return
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
  }, [rootInfo, event, onNewReply, isDiscussionRoot])

  useEffect(() => {
    if (!rootInfo) return
    const fetchGeneration = ++replyFetchGenRef.current

    const init = async () => {
      // Session LRU (timeline / note-stats / prior panels): thread replies before relay round-trip
      if (rootInfo.type === 'E' || rootInfo.type === 'A') {
        const fromSession = eventService.getSessionThreadInteractionEvents(
          rootInfo,
          openNoteHexId(event)
        )
        if (fromSession.length > 0) {
          addReplies(fromSession)
        }
      }

      // Check cache next — discussion cache merges with relay results
      const cachedData = discussionFeedCache.getCachedReplies(rootInfo)
      const hasCache = cachedData !== null

      if (hasCache && cachedData) {
        addReplies(cachedData)
        setLoading(false)
      } else {
        setLoading(true)
      }

      try {
        const localRows = await loadThreadRepliesFromLocalStores(
          rootInfo,
          event,
          isDiscussionRoot,
          mutePubkeySet,
          hideContentMentioningMutedUsers
        )
        if (fetchGeneration !== replyFetchGenRef.current) return
        if (localRows.length > 0) {
          addReplies(localRows)
          discussionFeedCache.setCachedReplies(rootInfo, localRows)
          setLoading(false)
        }
      } catch (e) {
        logger.debug('[ReplyNoteList] Local thread load failed', e)
      }

      // Always refetch soon so relays fill gaps; no artificial delay (was 2s and caused empty threads)
      void fetchFromRelays()
      
      async function fetchFromRelays() {
        if (!rootInfo) return // Type guard

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
          const recipientPubkey = event.pubkey

          // Stream replies as relays return them (aggr is first in the list) instead of waiting for full EOSE.
          const streamThreadReply = (evt: NEvent) => {
            if (fetchGeneration !== replyFetchGenRef.current) return
            if (isPollVoteKind(evt)) return
            if (rootInfo.type === 'I') {
              if (!isRssArticleUrlThreadInteraction(evt, rootInfo.id)) return
            }
            if (shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers)) return
            addReplies([evt])
            if (!hasCache) setLoading(false)
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
            if (fetchGeneration !== replyFetchGenRef.current) return
            void applyAttestedSuperchatWave(
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

          if (fetchGeneration !== replyFetchGenRef.current) return

          mergeFetchedKind7ReactionsIntoRootNoteStats(allReplies, rootInfo)

          const threadWalkFromBatch = new Map<string, NEvent>(
            allReplies.map((e) => [e.id.toLowerCase(), e] as const)
          )

          // Filter and add replies (URL threads include kind 9802 highlights of this page)
          const regularReplies = allReplies.filter((evt) => {
            if (isPollVoteKind(evt)) return false
            const match = replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot, threadWalkFromBatch)
            if (!match) return false
            return !shouldHideThreadResponseEvent(
              evt,
              mutePubkeySet,
              hideContentMentioningMutedUsers
            )
          })
          
          // Store in cache (this merges with existing cached replies)
          // After this call, the cache contains ALL replies we've ever seen for this thread
          discussionFeedCache.setCachedReplies(rootInfo, regularReplies)
          
          // Get the merged cache (which includes all replies we've ever seen, including new ones)
          const mergedCachedReplies = discussionFeedCache.getCachedReplies(rootInfo)

          let mergedForUi: NEvent[]
          if (mergedCachedReplies === null) {
            logger.warn('[ReplyNoteList] Cache returned null after store, using fetched replies only')
            mergedForUi = regularReplies
          } else {
            mergedForUi = mergedCachedReplies
          }
          const repliesForStatsPrime = mergedForUi
          addReplies(mergedForUi)

          const statsBatch = mergedCachedReplies !== null && mergedCachedReplies.length > 0 ? mergedCachedReplies : regularReplies
          if (statsBatch.length > 0) {
            noteStatsService.updateNoteStatsByEvents(statsBatch, event.pubkey, {
              statsRootEvent: event
            })
          }

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
              if (fetchGeneration !== replyFetchGenRef.current) return
              void noteStatsService.fetchThreadReplyNoteStatsBatch(
                repliesForStatsPrime,
                relayUrlsForThreadReq,
                userPubkey ?? null,
                { foreground: statsForeground, threadRootHexId }
              )
            }, 0)
          }

          if (!hasCache) {
            // No cache: stop loading after adding replies
            setLoading(false)
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
                    if (fetchGeneration !== replyFetchGenRef.current) return
                    if (isPollVoteKind(evt)) return
                    if (shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers))
                      return
                    addReplies([evt])
                  }
                })
                if (fetchGeneration !== replyFetchGenRef.current) return
                nestedAccum.push(...nestedReplies)
              }
              const validNested = nestedAccum.filter(
                (evt) =>
                  !isPollVoteKind(evt) &&
                  !shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers)
              )
              if (validNested.length > 0) {
                discussionFeedCache.setCachedReplies(rootInfo, validNested)
                const merged = discussionFeedCache.getCachedReplies(rootInfo)
                addReplies(merged ?? validNested)
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
                    if (fetchGeneration !== replyFetchGenRef.current) return
                    if (isPollVoteKind(evt)) return
                    if (shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers))
                      return
                    streamWalkById.set(evt.id.toLowerCase(), evt)
                    if (!replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot, streamWalkById)) return
                    addReplies([evt])
                  }
                })
                if (fetchGeneration !== replyFetchGenRef.current) return
                nestedAccum.push(...nestedReplies)
              }
              const nestedWalkMerged = new Map<string, NEvent>(streamWalkById)
              for (const e of nestedAccum) nestedWalkMerged.set(e.id.toLowerCase(), e)
              const validNested = nestedAccum.filter(
                (evt) =>
                  !isPollVoteKind(evt) &&
                  !shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers) &&
                  replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot, nestedWalkMerged)
              )
              if (validNested.length > 0) {
                discussionFeedCache.setCachedReplies(rootInfo, validNested)
                const merged = discussionFeedCache.getCachedReplies(rootInfo)
                addReplies(merged ?? validNested)
              }
            }
          }
        } catch (error) {
          logger.error('[ReplyNoteList] Error fetching replies:', error)
          if (fetchGeneration !== replyFetchGenRef.current) return
          if (!hasCache) {
            // Only set loading to false if we don't have cache to fall back on
            setLoading(false)
          }
        }
      }
    }

    init()
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
    applyAttestedSuperchatWave
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
  const visibleFeed = useMemo(() => {
    const backlinks: NEvent[] = []
    const main: NEvent[] = []
    for (const item of mergedFeed) {
      if (quoteUiIdSet.has(item.id)) backlinks.push(item)
      else main.push(item)
    }
    return [...main.slice(0, showCount), ...backlinks]
  }, [mergedFeed, showCount, quoteUiIdSet])

  const shouldShowFeedItem = useCallback(
    (item: NEvent) => {
      if (isPollVoteKind(item)) return false
      if (shouldHideThreadResponseEvent(item, mutePubkeySet, hideContentMentioningMutedUsers)) {
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
      visibleFeed.filter((e) => {
        if (!shouldShowFeedItem(e)) return false
        if (e.id === event.id) return false
        if (threadRootHex && e.id.toLowerCase() === threadRootHex) return false
        return true
      }),
    [visibleFeed, shouldShowFeedItem, event.id, threadRootHex]
  )

  const displayRows = useMemo(
    () => buildVisibleBacklinkRows(visibleForRender, quoteUiIdSet),
    [visibleForRender, quoteUiIdSet]
  )

  return (
    <NoteFeedProfileContext.Provider value={threadNoteFeedProfileValue}>
    <div className="pb-12">
      {loading && <LoadingBar />}
      <div>
        {displayRows.map((row, ri) => {
          const prevRow = ri > 0 ? displayRows[ri - 1] : undefined
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
                    const replyIndex = mergedFeed.findIndex((r) => r.id === replyEvent.id)
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
  )
}

export default ReplyNoteList