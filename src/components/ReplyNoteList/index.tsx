import {
  E_TAG_FILTER_BLOCKED_RELAY_URLS,
  ExtendedKind,
  NOTE_STATS_OP_REFERENCE_KINDS,
  NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT,
  THREAD_BACKLINK_STREAM_KINDS
} from '@/constants'
import { isDiscussionDownvoteEmoji, isDiscussionUpvoteEmoji } from '@/lib/discussion-votes'
import {
  canonicalizeRssArticleUrl,
  getArticleUrlFromCommentITags
} from '@/lib/rss-article'
import {
  getParentATag,
  getParentETag,
  getReplaceableCoordinateFromEvent,
  getRootATag,
  getRootETag,
  isNip25ReactionKind,
  isNip56ReportEvent,
  isReplaceableEvent,
  kind1QuotesThreadRoot,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import logger from '@/lib/logger'
import { getZapInfoFromEvent, shouldIncludeZapReceiptAtReplyThreshold } from '@/lib/event-metadata'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { shouldHideThreadResponseEvent } from '@/lib/thread-response-filter'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import { toNote } from '@/lib/link'
import { generateBech32IdFromETag } from '@/lib/tag'
import { useSmartNoteNavigation, useSecondaryPage } from '@/PageManager'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { useZap } from '@/providers/ZapProvider'
import { useReply } from '@/providers/ReplyProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
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
import { buildReplyReadRelayList, relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { eventReferencesThreadTarget } from '@/lib/op-reference-tags'
import { replyBelongsToNoteThread } from '@/lib/thread-reply-root-match'
import {
  buildRssArticleUrlThreadInteractionFilters,
  buildRssWebNostrQueryRelayUrls,
  isRssArticleUrlThreadInteraction
} from '@/lib/rss-web-feed'
import type { TProfile } from '@/types'
import { Filter, Event as NEvent, kinds } from 'nostr-tools'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useQuoteEvents } from '@/hooks'
import { LoadingBar } from '../LoadingBar'
import ReplyNote, { ReplyNoteSkeleton } from '../ReplyNote'
import ThreadQuoteBacklink, {
  BacklinkAvatarStrip,
  ThreadQuoteBacklinkSkeleton
} from './ThreadQuoteBacklink'

type TRootInfo =
  | { type: 'E'; id: string; pubkey: string }
  | { type: 'A'; id: string; eventId: string; pubkey: string; relay?: string }
  | { type: 'I'; id: string }

const LIMIT = 200
const SHOW_COUNT = 10
const MAX_KINDS_PER_THREAD_REQ_FILTER = 4
/** Some relays cap `#e` array length; chunk parent-id batches for nested-thread REQs. */
const MAX_PARENT_IDS_PER_NESTED_REQ = 64

function chunkKindsForThreadReq(list: readonly number[], size = MAX_KINDS_PER_THREAD_REQ_FILTER): number[][] {
  const out: number[][] = []
  for (let i = 0; i < list.length; i += size) {
    out.push([...list.slice(i, i + size)])
  }
  return out
}
/** Short debounce so thread / detail headers populate avatars quickly after events arrive. */
const THREAD_PROFILE_BATCH_DEBOUNCE_MS = 16
const THREAD_PROFILE_CHUNK = 80

function partitionZapReceipts(items: NEvent[]) {
  const zaps: NEvent[] = []
  const nonZaps: NEvent[] = []
  for (const e of items) {
    if (e.kind === kinds.Zap) zaps.push(e)
    else nonZaps.push(e)
  }
  return { zaps, nonZaps }
}

function filterZapReceiptsByReplyThreshold(zaps: NEvent[], thresholdSats: number): NEvent[] {
  return zaps.filter((z) => shouldIncludeZapReceiptAtReplyThreshold(z, thresholdSats))
}

/** Zap receipts (9735) at top of reply feeds: largest sats first */
function sortZapReceiptsBySatsDesc(zaps: NEvent[]) {
  return [...zaps].sort((a, b) => {
    const sa = getZapInfoFromEvent(a)?.amount ?? 0
    const sb = getZapInfoFromEvent(b)?.amount ?? 0
    if (sb !== sa) return sb - sa
    return b.created_at - a.created_at
  })
}

function replyFeedZapsFirst(sortedNonZapReplies: NEvent[], zaps: NEvent[]) {
  return [...sortZapReceiptsBySatsDesc(zaps), ...sortedNonZapReplies]
}

type TBacklinkSubsection = 'primary' | 'bookmark' | 'list' | 'report'

function sortWithinBacklinkGroup(events: NEvent[]): NEvent[] {
  return [...events].sort((a, b) => b.created_at - a.created_at)
}

function backlinkTailSubsection(item: NEvent): TBacklinkSubsection {
  if (isNip56ReportEvent(item)) return 'report'
  if (item.kind === kinds.BookmarkList) return 'bookmark'
  if (
    item.kind === kinds.Pinlist ||
    item.kind === kinds.Genericlists ||
    item.kind === kinds.Bookmarksets ||
    item.kind === kinds.Curationsets
  ) {
    return 'list'
  }
  return 'primary'
}

/** Quotes/highlights/citations → bookmarks → lists → reports; newest first within each group. */
function partitionAndSortBacklinkTail(tail: NEvent[]): NEvent[] {
  const primary: NEvent[] = []
  const bookmarks: NEvent[] = []
  const lists: NEvent[] = []
  const reports: NEvent[] = []
  for (const e of tail) {
    const sub = backlinkTailSubsection(e)
    if (sub === 'report') reports.push(e)
    else if (sub === 'bookmark') bookmarks.push(e)
    else if (sub === 'list') lists.push(e)
    else primary.push(e)
  }
  return [
    ...sortWithinBacklinkGroup(primary),
    ...sortWithinBacklinkGroup(bookmarks),
    ...sortWithinBacklinkGroup(lists),
    ...sortWithinBacklinkGroup(reports)
  ]
}

type TBacklinkDisplayRow =
  | { type: 'reply'; event: NEvent }
  | { type: 'backlink-run'; subsection: TBacklinkSubsection; events: NEvent[] }

function buildVisibleBacklinkRows(
  visibleFeed: NEvent[],
  quoteUiIdSet: Set<string>
): TBacklinkDisplayRow[] {
  const rows: TBacklinkDisplayRow[] = []
  let i = 0
  while (i < visibleFeed.length) {
    const item = visibleFeed[i]
    if (!quoteUiIdSet.has(item.id)) {
      rows.push({ type: 'reply', event: item })
      i++
      continue
    }
    const sub = backlinkTailSubsection(item)
    const run: NEvent[] = []
    while (
      i < visibleFeed.length &&
      quoteUiIdSet.has(visibleFeed[i].id) &&
      backlinkTailSubsection(visibleFeed[i]) === sub
    ) {
      run.push(visibleFeed[i])
      i++
    }
    if (run.length > 0) {
      rows.push({ type: 'backlink-run', subsection: sub, events: run })
    }
  }
  return rows
}

function backlinkRunSectionClass(
  subsection: TBacklinkSubsection,
  prev: TBacklinkDisplayRow | undefined
): string {
  if (!prev) {
    return subsection === 'report'
      ? 'mb-3 pt-1'
      : 'mb-3 pt-1'
  }
  if (prev.type === 'reply') {
    return subsection === 'report'
      ? 'mt-8 mb-3 border-t border-amber-500/40 pt-6 dark:border-amber-400/30'
      : 'mt-8 mb-3 border-t border-border/60 pt-6'
  }
  return subsection === 'report'
    ? 'mt-6 mb-3 border-t border-amber-500/40 pt-4 dark:border-amber-400/30'
    : 'mt-6 mb-3 border-t border-border/60 pt-4'
}

/** Preserve order except NIP-56 reports move to the end (after all non-reports). */
function moveReportsToEndPreserveOrder(events: NEvent[]): NEvent[] {
  const non = events.filter((e) => !isNip56ReportEvent(e))
  const rep = events.filter((e) => isNip56ReportEvent(e))
  return [...non, ...rep]
}

/** Shown after thread replies for E/A roots (quote stream + kind 1 #q-only); matches {@link THREAD_BACKLINK_STREAM_KINDS}. */
const EA_THREAD_TAIL_REFERENCE_KINDS = new Set<number>(THREAD_BACKLINK_STREAM_KINDS)

/** Web (NIP-22) thread: tail = reference-style rows + URL-scoped reactions (same block order as E/A). */
const WEB_THREAD_EXTRA_TAIL_KINDS = new Set<number>([kinds.Reaction, ExtendedKind.EXTERNAL_REACTION])

function isWebThreadTailKind(kind: number): boolean {
  return EA_THREAD_TAIL_REFERENCE_KINDS.has(kind) || WEB_THREAD_EXTRA_TAIL_KINDS.has(kind)
}

/** Kind 1111 / 1244 that includes the thread root id on an e/E tag (common on relays; stricter root-tag walks may miss these). */
function commentReferencesThreadRootEventHex(evt: NEvent, rootHexLower: string): boolean {
  if (evt.kind !== ExtendedKind.COMMENT && evt.kind !== ExtendedKind.VOICE_COMMENT) return false
  const h = rootHexLower.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(h)) return false
  return evt.tags.some(
    (t) => (t[0] === 'e' || t[0] === 'E') && typeof t[1] === 'string' && t[1].toLowerCase() === h
  )
}

