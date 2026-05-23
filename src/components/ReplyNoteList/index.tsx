import { ExtendedKind, NOTE_STATS_OP_REFERENCE_KINDS } from '@/constants'
import { isDiscussionDownvoteEmoji, isDiscussionUpvoteEmoji } from '@/lib/discussion-votes'
import {
  canonicalizeRssArticleUrl,
  getArticleUrlFromCommentITags
} from '@/lib/rss-article'
import {
  getParentETag,
  getReplaceableCoordinateFromEvent,
  getRootATag,
  getRootETag,
  isNip56ReportEvent,
  isMentioningMutedUsers,
  isNip18RepostKind,
  isReplaceableEvent,
  kind1QuotesThreadRoot,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import logger from '@/lib/logger'
import {
  getPaymentAttestationTargetId,
  partitionAttestedSuperchats,
  replyFeedSuperchatsFirst
} from '@/lib/superchat'
import { muteSetHas } from '@/lib/mute-set'
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
import { collectProfilePubkeysFromEvents } from '@/lib/profile-batch-coordinator'
import { buildReplyReadRelayList, relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { buildThreadInteractionFilters, buildThreadSuperchatPriorityFilters } from '@/lib/thread-interaction-req'
import {
  resolveAttestedPaymentIdSet
} from '@/lib/payment-attestation-cache'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { eventReferencesThreadTarget } from '@/lib/op-reference-tags'
import { replyBelongsToNoteThread } from '@/lib/thread-reply-root-match'
import { buildRssWebNostrQueryRelayUrls, isRssArticleUrlThreadInteraction } from '@/lib/rss-web-feed'
import type { TProfile, TSubRequestFilter } from '@/types'
import { Filter, Event as NEvent, kinds } from 'nostr-tools'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { LoadingBar } from '../LoadingBar'
import ReplyNote, { ReplyNoteSkeleton } from '../ReplyNote'
import ThreadQuoteBacklink, { BacklinkAvatarStrip } from './ThreadQuoteBacklink'

type TRootInfo =
  | { type: 'E'; id: string; pubkey: string }
  | { type: 'A'; id: string; eventId: string; pubkey: string; relay?: string }
  | { type: 'I'; id: string }

const LIMIT = 200
const SHOW_COUNT = 10
/** Some relays cap `#e` array length; chunk parent-id batches for nested-thread REQs. */
const MAX_PARENT_IDS_PER_NESTED_REQ = 64
/** Short debounce so thread / detail headers populate avatars quickly after events arrive. */
const THREAD_PROFILE_BATCH_DEBOUNCE_MS = 120
const THREAD_PROFILE_CHUNK = 80

async function hydrateAttestedSuperchatTargets(
  attestedIds: ReadonlySet<string>,
  relayUrls: string[]
): Promise<NEvent[]> {
  const ids = [...attestedIds].filter((id) => /^[0-9a-f]{64}$/i.test(id))
  if (ids.length === 0) return []

  const byId = new Map<string, NEvent>()
  try {
    const local = await client.getLocalFeedEvents(
      [{ urls: [], filter: { ids, limit: ids.length } }],
      { maxMatches: ids.length }
    )
    for (const e of local) byId.set(e.id.toLowerCase(), e)
  } catch {
    /* optional */
  }

  const missing = ids.filter((id) => !byId.has(id.toLowerCase()))
  if (missing.length > 0 && relayUrls.length > 0) {
    try {
      const fetched = await client.fetchEvents(
        relayUrls,
        { ids: missing, limit: missing.length },
        { cache: true, eoseTimeout: 4500, globalTimeout: 12_000 }
      )
      for (const e of fetched) byId.set(e.id.toLowerCase(), e)
    } catch {
      /* optional */
    }
  }

  return [...byId.values()]
}

async function fetchPaymentAttestationsForRecipient(
  recipientPubkey: string,
  relayUrls: string[],
  options: { foreground?: boolean } = {}
): Promise<NEvent[]> {
  const filter: Filter = {
    kinds: [ExtendedKind.PAYMENT_ATTESTATION],
    authors: [recipientPubkey],
    limit: 500
  }
  const byId = new Map<string, NEvent>()
  try {
    const local = await client.getLocalFeedEvents(
      [{ urls: [], filter: filter as TSubRequestFilter }],
      { maxMatches: 500 }
    )
    for (const e of local) byId.set(e.id, e)
  } catch {
    /* optional */
  }
  if (relayUrls.length > 0) {
    try {
      const rows = await client.fetchEvents(relayUrls, filter, {
        cache: true,
        eoseTimeout: 4500,
        globalTimeout: 12_000,
        foreground: options.foreground
      })
      for (const e of rows) byId.set(e.id, e)
    } catch {
      /* optional */
    }
  }
  return [...byId.values()]
}

function replyFeedZapsFirst(sortedNonZapReplies: NEvent[], superchats: NEvent[]) {
  return replyFeedSuperchatsFirst(sortedNonZapReplies, superchats)
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

/** Shown after thread replies for E/A roots (quote stream + kind 1 #q-only); matches {@link NOTE_STATS_OP_REFERENCE_KINDS}. */
const EA_THREAD_TAIL_REFERENCE_KINDS = new Set<number>(NOTE_STATS_OP_REFERENCE_KINDS)

function isWebThreadTailKind(kind: number): boolean {
  return EA_THREAD_TAIL_REFERENCE_KINDS.has(kind)
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
 * Thread REQ may still omit some kind-7 rows; merge reactions that tag the root hex so OP stats stay warm.
 * Reactions are not listed under “Antworten”; this merge keeps OP stats warm when the thread REQ omits kind 7.
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
  isDiscussionRoot: boolean,
  /** Events from the current relay batch (parent walk may not be in session LRU yet). */
  threadWalkLocal?: ReadonlyMap<string, NEvent>
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
  if (replyBelongsToNoteThread(evt, opEvent, rootInfo, threadWalkLocal)) return true
  if (
    evt.kind === kinds.Zap &&
    (rootInfo.type === 'E' || rootInfo.type === 'A') &&
    eventReferencesThreadTarget(evt, rootInfo)
  ) {
    return true
  }
  if (
    evt.kind === ExtendedKind.PAYMENT_NOTIFICATION &&
    (rootInfo.type === 'E' || rootInfo.type === 'A') &&
    eventReferencesThreadTarget(evt, rootInfo)
  ) {
    return true
  }
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

/** NIP-69 poll responses (kind 1018): aggregated in the poll UI, not as thread rows under “Antworten”. */
function isPollVoteKind(evt: Pick<NEvent, 'kind'>): boolean {
  return evt.kind === ExtendedKind.POLL_RESPONSE
}

function threadBacklinkRelationLabel(item: NEvent, t: TFunction): string {
  if (item.kind === kinds.Highlights) return t('highlighted this note')
  if (item.kind === kinds.ShortTextNote) return t('quoted this note')
  if (
    item.kind === kinds.LongFormArticle ||
    item.kind === ExtendedKind.WIKI_ARTICLE ||
    item.kind === ExtendedKind.NOSTR_SPECIFICATION ||
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

/** E/A roots: kind-1 #q quotes + op-reference kinds belong in backlinks tail, not the chronological middle. */
function isEaThreadTailBacklinkCandidate(evt: NEvent, root: TRootInfo): boolean {
  if (root.type !== 'E' && root.type !== 'A') return false
  if (evt.kind === kinds.ShortTextNote && kind1QuotesThreadRoot(evt, root)) return true
  return EA_THREAD_TAIL_REFERENCE_KINDS.has(evt.kind)
}

function ReplyNoteList({
  index,
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
  const { currentIndex } = useSecondaryPage()
  const { hideUntrustedInteractions, isUserTrusted, isTrustLoaded } = useUserTrust()
  const noteStats = useNoteStatsById(event.id)
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const { pubkey: userPubkey } = useNostr()
  const { zapReplyThreshold } = useZap()
  const [attestedPaymentIds, setAttestedPaymentIds] = useState<Set<string>>(() => new Set())
  const threadRelayUrlsRef = useRef<string[]>([])
  const { blockedRelays, favoriteRelays } = useFavoriteRelays()
  const { relayUrls: browsingRelayUrls } = useCurrentRelays()
  const relayAuthoritativeRead =
    singleRelayAuthoritativeRead ?? browsingRelayUrls.length === 1
  const [rootInfo, setRootInfo] = useState<TRootInfo | undefined>(undefined)
  const { repliesMap, addReplies } = useReply()
  const isDiscussionRoot = event.kind === ExtendedKind.DISCUSSION

  const replyDuplicateWebPreviewHints = useMemo(() => {
    const out: string[] = [...(duplicateWebPreviewCleanedUrlHints ?? [])]
    if (rootInfo?.type === 'I') out.push(rootInfo.id)
    return out.length ? out : undefined
  }, [duplicateWebPreviewCleanedUrlHints, rootInfo])

  useEffect(() => {
    const pk = event.pubkey
    if (!pk) return
    let cancelled = false
    void (async () => {
      const ids = await resolveAttestedPaymentIdSet(pk)
      if (cancelled) return
      setAttestedPaymentIds(ids)
      const relayHints = threadRelayUrlsRef.current.length
        ? threadRelayUrlsRef.current
        : browsingRelayUrls.map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean)
      const targets = await hydrateAttestedSuperchatTargets(ids, relayHints)
      if (cancelled) return
      if (targets.length > 0) addReplies(targets)
    })()
    return () => {
      cancelled = true
    }
  }, [event.pubkey, event.id, addReplies, browsingRelayUrls])

  useEffect(() => {
    const handleAttestation = (data: Event) => {
      const ce = data as CustomEvent<NEvent>
      const evt = ce.detail
      if (!evt || evt.kind !== ExtendedKind.PAYMENT_ATTESTATION) return
      if (evt.pubkey.toLowerCase() !== event.pubkey.toLowerCase()) return
      const targetId = getPaymentAttestationTargetId(evt)
      if (!targetId) return
      setAttestedPaymentIds((prev) => {
        if (prev.has(targetId)) return prev
        const next = new Set(prev)
        next.add(targetId)
        return next
      })
      void client
        .fetchEvent(targetId, { relayHints: threadRelayUrlsRef.current })
        .then((target) => {
          if (target) addReplies([target])
        })
        .catch(() => {
          /* optional */
        })
    }
    client.addEventListener('newEvent', handleAttestation)
    return () => client.removeEventListener('newEvent', handleAttestation)
  }, [event.pubkey, addReplies])

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
        if (isPollVoteKind(evt)) return
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
    


    const { superchats, rest: nonZaps } = partitionAttestedSuperchats(
      replyEvents,
      attestedPaymentIds,
      zapReplyThreshold
    )
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
    zapReplyThreshold,
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
      const { superchats, rest: nonZaps } = partitionAttestedSuperchats(
        merged,
        attestedPaymentIds,
        zapReplyThreshold
      )
      const sortedNon = [...nonZaps].sort((a, b) =>
        direction === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
      )
      return moveReportsToEndPreserveOrder(replyFeedSuperchatsFirst(sortedNon, superchats))
    }

    if (!showQuotes) return replies

    // E/A: zaps (sats desc) → thread replies (1 / 1111 / 1244, excluding #q-only) → tail (quotes, highlights, long-form refs)
    if (rootInfo?.type === 'E' || rootInfo?.type === 'A') {
      const { superchats, rest: nonZaps } = partitionAttestedSuperchats(
        replies,
        attestedPaymentIds,
        zapReplyThreshold
      )
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
      const { superchats, rest: nonZaps } = partitionAttestedSuperchats(
        replies,
        attestedPaymentIds,
        zapReplyThreshold
      )
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
  }, [replies, showQuotes, sort, replyIdSet, rootInfo, event.kind, attestedPaymentIds, zapReplyThreshold])

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
          if (ev && replyMatchesThreadForList(ev, event, threadRoot, true) && !isPollVoteKind(ev)) {
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

      if (hasCache && cachedData) {
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
            limit: LIMIT
          })

          const relayUrlsForThreadReq = sanitizeRelayUrlsForFetch(
            feedRelayPolicyUrls([{ source: 'fallback', urls: finalRelayUrls }], {
              operation: 'read',
              blockedRelays: replyBlockedRelays,
              applySocialKindBlockedFilter: false,
              allowThirdPartyLocalRelays: false
            })
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
            limit: LIMIT
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
                foreground: statsForeground
              })
            : Promise.resolve([] as NEvent[])

          const [allReplies, relayAttestations] = await Promise.all([
            queryService.fetchEvents(relayUrlsForThreadReq, filters, {
              onevent: streamThreadReply,
              foreground: true,
              firstRelayResultGraceMs: 900,
              globalTimeout: 12_000,
              relayOpSource: 'ReplyNoteList.thread'
            }),
            attestationTask
          ])

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

          if (recipientPubkey) {
            void resolveAttestedPaymentIdSet(recipientPubkey, relayAttestations)
              .then(async (attestedIds) => {
                if (fetchGeneration !== replyFetchGenRef.current) return
                setAttestedPaymentIds(attestedIds)
                const targets = await hydrateAttestedSuperchatTargets(
                  attestedIds,
                  relayUrlsForThreadReq
                )
                if (fetchGeneration !== replyFetchGenRef.current) return
                if (targets.length > 0) addReplies(targets)
              })
              .catch(() => {
                /* attestations optional */
              })
          }

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
                    .filter((evt) => commentKindsNested.includes(evt.kind))
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
    isDiscussionRoot,
    statsForeground
  ])

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
      if (item.kind === kinds.Zap || item.kind === ExtendedKind.PAYMENT_NOTIFICATION) return true
      // Backlink rows (quotes, highlights, …): show even when author is not in the trust list.
      if (isQuote) return true
      if (isTrustLoaded && hideUntrustedInteractions && !isUserTrusted(item.pubkey)) {
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