import { ExtendedKind } from '@/constants'
import { isDiscussionDownvoteEmoji, isDiscussionUpvoteEmoji } from '@/lib/discussion-votes'
import { getRootETag, resolveDeclaredThreadRootEventHex } from '@/lib/event'
import {
  collectAttestedSuperchatsFromRepliesMap,
  isSuperchatKind,
  partitionAttestedSuperchats,
  replyFeedSuperchatsFirst
} from '@/lib/superchat'
import { shouldHideThreadResponseEvent } from '@/lib/thread-response-filter'
import { isRssUrlThreadAntwortenTailKind } from '@/lib/rss-web-feed'
import type { TRepliesMap } from '@/lib/reply-index'
import noteStatsService from '@/services/note-stats.service'
import client from '@/services/client.service'
import type { Event as NEvent } from 'nostr-tools'
import type { TRootInfo, TThreadFeedItem, TBacklinkDisplayRow, ThreadPanelSort } from './types'
import {
  buildNoteStatsReplyIdSet,
  buildRepliesListAlignedWithNoteStats,
  buildVisibleBacklinkRows,
  collectDisplayedThreadReplies,
  eventsToThreadFeedItems,
  insertMissingStatsReplyPlaceholders,
  isEaThreadTailBacklinkCandidate,
  isPollVoteKind,
  moveReportsToEndPreserveOrder,
  normalizeHexEventId,
  openNoteHexId,
  partitionAndSortBacklinkTail,
  partitionStatsRepliesForMissingPlaceholders,
  peekThreadStatsReplyEvent,
  replyFeedZapsFirst,
  replyIsInSubtreeBelowOpenNote,
  replyMatchesThreadForList,
  shouldIncludeSuperchatInThreadReply,
  threadResponseFilterOptions
} from './thread-panel-utils'

export type BuildThreadPanelViewOptions = {
  event: NEvent
  rootInfo: TRootInfo | undefined
  repliesMap: TRepliesMap
  isDiscussionRoot: boolean
  mutePubkeySet: Set<string>
  hideContentMentioningMutedUsers: boolean | undefined
  statsReplies: ReadonlyArray<{ id: string; pubkey: string; created_at: number }> | undefined
  statsUpdatedAt: number | undefined
  attestedPaymentIds: Set<string>
  sort: ThreadPanelSort
  showQuotes: boolean
  isEventDeleted: (evt: NEvent) => boolean
  bookmarkAuthorPubkeys: ReadonlySet<string> | undefined
}