function replyIdPresentInRepliesMap(
  map: Map<string, { events: NEvent[]; eventIdSet: Set<string> }>,
  replyId: string
): boolean {
  for (const { events } of map.values()) {
    if (events.some((e) => e.id === replyId)) return true
  }
  return false
}

/** NIP-25 reaction: any `e` / `E` tag value equals this hex id (lowercased). */
function noteReactionEtagEqualsHex(ev: NEvent, hexLower: string): boolean {
  const h = hexLower.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(h)) return false
  for (const t of ev.tags) {
    if ((t[0] === 'e' || t[0] === 'E') && typeof t[1] === 'string' && t[1].toLowerCase() === h) return true
  }
  return false
}

/**
 * Thread REQ historically omitted kind 7; {@link replyMatchesThreadForList} also drops reactions from the reply list.
 * Reactions still need to merge into {@link noteStatsService} for the root so the note header matches notifications.
 */
function mergeFetchedKind7ReactionsIntoRootNoteStats(all: NEvent[], rootInfo: TRootInfo) {
  if (rootInfo.type === 'E') {
    const rootHex = rootInfo.id.trim().toLowerCase()
    const hits = all.filter((ev) => ev.kind === kinds.Reaction && noteReactionEtagEqualsHex(ev, rootHex))
    if (hits.length > 0) {
      noteStatsService.updateNoteStatsByEvents(hits, undefined, { interactionTargetNoteId: rootInfo.id })
    }
  } else if (rootInfo.type === 'A') {
    const idHex = rootInfo.eventId?.trim().toLowerCase()
    if (idHex && /^[0-9a-f]{64}$/i.test(idHex)) {
      const hits = all.filter((ev) => ev.kind === kinds.Reaction && noteReactionEtagEqualsHex(ev, idHex))
      if (hits.length > 0) {
        noteStatsService.updateNoteStatsByEvents(hits, undefined, { interactionTargetNoteId: rootInfo.eventId })
      }
    }
  }
}

function replyMatchesThreadForList(
  evt: NEvent,
  opEvent: NEvent,
  rootInfo: TRootInfo,
  isDiscussionRoot: boolean
): boolean {
  if (rootInfo.type === 'I') {
    return isRssArticleUrlThreadInteraction(evt, rootInfo.id)
  }
  if (
    isDiscussionRoot &&
    rootInfo.type === 'E' &&
    commentReferencesThreadRootEventHex(evt, rootInfo.id)
  ) {
    return true
  }
  if (replyBelongsToNoteThread(evt, opEvent, rootInfo)) return true
  if (
    (rootInfo.type === 'E' || rootInfo.type === 'A') &&
    evt.kind !== kinds.ShortTextNote &&
    NOTE_STATS_OP_REFERENCE_KINDS.includes(evt.kind) &&
    eventReferencesThreadTarget(evt, rootInfo)
  ) {
    return true
  }
  return false
}

function threadBacklinkRelationLabel(item: NEvent, t: TFunction): string {
  if (item.kind === kinds.Highlights) return t('highlighted this note')
  if (item.kind === kinds.ShortTextNote) return t('quoted this note')
  if (
    item.kind === kinds.LongFormArticle ||
    item.kind === ExtendedKind.WIKI_ARTICLE ||
    item.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN ||
    item.kind === ExtendedKind.PUBLICATION_CONTENT
  ) {
    return t('cited in article')
  }
  if (item.kind === kinds.Label) return t('labeled this note')
  if (isNip56ReportEvent(item)) return t('reported this note')
  if (item.kind === kinds.BookmarkList) return t('bookmarked this note')
  if (item.kind === kinds.Pinlist) return t('pinned this note')
  if (item.kind === kinds.Genericlists) return t('listed this note')
  if (item.kind === kinds.Bookmarksets) return t('bookmark set reference')
  if (item.kind === kinds.Curationsets) return t('curated this note')
  if (item.kind === kinds.BadgeAward) return t('badge award for this note')
  return t('referenced this note')
}

function isKind1QuoteOnlyOfEaRoot(evt: NEvent, root: TRootInfo): boolean {
  if (root.type === 'I') return false
  if (evt.kind !== kinds.ShortTextNote) return false
  if (getParentETag(evt) || getParentATag(evt)) return false
  return kind1QuotesThreadRoot(evt, root)
}

/** E/A roots: #q-only kind 1 + relay “reply” rows for {@link THREAD_BACKLINK_STREAM_KINDS} belong in backlinks tail, not the chronological middle. */
function isEaThreadTailBacklinkCandidate(evt: NEvent, root: TRootInfo): boolean {
  if (root.type !== 'E' && root.type !== 'A') return false
  if (isKind1QuoteOnlyOfEaRoot(evt, root)) return true
  return EA_THREAD_TAIL_REFERENCE_KINDS.has(evt.kind)
}