export function buildThreadPanelReplies(opts: BuildThreadPanelViewOptions): NEvent[] {
  const {
    event,
    rootInfo,
    repliesMap,
    isDiscussionRoot,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    statsReplies,
    attestedPaymentIds,
    sort,
    isEventDeleted
  } = opts

  const statsReplyIds = buildNoteStatsReplyIdSet(statsReplies)
  const threadResponseHideOpts = threadResponseFilterOptions(rootInfo)

  const threadDisplayed = collectDisplayedThreadReplies(
    event,
    rootInfo,
    repliesMap,
    isDiscussionRoot,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    statsReplyIds,
    isEventDeleted
  )
  const replyEvents = buildRepliesListAlignedWithNoteStats(
    statsReplies,
    repliesMap,
    threadDisplayed,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    rootInfo,
    isEventDeleted
  )
  const replyIdSet = new Set(replyEvents.map((r) => r.id))

  const threadWalkFromRepliesMap = new Map<string, NEvent>()
  for (const { events: bucket } of repliesMap.values()) {
    for (const e of bucket) {
      threadWalkFromRepliesMap.set(e.id.toLowerCase(), e)
    }
  }

  const includeThreadReply = (evt: NEvent) => {
    if (isEventDeleted(evt)) return false
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
    if (isSuperchatKind(evt.kind)) {
      return shouldIncludeSuperchatInThreadReply(
        evt,
        event,
        rootInfo,
        isDiscussionRoot,
        threadWalkFromRepliesMap,
        event.pubkey
      )
    }
    if (statsReplyIds.has(evt.id)) return true
    if (
      rootInfo &&
      !replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot, threadWalkFromRepliesMap)
    ) {
      return false
    }
    const opHex = openNoteHexId(event)
    const opHexLower = opHex?.toLowerCase()
    const viewingThreadRoot =
      opHexLower &&
      ((rootInfo?.type === 'E' && rootInfo.id.trim().toLowerCase() === opHexLower) ||
        (rootInfo?.type === 'A' && rootInfo.eventId.trim().toLowerCase() === opHexLower))
    if (
      opHexLower &&
      rootInfo &&
      !viewingThreadRoot &&
      !replyIsInSubtreeBelowOpenNote(evt, opHexLower, threadWalkFromRepliesMap)
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
          if (scoreA !== scoreB) return scoreB - scoreA
          return b.created_at - a.created_at
        }),
        zaps
      )
    case 'controversial':
      return replyFeedZapsFirst(
        [...nonZaps].sort((a, b) => {
          const controversyA = replyScoreById.get(a.id)?.controversy ?? 0
          const controversyB = replyScoreById.get(b.id)?.controversy ?? 0
          if (controversyA !== controversyB) return controversyB - controversyA
          return b.created_at - a.created_at
        }),
        zaps
      )
    case 'most-zapped':
      return replyFeedZapsFirst(
        [...nonZaps].sort((a, b) => {
          const zapAmountA = replyScoreById.get(a.id)?.zapAmount ?? 0
          const zapAmountB = replyScoreById.get(b.id)?.zapAmount ?? 0
          if (zapAmountA !== zapAmountB) return zapAmountB - zapAmountA
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
}

export function buildThreadPanelQuoteUiIdSet(
  replies: readonly NEvent[],
  rootInfo: TRootInfo | undefined
): Set<string> {
  const s = new Set<string>()
  if (rootInfo?.type === 'E' || rootInfo?.type === 'A') {
    for (const r of replies) {
      if (isEaThreadTailBacklinkCandidate(r, rootInfo)) s.add(r.id)
    }
  }
  if (rootInfo?.type === 'I') {
    for (const r of replies) {
      if (isRssUrlThreadAntwortenTailKind(r.kind)) s.add(r.id)
    }
  }
  return s
}

export function buildThreadPanelStatsMissingPartition(opts: {
  statsReplies: BuildThreadPanelViewOptions['statsReplies']
  replies: readonly NEvent[]
  rootInfo: TRootInfo | undefined
  repliesMap: TRepliesMap
  bookmarkAuthorPubkeys: ReadonlySet<string> | undefined
}) {
  const resolvedIds = new Set(opts.replies.map((r) => normalizeHexEventId(r.id) ?? r.id))
  return partitionStatsRepliesForMissingPlaceholders(
    opts.statsReplies,
    resolvedIds,
    opts.rootInfo,
    opts.repliesMap,
    { bookmarkAuthorPubkeys: opts.bookmarkAuthorPubkeys }
  )
}

export function buildThreadPanelMergedFeed(
  opts: BuildThreadPanelViewOptions & {
    replies: readonly NEvent[]
    statsMissingPartition: ReturnType<typeof partitionStatsRepliesForMissingPlaceholders>
    isEventDeleted: (evt: NEvent) => boolean
    mutePubkeySet: Set<string>
  }
): TThreadFeedItem[] {
  const {
    replies,
    showQuotes,
    sort,
    rootInfo,
    attestedPaymentIds,
    statsMissingPartition,
    statsReplies,
    isEventDeleted,
    mutePubkeySet
  } = opts

  const withMissingPlaceholders = (
    events: readonly NEvent[],
    statsSubset?: ReadonlyArray<{ id: string; pubkey: string; created_at: number }>
  ) =>
    insertMissingStatsReplyPlaceholders([...events], statsSubset ?? statsReplies, sort, {
      isEventDeleted,
      mutePubkeySet
    })

  const zapsThenTimeSorted = (merged: NEvent[], direction: 'asc' | 'desc') => {
    const { superchats, rest: nonZaps } = partitionAttestedSuperchats(merged, attestedPaymentIds)
    const sortedNon = [...nonZaps].sort((a, b) =>
      direction === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
    )
    return moveReportsToEndPreserveOrder(replyFeedSuperchatsFirst(sortedNon, superchats))
  }

  if (!showQuotes) return withMissingPlaceholders(replies, statsMissingPartition.replyThread)

  if (rootInfo?.type === 'E' || rootInfo?.type === 'A') {
    const { superchats, rest: nonZaps } = partitionAttestedSuperchats([...replies], attestedPaymentIds)
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
    const orderedMiddle = replyFeedSuperchatsFirst(middle, superchats)
    const tailMissing = withMissingPlaceholders([], statsMissingPartition.tail)
    return [
      ...withMissingPlaceholders(orderedMiddle, statsMissingPartition.replyThread),
      ...eventsToThreadFeedItems(tailSorted),
      ...tailMissing
    ]
  }

  if (rootInfo?.type === 'I') {
    const { superchats, rest: nonZaps } = partitionAttestedSuperchats([...replies], attestedPaymentIds)
    const middle = nonZaps.filter((e) => !isRssUrlThreadAntwortenTailKind(e.kind))
    const tailFromReplies = nonZaps.filter((e) => isRssUrlThreadAntwortenTailKind(e.kind))
    const tailSeen = new Set<string>()
    const tail: NEvent[] = []
    const pushTail = (e: NEvent) => {
      if (tailSeen.has(e.id)) return
      tailSeen.add(e.id)
      tail.push(e)
    }
    for (const e of tailFromReplies) pushTail(e)
    const tailSorted = partitionAndSortBacklinkTail(tail)
    const orderedMiddle = replyFeedSuperchatsFirst(middle, superchats)
    const tailMissing = withMissingPlaceholders([], statsMissingPartition.tail)
    return [
      ...withMissingPlaceholders(orderedMiddle, statsMissingPartition.replyThread),
      ...eventsToThreadFeedItems(tailSorted),
      ...tailMissing
    ]
  }

  const merged = [...replies]
  if (sort === 'oldest') {
    return withMissingPlaceholders(zapsThenTimeSorted(merged, 'asc'), statsMissingPartition.replyThread)
  }
  if (sort === 'newest') {
    return withMissingPlaceholders(zapsThenTimeSorted(merged, 'desc'), statsMissingPartition.replyThread)
  }
  if (sort === 'top' || sort === 'controversial' || sort === 'most-zapped') {
    return withMissingPlaceholders([...replies], statsMissingPartition.replyThread)
  }
  return withMissingPlaceholders(zapsThenTimeSorted(merged, 'desc'), statsMissingPartition.replyThread)
}

export function buildThreadPanelVisibleFeed(
  mergedFeed: readonly TThreadFeedItem[],
  showCount: number,
  quoteUiIdSet: ReadonlySet<string>,
  rootInfo: TRootInfo | undefined,
  repliesMap: TRepliesMap
): TThreadFeedItem[] {
  const backlinks: TThreadFeedItem[] = []
  const main: TThreadFeedItem[] = []
  for (const item of mergedFeed) {
    if (item.type === 'missing') {
      const peek = peekThreadStatsReplyEvent(item.id, repliesMap)
      const tailMissing =
        (rootInfo?.type === 'E' || rootInfo?.type === 'A') &&
        (!peek || isEaThreadTailBacklinkCandidate(peek, rootInfo))
      if (tailMissing) backlinks.push(item)
      else main.push(item)
      continue
    }
    if (quoteUiIdSet.has(item.event.id)) backlinks.push(item)
    else main.push(item)
  }
  return [...main.slice(0, showCount), ...backlinks]
}

export function buildThreadPanelDisplayRows(
  visibleForRender: readonly TThreadFeedItem[],
  quoteUiIdSet: ReadonlySet<string>
): TBacklinkDisplayRow[] {
  return buildVisibleBacklinkRows([...visibleForRender], quoteUiIdSet as Set<string>)
}

export function isDiscussionThreadRoot(event: NEvent): boolean {
  return event.kind === ExtendedKind.DISCUSSION
}

/** Kind 11 root or NIP-22 reply whose declared root is a cached kind 11 event. */
export function isDiscussionThreadPanelEvent(event: NEvent): boolean {
  if (event.kind === ExtendedKind.DISCUSSION) return true
  if (event.kind !== ExtendedKind.COMMENT && event.kind !== ExtendedKind.VOICE_COMMENT) return false
  const rootETag = getRootETag(event)
  if (!rootETag?.[1]) return false
  const hid = resolveDeclaredThreadRootEventHex(rootETag[1])
  const root = client.peekSessionCachedEvent(hid)
  return root?.kind === ExtendedKind.DISCUSSION
}