function ReplyNoteList({
  index,
  event,
  sort = 'oldest',
  showQuotes = true,
  duplicateWebPreviewCleanedUrlHints,
  statsForeground = false,
  refreshToken = 0
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
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const { currentIndex } = useSecondaryPage()
  const { hideUntrustedInteractions, isUserTrusted, isTrustLoaded } = useUserTrust()
  const noteStats = useNoteStatsById(event.id)
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const { pubkey: userPubkey } = useNostr()
  const { zapReplyThreshold } = useZap()
  const { blockedRelays, favoriteRelays } = useFavoriteRelays()
  const { relayUrls: browsingRelayUrls } = useCurrentRelays()
  const [rootInfo, setRootInfo] = useState<TRootInfo | undefined>(undefined)
  const { repliesMap, addReplies } = useReply()
  const { quoteEvents, quoteLoading } = useQuoteEvents(event, true)
  const filteredQuoteEvents = useMemo(
    () =>
      quoteEvents.filter(
        (e) =>
          !shouldHideThreadResponseEvent(
            e,
            mutePubkeySet,
            hideContentMentioningMutedUsers
          )
      ),
    [quoteEvents, mutePubkeySet, hideContentMentioningMutedUsers]
  )

  const isDiscussionRoot = event.kind === ExtendedKind.DISCUSSION

  const replyDuplicateWebPreviewHints = useMemo(() => {
    const out: string[] = [...(duplicateWebPreviewCleanedUrlHints ?? [])]
    if (rootInfo?.type === 'I') out.push(rootInfo.id)
    return out.length ? out : undefined
  }, [duplicateWebPreviewCleanedUrlHints, rootInfo])

  const replies = useMemo(() => {
    const replyIdSet = new Set<string>()
    const replyEvents: NEvent[] = []
    const currentEventKey = isReplaceableEvent(event.kind)
      ? getReplaceableCoordinateFromEvent(event)
      : /^[0-9a-f]{64}$/i.test(event.id) ? event.id.toLowerCase() : event.id
    // For replaceable events, also check the event ID in case replies are stored there
    const eventIdKey = /^[0-9a-f]{64}$/i.test(event.id) ? event.id.toLowerCase() : event.id
    let parentEventKeys = [currentEventKey]
    if (isReplaceableEvent(event.kind) && currentEventKey !== eventIdKey) {
      parentEventKeys.push(eventIdKey)
    }
    // Web article threads: kind 1111 replies use #i (URL) only — ReplyProvider keys them by canonical URL, not synthetic root id.
    if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
      const u = getArticleUrlFromCommentITags(event)
      if (u) {
        const canon = canonicalizeRssArticleUrl(u)
        if (!parentEventKeys.includes(canon)) {
          parentEventKeys = [canon, ...parentEventKeys]
        }
      }
    }

    
    const processedEventIds = new Set<string>() // Prevent infinite loops
    let iterationCount = 0
    const MAX_ITERATIONS = 10 // Prevent infinite loops
    
    while (parentEventKeys.length > 0 && iterationCount < MAX_ITERATIONS) {
      iterationCount++
      const events = parentEventKeys.flatMap((id) => repliesMap.get(id)?.events || [])
      
      events.forEach((evt) => {
        if (replyIdSet.has(evt.id)) return
        if (isNip25ReactionKind(evt.kind)) return
        if (
          shouldHideThreadResponseEvent(
            evt,
            mutePubkeySet,
            hideContentMentioningMutedUsers
          )
        ) {
          return
        }
        if (rootInfo && !replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot)) return

        replyIdSet.add(evt.id)
        replyEvents.push(evt)
      })
      
      // Include reactions (and every other kind) so BFS can find notes keyed under reaction / zap ids.
      const newParentEventKeys = events
        .map((evt) => evt.id)
        .filter((id) => !processedEventIds.has(id))
      
      newParentEventKeys.forEach((id) => processedEventIds.add(id))
      parentEventKeys = newParentEventKeys
    }
    
    if (iterationCount >= MAX_ITERATIONS) {
      logger.warn('ReplyNoteList: Maximum iterations reached, possible circular reference in replies')
    }
    


    const { zaps: zapsPartitioned, nonZaps } = partitionZapReceipts(replyEvents)
    const zaps = filterZapReceiptsByReplyThreshold(zapsPartitioned, zapReplyThreshold)
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
    zapReplyThreshold,
    isDiscussionRoot
  ])

  const replyIdSet = useMemo(() => new Set(replies.map((r) => r.id)), [replies])
  /** Render with quote card chrome (tail stream + kind 1 #q-only of E/A root). */
  const quoteUiIdSet = useMemo(() => {
    const s = new Set(filteredQuoteEvents.map((e) => e.id))
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
  }, [filteredQuoteEvents, replies, rootInfo])
  const mergedFeed = useMemo(() => {
    /** Quotes + time-sorted feeds must not interleave zap receipts chronologically */
    const zapsThenTimeSorted = (merged: NEvent[], direction: 'asc' | 'desc') => {
      const { zaps, nonZaps } = partitionZapReceipts(merged)
      const sortedNon = [...nonZaps].sort((a, b) =>
        direction === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
      )
      return moveReportsToEndPreserveOrder(replyFeedZapsFirst(sortedNon, zaps))
    }

    if (!showQuotes) return replies

    const quoteOnly = filteredQuoteEvents.filter((e) => !replyIdSet.has(e.id))

    // E/A: zaps (sats desc) → thread replies (1 / 1111 / 1244, excluding #q-only) → tail (quotes, highlights, long-form refs)
    if (rootInfo?.type === 'E' || rootInfo?.type === 'A') {
      const { zaps, nonZaps } = partitionZapReceipts(replies)
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
      for (const e of quoteOnly) pushTail(e)
      const tailSorted = partitionAndSortBacklinkTail(tail)
      return [...replyFeedZapsFirst(middle, zaps), ...tailSorted]
    }

    // Web article / URL thread (NIP-22): same zaps → middle → tail layout as E/A
    if (rootInfo?.type === 'I') {
      const { zaps, nonZaps } = partitionZapReceipts(replies)
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
      for (const e of quoteOnly) pushTail(e)
      const tailSorted = partitionAndSortBacklinkTail(tail)
      return [...replyFeedZapsFirst(middle, zaps), ...tailSorted]
    }

    const merged = [...replies, ...quoteOnly]
    if (sort === 'oldest') return zapsThenTimeSorted(merged, 'asc')
    if (sort === 'newest') return zapsThenTimeSorted(merged, 'desc')
    if (sort === 'top' || sort === 'controversial' || sort === 'most-zapped') {
      const replyIds = new Set(replies.map((r) => r.id))
      const sortedReplies = [...replies]
      const qo = merged.filter((e) => !replyIds.has(e.id))
      const sortedQuotes = partitionAndSortBacklinkTail([...qo])
      return [...sortedReplies, ...sortedQuotes]
    }
    return zapsThenTimeSorted(merged, 'desc')
  }, [replies, filteredQuoteEvents, showQuotes, sort, replyIdSet, rootInfo])

  useEffect(() => {
    if (!rootInfo) return
    const toAdd = filteredQuoteEvents.filter((evt) =>
      replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot)
    )
    if (toAdd.length > 0) addReplies(toAdd)
  }, [filteredQuoteEvents, rootInfo, event, isDiscussionRoot, addReplies])

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
      const candidates = new Set<string>()
      const addPk = (p: string | undefined) => {
        if (p && p.length === 64 && /^[0-9a-f]{64}$/i.test(p)) {
          candidates.add(p.toLowerCase())
        }
      }
      const addFromEvt = (e: NEvent) => {
        addPk(e.pubkey)
        let n = 0
        for (const tag of e.tags) {
          if (tag[0] === 'p' && tag[1]) {
            addPk(tag[1])
            n++
            if (n >= 4) break
          }
        }
      }
      addFromEvt(event)
      for (const e of mergedFeed) addFromEvt(e)

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
  }, [event, mergedFeed, parentNoteFeed?.profiles, parentNoteFeed?.pendingPubkeys])

  const [timelineKey] = useState<string | undefined>(undefined)
  const [until, setUntil] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState<boolean>(false)
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const [highlightReplyId, setHighlightReplyId] = useState<string | undefined>(undefined)
  const replyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const fetchRootEvent = async () => {
      if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
        const url = getArticleUrlFromCommentITags(event)
        if (url) {
          setRootInfo({ type: 'I', id: canonicalizeRssArticleUrl(url) })
        }
        return
      }

      let root: TRootInfo

      if (isReplaceableEvent(event.kind)) {
        root = {
          type: 'A',
          id: getReplaceableCoordinateFromEvent(event),
          eventId: event.id,
          pubkey: event.pubkey,
          relay: client.getEventHint(event.id)
        }
      } else {
        const eid = event.id
        root = {
          type: 'E',
          id: /^[0-9a-f]{64}$/i.test(eid) ? eid.toLowerCase() : eid,
          pubkey: event.pubkey
        }
      }
      
      const rootETag = getRootETag(event)
      if (rootETag) {
        const [, rootEventHexId, , , rootEventPubkey] = rootETag
        if (rootEventHexId && rootEventPubkey) {
          const hid = resolveDeclaredThreadRootEventHex(rootEventHexId)
          const resolvedRootEvent = client.peekSessionCachedEvent(hid)
          root = {
            type: 'E',
            id: /^[0-9a-f]{64}$/i.test(hid) ? hid.toLowerCase() : hid,
            pubkey: resolvedRootEvent?.pubkey ?? rootEventPubkey
          }
        } else {
          const rootEventId = generateBech32IdFromETag(rootETag)
          if (rootEventId) {
            const rootEvent = await eventService.fetchEvent(rootEventId)
            if (rootEvent) {
              const rid = resolveDeclaredThreadRootEventHex(rootEvent.id)
              const resolvedRootEvent = client.peekSessionCachedEvent(rid) ?? rootEvent
              root = {
                type: 'E',
                id: /^[0-9a-f]{64}$/i.test(rid) ? rid.toLowerCase() : rid,
                pubkey: resolvedRootEvent.pubkey
              }
            }
          }
        }
      } else if (event.kind === ExtendedKind.COMMENT) {
        const rootATag = getRootATag(event)
        if (rootATag) {
          const [, coordinate, relay] = rootATag
          const [, pubkey] = coordinate.split(':')
          root = { type: 'A', id: coordinate, eventId: event.id, pubkey, relay }
        }
        const rootArticleUrl = getArticleUrlFromCommentITags(event)
        if (rootArticleUrl) {
          root = { type: 'I', id: canonicalizeRssArticleUrl(rootArticleUrl) }
        }
      }
      setRootInfo(root)
    }
    fetchRootEvent()
  }, [event])

  /** When stats saw a URL-thread reply on relays we didn't REQ in the reply list, fetch by id so count matches list. */
  const rssStatsHydratedReplyIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    rssStatsHydratedReplyIdsRef.current.clear()
  }, [event.id])

  useEffect(() => {
    if (event.kind !== ExtendedKind.RSS_THREAD_ROOT || rootInfo?.type !== 'I') return
    const fromStats = noteStats?.replies
    if (!fromStats?.length) return

    const urlKey = canonicalizeRssArticleUrl(rootInfo.id)
    const inBucket = new Set((repliesMap.get(urlKey)?.events ?? []).map((e) => e.id))

    const candidates = fromStats.filter(
      (r) => !inBucket.has(r.id) && !rssStatsHydratedReplyIdsRef.current.has(r.id)
    )
    if (candidates.length === 0) return

    let cancelled = false
    ;(async () => {
      const batch: NEvent[] = []
      for (const { id } of candidates) {
        rssStatsHydratedReplyIdsRef.current.add(id)
        try {
          const ev = await eventService.fetchEvent(id)
          if (cancelled) return
          if (ev && isRssArticleUrlThreadInteraction(ev, rootInfo.id)) {
            batch.push(ev)
          } else {
            rssStatsHydratedReplyIdsRef.current.delete(id)
          }
        } catch {
          rssStatsHydratedReplyIdsRef.current.delete(id)
        }
      }
      if (!cancelled && batch.length > 0) {
        const ok = batch.filter(
          (e) =>
            !shouldHideThreadResponseEvent(
              e,
              mutePubkeySet,
              hideContentMentioningMutedUsers
            )
        )
        if (ok.length > 0) addReplies(ok)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    event.kind,
    event.id,
    rootInfo,
    noteStats?.replies,
    noteStats?.updatedAt,
    repliesMap,
    addReplies,
    mutePubkeySet,
    hideContentMentioningMutedUsers
  ])

  /** When note-stats counted discussion replies we did not REQ in the thread, fetch by id (same idea as RSS threads). */
  const discussionStatsHydratedReplyIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    discussionStatsHydratedReplyIdsRef.current.clear()
  }, [event.id])

  useEffect(() => {
    if (event.kind !== ExtendedKind.DISCUSSION || !rootInfo || rootInfo.type !== 'E') return
    const fromStats = noteStats?.replies
    if (!fromStats?.length) return
    const threadRoot = rootInfo

    const candidates = fromStats.filter(
      (r) =>
        !replyIdPresentInRepliesMap(repliesMap, r.id) &&
        !discussionStatsHydratedReplyIdsRef.current.has(r.id)
    )
    if (candidates.length === 0) return

    let cancelled = false
    ;(async () => {
      const batch: NEvent[] = []
      for (const { id } of candidates) {
        discussionStatsHydratedReplyIdsRef.current.add(id)
        try {
          const ev = await eventService.fetchEvent(id)
          if (cancelled) return
          if (ev && replyMatchesThreadForList(ev, event, threadRoot, true)) {
            batch.push(ev)
          } else {
            discussionStatsHydratedReplyIdsRef.current.delete(id)
          }
        } catch {
          discussionStatsHydratedReplyIdsRef.current.delete(id)
        }
      }
      if (!cancelled && batch.length > 0) {
        const ok = batch.filter(
          (e) =>
            !shouldHideThreadResponseEvent(
              e,
              mutePubkeySet,
              hideContentMentioningMutedUsers
            )
        )
        if (ok.length > 0) addReplies(ok)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    event.kind,
    event.id,
    event,
    rootInfo,
    noteStats?.replies,
    noteStats?.updatedAt,
    repliesMap,
    addReplies,
    mutePubkeySet,
    hideContentMentioningMutedUsers
  ])

  const onNewReply = useCallback(
    (evt: NEvent) => {
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
    [addReplies, rootInfo, mutePubkeySet, hideContentMentioningMutedUsers]
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

  const replyFetchGenRef = useRef(0)

  useEffect(() => {
    if (!rootInfo) return
    // Hidden stack pages pass a numeric index that differs from the top panel's currentIndex.
    // When index is omitted (edge routes), still fetch so replies are not stuck empty.
    if (index !== undefined && currentIndex !== index) return

    const fetchGeneration = ++replyFetchGenRef.current

    const init = async () => {
      // Session LRU (timeline / note-stats / prior panels): thread replies before relay round-trip
      if (rootInfo.type === 'E' || rootInfo.type === 'A') {
        const fromSession = eventService.getSessionThreadInteractionEvents(rootInfo)
        if (fromSession.length > 0) {
          addReplies(fromSession)
        }
      }

      // Check cache next — discussion cache merges with relay results
      const cachedData = discussionFeedCache.getCachedReplies(rootInfo)
      const hasCache = cachedData !== null

      if (hasCache) {
        addReplies(cachedData)
        setLoading(false)
      } else {
        setLoading(true)
      }

      // Always refetch soon so relays fill gaps; no artificial delay (was 2s and caused empty threads)
      void fetchFromRelays()
      
      async function fetchFromRelays() {
        if (!rootInfo) return // Type guard

        try {
          // READ from: FAST_READ_RELAY_URLS + user's inboxes + local relays + OP author's outboxes
          const opAuthorPubkey = rootInfo.type === 'E' || rootInfo.type === 'A' ? rootInfo.pubkey : undefined
          const seenOn = client.getSeenEventRelayUrls(event.id).map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean)
          const fromBrowsingFeed = browsingRelayUrls.map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean)
          const threadRelayHints = [
            ...new Set([...relayHintsFromEventTags(event), ...seenOn, ...fromBrowsingFeed])
          ]
          const replyBlockedRelays = [
            ...(blockedRelays || []),
            ...E_TAG_FILTER_BLOCKED_RELAY_URLS
          ]
          const finalRelayUrls = await buildReplyReadRelayList(
            opAuthorPubkey,
            userPubkey || undefined,
            replyBlockedRelays,
            threadRelayHints
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

          const filters: Filter[] = []
          const qKindsHex = Array.from(
            new Set<number>([
              kinds.ShortTextNote,
              ExtendedKind.COMMENT,
              ExtendedKind.VOICE_COMMENT,
              ...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT
            ])
          ).sort((a, b) => a - b)
          const opRefChunks = chunkKindsForThreadReq(NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT)

          if (rootInfo.type === 'E') {
            // Fetch all reply types for event-based replies (keep ≤4 kinds per filter — some relays
            // NOTICE "too many kinds N" and drop the whole REQ if kind 7 is bundled with four others).
            filters.push({
              '#e': [rootInfo.id],
              kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
              limit: LIMIT
            })
            // Also fetch with uppercase E tag for replaceable events
            filters.push({
              '#E': [rootInfo.id],
              kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
              limit: LIMIT
            })
            filters.push({
              '#e': [rootInfo.id],
              kinds: [kinds.Reaction],
              limit: LIMIT
            })
            filters.push({
              '#q': [rootInfo.id],
              kinds: qKindsHex,
              limit: LIMIT
            })
            // For public messages (kind 24), also look for replies using 'q' tags
            if (event.kind === ExtendedKind.PUBLIC_MESSAGE) {
              filters.push({
                '#q': [rootInfo.id],
                kinds: [ExtendedKind.PUBLIC_MESSAGE],
                limit: LIMIT
              })
            }
            for (const chunk of opRefChunks) {
              filters.push({ '#e': [rootInfo.id], kinds: chunk, limit: LIMIT })
              filters.push({ '#E': [rootInfo.id], kinds: chunk, limit: LIMIT })
            }
          } else if (rootInfo.type === 'A') {
            // Fetch all reply types for replaceable event-based replies
            filters.push(
              {
                '#a': [rootInfo.id],
                kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
                limit: LIMIT
              },
              {
                '#A': [rootInfo.id],
                kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
                limit: LIMIT
              }
            )
            // Many clients tag only `#e` with the published snapshot id (not `#a`). Mirror the E-root
            // filters so kind-1 threads and op-reference kinds are not missed on longform/wiki URLs.
            if (/^[0-9a-f]{64}$/i.test(rootInfo.eventId)) {
              const eSnap = rootInfo.eventId.trim().toLowerCase()
              filters.push({
                '#e': [eSnap],
                kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
                limit: LIMIT
              })
              filters.push({
                '#E': [eSnap],
                kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, kinds.Zap],
                limit: LIMIT
              })
              filters.push({
                '#e': [eSnap],
                kinds: [kinds.Reaction],
                limit: LIMIT
              })
              for (const chunk of opRefChunks) {
                filters.push({ '#e': [eSnap], kinds: chunk, limit: LIMIT })
                filters.push({ '#E': [eSnap], kinds: chunk, limit: LIMIT })
              }
            }
            const qVals = Array.from(
              new Set(
                [rootInfo.eventId, rootInfo.id]
                  .map((x) => (typeof x === 'string' ? x.trim() : ''))
                  .filter(Boolean)
              )
            )
            if (qVals.length > 0) {
              filters.push({
                '#q': qVals,
                kinds: qKindsHex,
                limit: LIMIT
              })
            }
            if (rootInfo.relay) {
              finalRelayUrls.push(rootInfo.relay)
            }
            for (const chunk of opRefChunks) {
              filters.push({ '#a': [rootInfo.id], kinds: chunk, limit: LIMIT })
              filters.push({ '#A': [rootInfo.id], kinds: chunk, limit: LIMIT })
            }
          } else if (rootInfo.type === 'I') {
            filters.push(...buildRssArticleUrlThreadInteractionFilters(rootInfo.id, LIMIT))
          }

          const relayUrlsForThreadReq = feedRelayPolicyUrls([{ source: 'fallback', urls: finalRelayUrls }], {
            operation: 'read',
            blockedRelays: replyBlockedRelays,
            applySocialKindBlockedFilter: false,
            allowThirdPartyLocalRelays: true
          })

          // For URL threads: stream events as they arrive from each relay so replies appear
          // immediately, rather than waiting up to 10 s for all relays to EOSE.
          const urlThreadRootInfo = rootInfo.type === 'I' ? rootInfo : null
          const urlThreadOnevent = urlThreadRootInfo
            ? (evt: NEvent) => {
                if (fetchGeneration !== replyFetchGenRef.current) return
                if (!isRssArticleUrlThreadInteraction(evt, urlThreadRootInfo.id)) return
                if (shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers))
                  return
                addReplies([evt])
                if (!hasCache) setLoading(false)
              }
            : undefined

          // Use fetchEvents instead of subscribeTimeline for one-time fetching
          const allReplies = await queryService.fetchEvents(
            relayUrlsForThreadReq,
            filters,
            urlThreadOnevent ? { onevent: urlThreadOnevent } : undefined
          )

          if (fetchGeneration !== replyFetchGenRef.current) return

          mergeFetchedKind7ReactionsIntoRootNoteStats(allReplies, rootInfo)

          // Filter and add replies (URL threads include kind 9802 highlights of this page)
          const regularReplies = allReplies.filter((evt) => {
            const match = replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot)
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
          
          // Always add all merged cached replies to UI
          // This ensures we keep all previously seen replies and add any new ones
          // addReplies will deduplicate, so it's safe to call even if some replies are already displayed
          if (mergedCachedReplies) {
            addReplies(mergedCachedReplies)
          } else {
            // Fallback: if cache somehow failed, at least add the fetched replies
            logger.warn('[ReplyNoteList] Cache returned null after store, using fetched replies only')
            addReplies(regularReplies)
          }

          const statsBatch = mergedCachedReplies?.length ? mergedCachedReplies : regularReplies
          if (statsBatch.length > 0) {
            noteStatsService.updateNoteStatsByEvents(statsBatch, event.pubkey, {
              statsRootEvent: event
            })
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
              .filter((evt) => commentKinds.includes(evt.kind))
              .map((evt) => evt.id)
            if (parentIds.length > 0) {
              const nestedAccum: NEvent[] = []
              for (let off = 0; off < parentIds.length; off += MAX_PARENT_IDS_PER_NESTED_REQ) {
                const idChunk = parentIds.slice(off, off + MAX_PARENT_IDS_PER_NESTED_REQ)
                const nestedFilters: Filter[] = [
                  { '#e': idChunk, kinds: commentKinds, limit: LIMIT }
                ]
                const nestedReplies = await queryService.fetchEvents(relayUrlsForThreadReq, nestedFilters, {
                  onevent: (evt: NEvent) => {
                    if (fetchGeneration !== replyFetchGenRef.current) return
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
                    .filter((evt) => commentKindsNested.includes(evt.kind))
                    .map((evt) => evt.id)
                ].filter(Boolean) as string[]
              )
            )
            if (parentIdsNested.length > 0) {
              const nestedAccum: NEvent[] = []
              for (let off = 0; off < parentIdsNested.length; off += MAX_PARENT_IDS_PER_NESTED_REQ) {
                const idChunk = parentIdsNested.slice(off, off + MAX_PARENT_IDS_PER_NESTED_REQ)
                const nestedFilters: Filter[] = [
                  { '#e': idChunk, kinds: commentKindsNested, limit: LIMIT },
                  {
                    '#E': idChunk,
                    kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT],
                    limit: LIMIT
                  }
                ]
                const nestedReplies = await queryService.fetchEvents(relayUrlsForThreadReq, nestedFilters, {
                  onevent: (evt: NEvent) => {
                    if (fetchGeneration !== replyFetchGenRef.current) return
                    if (shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers))
                      return
                    if (!replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot)) return
                    addReplies([evt])
                  }
                })
                if (fetchGeneration !== replyFetchGenRef.current) return
                nestedAccum.push(...nestedReplies)
              }
              const validNested = nestedAccum.filter(
                (evt) =>
                  !shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers) &&
                  replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot)
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
    currentIndex,
    index,
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
    isDiscussionRoot
  ])

  useEffect(() => {
    if (replies.length === 0 && !loading && timelineKey) {
      loadMore()
    }
  }, [replies.length, loading, timelineKey]) // More specific dependencies to prevent infinite loops

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 0.1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && showCount < mergedFeed.length) {
        setShowCount((prev) => prev + SHOW_COUNT)
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

  const loadMore = useCallback(async () => {
    if (loading || !until || !timelineKey) return

    setLoading(true)
    const events = await client.loadMoreTimeline(timelineKey, until, LIMIT)
    const olderEvents = events.filter((evt) => {
      if (!rootInfo) return false
      const matchesThread = replyMatchesThreadForList(evt, event, rootInfo, isDiscussionRoot)
      if (!matchesThread) return false
      return !shouldHideThreadResponseEvent(
        evt,
        mutePubkeySet,
        hideContentMentioningMutedUsers
      )
    })
    if (olderEvents.length > 0) {
      addReplies(olderEvents)
    }
    setUntil(events.length ? events[events.length - 1].created_at - 1 : undefined)
    setLoading(false)
  }, [
    loading,
    until,
    timelineKey,
    rootInfo,
    event,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    addReplies,
    isDiscussionRoot
  ])

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

  const visibleFeed = mergedFeed.slice(0, showCount)

  const shouldShowFeedItem = useCallback(
    (item: NEvent) => {
      if (shouldHideThreadResponseEvent(item, mutePubkeySet, hideContentMentioningMutedUsers)) {
        return false
      }
      const isQuote = quoteUiIdSet.has(item.id)
      if (isTrustLoaded && hideUntrustedInteractions && !isUserTrusted(item.pubkey)) {
        if (isQuote) return false
        if (rootInfo?.type !== 'I') {
          const repliesForThisReply = repliesMap.get(item.id)
          if (
            !repliesForThisReply ||
            repliesForThisReply.events.every((evt) => !isUserTrusted(evt.pubkey))
          ) {
            return false
          }
        }
      }
      return true
    },
    [
      mutePubkeySet,
      hideContentMentioningMutedUsers,
      quoteUiIdSet,
      isTrustLoaded,
      hideUntrustedInteractions,
      isUserTrusted,
      rootInfo?.type,
      repliesMap
    ]
  )

  const visibleForRender = useMemo(
    () => visibleFeed.filter(shouldShowFeedItem),
    [visibleFeed, shouldShowFeedItem]
  )

  const displayRows = useMemo(
    () => buildVisibleBacklinkRows(visibleForRender, quoteUiIdSet),
    [visibleForRender, quoteUiIdSet]
  )

  return (
    <NoteFeedProfileContext.Provider value={threadNoteFeedProfileValue}>
    <div className="min-h-[80vh] pb-12">
      {loading && <LoadingBar />}
      {!loading && until && (
        <div
          className={`text-sm text-center text-muted-foreground border-b py-2 ${!loading ? 'hover:text-foreground cursor-pointer' : ''}`}
          onClick={loadMore}
        >
          {t('load more older replies')}
        </div>
      )}
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
                    const replyNoteUrl = toNote(replyEvent)
                    window.history.pushState(null, '', replyNoteUrl)
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
      {quoteLoading && showQuotes && (
        <div className="mt-4 space-y-2">
          <ThreadQuoteBacklinkSkeleton />
        </div>
      )}
      {!loading && !quoteLoading && (
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