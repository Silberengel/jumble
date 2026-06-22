import { ExtendedKind, NOTE_STATS_OP_REFERENCE_KINDS, SINGLE_EVENT_BY_ID_QUERY_EOSE_TIMEOUT_MS } from '@/constants'
import { promiseWithTimeout } from '@/lib/async-timeout'
import { getParentEventHexId, isNip56ReportEvent, kind1QuotesThreadRoot } from '@/lib/event'
import { isSuperchatKind, isProfileWallSuperchat, replyFeedSuperchatsFirst } from '@/lib/superchat'
import { eventReferencesThreadTarget } from '@/lib/op-reference-tags'
import { muteSetHas } from '@/lib/mute-set'
import type { TRepliesMap } from '@/lib/reply-index'
import { replyBelongsToNoteThread } from '@/lib/thread-reply-root-match'
import { isRssArticleUrlThreadInteraction } from '@/lib/rss-web-feed'
import { isNostrTargetWebBookmark } from '@/lib/web-bookmark-nip'
import {
  collapseStaleAddressableRevisions,
  upsertEventMapPreferNewestAddressable
} from '@/lib/replaceable-revision'
import { shouldHideThreadResponseEvent } from '@/lib/thread-response-filter'
import { buildThreadInteractionFilters } from '@/lib/thread-interaction-req'
import { resolveLocalEventsByHexIds } from '@/lib/local-event-resolve'
import { getCachedThreadContextEvents } from '@/lib/navigation-related-events'
import noteStatsService from '@/services/note-stats.service'
import client, { eventService, queryService } from '@/services/client.service'
import type { TSubRequestFilter } from '@/types'
import { Filter, Event as NEvent, kinds, nip19 } from 'nostr-tools'
import type { TFunction } from 'i18next'
import type { TRootInfo, TThreadFeedItem, TBacklinkSubsection, TBacklinkDisplayRow } from './types'
import {
  MISSING_THREAD_REPLY_SEARCH_RELAY_TIMEOUT_MS,
  MISSING_THREAD_REPLY_SEARCH_TIMEOUT_MS,
  THREAD_REPLY_LIMIT
} from './constants'

export function threadResponseFilterOptions(rootInfo: TRootInfo | undefined) {
  return rootInfo?.type === 'I' ? { allowPageTargetedReactions: true as const } : undefined
}

export type { TRootInfo, TThreadFeedItem, TBacklinkSubsection, TBacklinkDisplayRow } from './types'
export {
  THREAD_REPLY_LIMIT,
  THREAD_REPLY_SHOW_COUNT,
  MAX_PARENT_IDS_PER_NESTED_REQ,
  THREAD_PROFILE_BATCH_DEBOUNCE_MS,
  THREAD_PROFILE_CHUNK
} from './constants'

/** Session + navigation context for parent walks while relay batches stream out-of-order. */
export function seedThreadWalkFromLocalContext(
  walk: Map<string, NEvent>,
  rootInfo: TRootInfo,
  opEvent: NEvent
): void {
  const opHex = openNoteHexId(opEvent)
  if (rootInfo.type === 'E' || rootInfo.type === 'A') {
    for (const e of eventService.getSessionThreadInteractionEvents(rootInfo, opHex)) {
      walk.set(e.id.toLowerCase(), e)
    }
  }
  for (const e of eventService.getSessionEventsForNoteStatsTarget(opEvent, { maxScan: 40_000 })) {
    walk.set(e.id.toLowerCase(), e)
  }
  for (const e of getCachedThreadContextEvents(opEvent)) {
    walk.set(e.id.toLowerCase(), e)
  }
}

export function openNoteHexId(event: Pick<NEvent, 'id'>): string | undefined {
  const id = event.id?.trim().toLowerCase()
  return id && /^[0-9a-f]{64}$/.test(id) ? id : undefined
}

/** Lowercase 64-char hex event id, or null when not a note id. */
export function normalizeHexEventId(id: string): string | null {
  const trimmed = id.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null
}

export function statsReplyHexIdsEqual(a: string, b: string): boolean {
  const ha = normalizeHexEventId(a)
  const hb = normalizeHexEventId(b)
  if (ha && hb) return ha === hb
  return a === b
}

/** Pointers to try for a stats-backed missing reply (hex first, then nevent / note1). */
export function missingStatsReplyLookupPointers(meta: { id: string; pubkey: string }): string[] {
  const hex = normalizeHexEventId(meta.id)
  if (!hex) return []
  const out = [hex]
  try {
    const pk = meta.pubkey?.trim()
    if (pk && /^[0-9a-f]{64}$/i.test(pk)) {
      out.push(nip19.neventEncode({ id: hex, author: pk.toLowerCase() }))
    }
    out.push(nip19.noteEncode(hex))
  } catch {
    /* hex-only */
  }
  return [...new Set(out)]
}

function acceptMissingStatsReplyEvent(ev: NEvent | undefined, hex: string): NEvent | undefined {
  return ev && statsReplyHexIdsEqual(ev.id, hex) ? ev : undefined
}

/** First task that returns an accepted event wins; all may run in parallel. */
function raceMissingStatsReplyFetches(
  tasks: Array<() => Promise<NEvent | undefined>>,
  hex: string
): Promise<NEvent | undefined> {
  if (tasks.length === 0) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    let settled = 0
    let found = false
    for (const run of tasks) {
      void run()
        .then((ev) => {
          settled++
          const hit = acceptMissingStatsReplyEvent(ev, hex)
          if (!found && hit) {
            found = true
            resolve(hit)
            return
          }
          if (settled >= tasks.length && !found) resolve(undefined)
        })
        .catch(() => {
          settled++
          if (settled >= tasks.length && !found) resolve(undefined)
        })
    }
  })
}

/**
 * Resolve one stats-backed missing reply. Parallel search-relay REQ + fetchEvent pipeline,
 * bounded so the UI does not wait on serial 40s+28s per pointer.
 */
export async function fetchMissingStatsReplyEvent(
  meta: { id: string; pubkey: string },
  relayUrls: readonly string[]
): Promise<NEvent | undefined> {
  const hex = normalizeHexEventId(meta.id)
  if (!hex) return undefined

  const urls = relayUrls.filter(Boolean)
  const tasks: Array<() => Promise<NEvent | undefined>> = []

  if (urls.length > 0) {
    tasks.push(async () => {
      const rows = await queryService.fetchEvents(
        urls,
        [{ ids: [hex], limit: 1 }],
        {
          foreground: true,
          globalTimeout: MISSING_THREAD_REPLY_SEARCH_RELAY_TIMEOUT_MS,
          eoseTimeout: SINGLE_EVENT_BY_ID_QUERY_EOSE_TIMEOUT_MS,
          immediateReturn: true,
          relayOpSource: 'MissingThreadReply.search'
        }
      )
      return rows.sort((a, b) => b.created_at - a.created_at)[0]
    })
  }

  tasks.push(async () => eventService.fetchEvent(hex, { threadContext: true }))

  return promiseWithTimeout(
    raceMissingStatsReplyFetches(tasks, hex),
    MISSING_THREAD_REPLY_SEARCH_TIMEOUT_MS
  )
}

/** Whether `evt` is a direct or nested reply under the opened note (not a sibling branch). */
export function replyIsInSubtreeBelowOpenNote(
  evt: NEvent,
  opHexLower: string,
  threadWalk: ReadonlyMap<string, NEvent>
): boolean {
  let cur: string | undefined = getParentEventHexId(evt)?.toLowerCase()
  if (!cur) return false
  if (cur === opHexLower) return true
  const seen = new Set<string>()
  for (let hop = 0; hop < 14 && cur; hop++) {
    if (seen.has(cur)) return false
    seen.add(cur)
    if (cur === opHexLower) return true
    const parentEv: NEvent | undefined =
      threadWalk.get(cur) ?? client.peekSessionCachedEvent(cur)
    if (!parentEv) return false
    cur = getParentEventHexId(parentEv)?.toLowerCase()
  }
  return false
}

/** Superchats are listed under “Antworten” but nested replies tag the payment id, not the thread root. */
export function mergeNestedThreadReplyParentEvents(
  displayedReplies: readonly NEvent[],
  relayBatch: readonly NEvent[]
): NEvent[] {
  const byId = new Map<string, NEvent>()
  for (const e of displayedReplies) byId.set(e.id.toLowerCase(), e)
  for (const e of relayBatch) {
    if (isSuperchatKind(e.kind)) {
      byId.set(e.id.toLowerCase(), e)
    }
  }
  return [...byId.values()]
}

function dedupeEventsFromRepliesMap(repliesMap: TRepliesMap): NEvent[] {
  const byId = new Map<string, NEvent>()
  for (const { events } of repliesMap.values()) {
    for (const evt of events) {
      upsertEventMapPreferNewestAddressable(byId, evt)
    }
  }
  return [...byId.values()]
}

export function buildNoteStatsReplyIdSet(
  replies: ReadonlyArray<{ id: string }> | undefined
): Set<string> {
  const out = new Set<string>()
  if (!replies?.length) return out
  for (const r of replies) {
    if (!r.id) continue
    const hex = normalizeHexEventId(r.id)
    out.add(hex ?? r.id)
  }
  return out
}

/** Resolve full events for ids already counted in note-stats (map → session LRU). */
export function resolveEventsForStatsReplyIds(
  statsReplies: ReadonlyArray<{ id: string }> | undefined,
  repliesMap: TRepliesMap
): NEvent[] {
  if (!statsReplies?.length) return []
  const fromMap = dedupeEventsFromRepliesMap(repliesMap)
  const byId = new Map(fromMap.map((e) => [normalizeHexEventId(e.id) ?? e.id, e]))
  const out: NEvent[] = []
  const seen = new Set<string>()
  for (const { id } of statsReplies) {
    const key = normalizeHexEventId(id) ?? id
    if (seen.has(key)) continue
    seen.add(key)
    const mapped = byId.get(key)
    if (mapped) {
      out.push(mapped)
      continue
    }
    const peek = peekThreadStatsReplyEvent(id, repliesMap)
    if (peek) out.push(peek)
  }
  return out
}

/** Map + session LRU lookup for a stats reply id (no network). */
export function peekThreadStatsReplyEvent(id: string, repliesMap: TRepliesMap): NEvent | undefined {
  const fromMap = dedupeEventsFromRepliesMap(repliesMap).find((e) => statsReplyHexIdsEqual(e.id, id))
  if (fromMap) return fromMap
  const hex = normalizeHexEventId(id)
  if (hex) return client.peekSessionCachedEvent(hex) ?? client.peekSessionCachedEvent(id)
  return client.peekSessionCachedEvent(id)
}

export type TStatsMissingPlacement = 'reply-middle' | 'tail'

/**
 * Where an unresolved stats reply id should appear when shown as a missing placeholder.
 * Bookmarks, lists, quotes, etc. belong in the backlinks tail — not the reply thread.
 */
export function classifyUnresolvedStatsReplyMissingPlacement(
  meta: { id: string; pubkey: string },
  rootInfo: TRootInfo | undefined,
  repliesMap: TRepliesMap,
  opts?: { bookmarkAuthorPubkeys?: ReadonlySet<string> }
): TStatsMissingPlacement {
  const peek = peekThreadStatsReplyEvent(meta.id, repliesMap)
  if (peek) {
    if (rootInfo && isEaThreadTailBacklinkCandidate(peek, rootInfo)) return 'tail'
    if (
      peek.kind === kinds.ShortTextNote ||
      peek.kind === ExtendedKind.COMMENT ||
      peek.kind === ExtendedKind.VOICE_COMMENT
    ) {
      return 'reply-middle'
    }
    if (NOTE_STATS_OP_REFERENCE_KINDS.includes(peek.kind)) return 'tail'
    return 'reply-middle'
  }
  if (opts?.bookmarkAuthorPubkeys?.has(meta.pubkey)) return 'tail'
  if (rootInfo?.type === 'E' || rootInfo?.type === 'A') return 'tail'
  return 'reply-middle'
}

export function partitionStatsRepliesForMissingPlaceholders(
  statsReplies: ReadonlyArray<{ id: string; pubkey: string; created_at: number }> | undefined,
  resolvedIds: ReadonlySet<string>,
  rootInfo: TRootInfo | undefined,
  repliesMap: TRepliesMap,
  opts?: { bookmarkAuthorPubkeys?: ReadonlySet<string> }
): {
  replyThread: Array<{ id: string; pubkey: string; created_at: number }>
  tail: Array<{ id: string; pubkey: string; created_at: number }>
} {
  const replyThread: Array<{ id: string; pubkey: string; created_at: number }> = []
  const tail: Array<{ id: string; pubkey: string; created_at: number }> = []
  for (const meta of statsReplies ?? []) {
    if (resolvedIds.has(meta.id) || [...resolvedIds].some((rid) => statsReplyHexIdsEqual(rid, meta.id))) {
      continue
    }
    if (classifyUnresolvedStatsReplyMissingPlacement(meta, rootInfo, repliesMap, opts) === 'tail') {
      tail.push(meta)
    } else {
      replyThread.push(meta)
    }
  }
  return { replyThread, tail }
}

/**
 * Primary reply list for “Antworten”: same rows as note-stats `replies`, then any extra thread rows.
 * Preserves stats ordering so the badge count matches rendered rows when events are resolvable.
 */
export function buildRepliesListAlignedWithNoteStats(
  statsReplies: ReadonlyArray<{ id: string; pubkey: string; created_at: number }> | undefined,
  repliesMap: TRepliesMap,
  threadDisplayed: NEvent[],
  mutePubkeySet: Set<string>,
  hideContentMentioningMutedUsers: boolean | undefined,
  rootInfo?: TRootInfo,
  isEventDeleted?: (event: NEvent) => boolean
): NEvent[] {
  const statsIds = buildNoteStatsReplyIdSet(statsReplies)
  const byId = new Map<string, NEvent>()
  const hideOpts = threadResponseFilterOptions(rootInfo)

  const keep = (evt: NEvent) => {
    if (isEventDeleted?.(evt)) return false
    if (isPollVoteKind(evt)) return false
    return !shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers, hideOpts)
  }

  for (const evt of resolveEventsForStatsReplyIds(statsReplies, repliesMap)) {
    if (keep(evt)) upsertEventMapPreferNewestAddressable(byId, evt)
  }
  for (const evt of threadDisplayed) {
    if (keep(evt)) upsertEventMapPreferNewestAddressable(byId, evt)
  }

  const ordered: NEvent[] = []
  const seen = new Set<string>()
  for (const meta of statsReplies ?? []) {
    const evt = byId.get(meta.id)
    if (!evt || seen.has(evt.id)) continue
    seen.add(evt.id)
    ordered.push(evt)
  }
  for (const evt of threadDisplayed) {
    if (seen.has(evt.id) || statsIds.has(evt.id)) continue
    if (!keep(evt)) continue
    seen.add(evt.id)
    ordered.push(evt)
  }
  return collapseStaleAddressableRevisions(ordered)
}

export function threadFeedItemCreatedAt(item: TThreadFeedItem): number {
  return item.type === 'event' ? item.event.created_at : item.created_at
}

export function threadFeedItemId(item: TThreadFeedItem): string {
  return item.type === 'event' ? item.event.id : item.id
}

export function eventsToThreadFeedItems(events: readonly NEvent[]): TThreadFeedItem[] {
  return events.map((event) => ({ type: 'event', event }))
}

/** Insert placeholder rows for stats reply ids that are not in the resolved thread list. */
export function insertMissingStatsReplyPlaceholders(
  sortedResolved: readonly NEvent[],
  statsReplies: ReadonlyArray<{ id: string; pubkey: string; created_at: number }> | undefined,
  sort: 'newest' | 'oldest' | 'top' | 'controversial' | 'most-zapped',
  opts?: {
    isEventDeleted?: (event: NEvent) => boolean
    mutePubkeySet?: Set<string>
  }
): TThreadFeedItem[] {
  const base = eventsToThreadFeedItems(sortedResolved)
  if (!statsReplies?.length) return base

  const resolvedIds = new Set(sortedResolved.map((r) => normalizeHexEventId(r.id) ?? r.id))
  const missing: Extract<TThreadFeedItem, { type: 'missing' }>[] = []

  for (const meta of statsReplies) {
    const metaKey = normalizeHexEventId(meta.id) ?? meta.id
    if (resolvedIds.has(metaKey)) continue
    if (!/^[0-9a-f]{64}$/i.test(meta.id)) continue
    if (opts?.mutePubkeySet && muteSetHas(opts.mutePubkeySet, meta.pubkey)) continue
    if (opts?.isEventDeleted) {
      const stub = {
        id: meta.id,
        pubkey: meta.pubkey,
        kind: kinds.ShortTextNote,
        tags: [],
        content: '',
        created_at: meta.created_at,
        sig: ''
      } as NEvent
      if (opts.isEventDeleted(stub)) continue
    }
    if (missing.some((m) => statsReplyHexIdsEqual(m.id, meta.id))) continue
    missing.push({
      type: 'missing',
      id: metaKey,
      pubkey: meta.pubkey,
      created_at: meta.created_at
    })
  }

  if (missing.length === 0) return base

  const out: TThreadFeedItem[] = [...base]
  const timeSort = sort === 'oldest' || sort === 'newest'

  for (const item of missing) {
    if (timeSort) {
      let insertAt = out.length
      for (let i = 0; i < out.length; i++) {
        const createdAt = threadFeedItemCreatedAt(out[i]!)
        if (sort === 'oldest') {
          if (item.created_at < createdAt) {
            insertAt = i
            break
          }
        } else if (item.created_at > createdAt) {
          insertAt = i
          break
        }
      }
      out.splice(insertAt, 0, item)
    } else {
      out.push(item)
    }
  }

  return out
}

/** Replies to show under “Antworten” for the opened note (direct + nested, not sibling branches). */
export function collectDisplayedThreadReplies(
  opEvent: NEvent,
  rootInfo: TRootInfo | undefined,
  repliesMap: TRepliesMap,
  isDiscussionRoot: boolean,
  mutePubkeySet: Set<string>,
  hideContentMentioningMutedUsers: boolean | undefined,
  /** Reply ids already counted on this note in note-stats — always show when loaded. */
  statsReplyIds?: ReadonlySet<string>,
  isEventDeleted?: (event: NEvent) => boolean
): NEvent[] {
  const threadWalk = new Map<string, NEvent>()
  for (const evt of dedupeEventsFromRepliesMap(repliesMap)) {
    threadWalk.set(evt.id.toLowerCase(), evt)
  }
  if (statsReplyIds) {
    for (const id of statsReplyIds) {
      const key = id.toLowerCase()
      if (threadWalk.has(key)) continue
      const peek = client.peekSessionCachedEvent(id)
      if (peek) threadWalk.set(key, peek)
    }
  }

  if (rootInfo?.type === 'I') {
    const opHex = openNoteHexId(opEvent)
    const out: NEvent[] = []
    const seen = new Set<string>()
    for (const evt of threadWalk.values()) {
      if (seen.has(evt.id)) continue
      if (isEventDeleted?.(evt)) continue
      if (isPollVoteKind(evt)) continue
      if (shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers, threadResponseFilterOptions(rootInfo))) continue
      if (statsReplyIds?.has(evt.id)) {
        seen.add(evt.id)
        out.push(evt)
        continue
      }
      if (!isRssArticleUrlThreadInteraction(evt, rootInfo.id)) continue
      if (
        opHex &&
        opEvent.kind !== ExtendedKind.RSS_THREAD_ROOT &&
        !replyIsInSubtreeBelowOpenNote(evt, opHex, threadWalk)
      ) {
        continue
      }
      seen.add(evt.id)
      out.push(evt)
    }
    return collapseStaleAddressableRevisions(out)
  }

  const opHex = openNoteHexId(opEvent)
  if (!opHex) return []

  const opHexLower = opHex.toLowerCase()
  /** Viewing the thread root itself (kind-1 note or a replaceable article instance). */
  const isThreadRootView =
    (rootInfo?.type === 'E' && rootInfo.id.trim().toLowerCase() === opHexLower) ||
    (rootInfo?.type === 'A' && rootInfo.eventId.trim().toLowerCase() === opHexLower)

  const out: NEvent[] = []
  const seen = new Set<string>()
  for (const evt of threadWalk.values()) {
    if (seen.has(evt.id)) continue
    if (isEventDeleted?.(evt)) continue
    if (isPollVoteKind(evt)) continue
    if (shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers, threadResponseFilterOptions(rootInfo))) continue
    if (statsReplyIds?.has(evt.id)) {
      if (
        isSuperchatKind(evt.kind) &&
        !shouldIncludeSuperchatInThreadReply(
          evt,
          opEvent,
          rootInfo,
          isDiscussionRoot,
          threadWalk,
          opEvent.pubkey
        )
      ) {
        continue
      }
      seen.add(evt.id)
      out.push(evt)
      continue
    }
    if (rootInfo && !replyMatchesThreadForList(evt, opEvent, rootInfo, isDiscussionRoot, threadWalk)) {
      continue
    }
    if (!isThreadRootView && !replyIsInSubtreeBelowOpenNote(evt, opHex, threadWalk)) continue
    seen.add(evt.id)
    out.push(evt)
  }
  return collapseStaleAddressableRevisions(out)
}

/** Session LRU + publication store + archive + replaceable lists: paint thread replies before relay round-trip. */
export async function loadThreadRepliesFromLocalStores(
  rootInfo: TRootInfo,
  opEvent: NEvent,
  isDiscussionRoot: boolean,
  mutePubkeySet: Set<string>,
  hideContentMentioningMutedUsers: boolean | undefined,
  opts?: { statsReplyIds?: readonly string[] }
): Promise<NEvent[]> {
  const filters = buildThreadInteractionFilters({
    root: rootInfo,
    opEventKind: opEvent.kind,
    opEventHexId: openNoteHexId(opEvent),
    limit: THREAD_REPLY_LIMIT
  })
  if (!filters.length && !opts?.statsReplyIds?.length) return []

  const byId = new Map<string, NEvent>()
  const push = (rows: NEvent[]) => {
    for (const evt of rows) {
      if (!byId.has(evt.id)) byId.set(evt.id, evt)
    }
  }

  push(
    eventService.getSessionEventsForNoteStatsTarget(opEvent, { maxScan: 40_000 })
  )
  if (rootInfo.type === 'E' || rootInfo.type === 'A') {
    push(
      eventService.getSessionThreadInteractionEvents(rootInfo, openNoteHexId(opEvent))
    )
  }

  if (opts?.statsReplyIds?.length) {
    push(await resolveLocalEventsByHexIds(opts.statsReplyIds))
  }

  if (filters.length > 0) {
    try {
      push(
        await client.getLocalFeedEvents(
          filters.map((filter) => ({ urls: [], filter: filter as TSubRequestFilter })),
          { maxMatches: THREAD_REPLY_LIMIT, maxRowsScanned: 28_000 }
        )
      )
    } catch {
      /* optional */
    }
  }

  const local = [...byId.values()]
  const threadWalk = new Map(local.map((e) => [e.id.toLowerCase(), e] as const))
  return local.filter((evt) => {
    if (isPollVoteKind(evt)) return false
    if (shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers, threadResponseFilterOptions(rootInfo))) return false
    if (rootInfo.type === 'I') {
      return isRssArticleUrlThreadInteraction(evt, rootInfo.id)
    }
    return replyMatchesThreadForList(evt, opEvent, rootInfo, isDiscussionRoot, threadWalk)
  })
}

const STATS_HYDRATE_FETCH_CHUNK = 40
const STATS_HYDRATE_RELAY_IDS_CHUNK = 200

export type HydrateThreadRepliesFromStatsOpts = {
  relayUrls?: string[]
  mutePubkeySet?: Set<string>
  hideContentMentioningMutedUsers?: boolean | undefined
}

/**
 * Resolve reply ids already counted in note-stats (archive, session, fetch, relay `ids` REQ).
 * Does not re-apply thread-match filters — stats and UI counts must stay aligned.
 */
export async function hydrateThreadRepliesFromStats(
  candidates: ReadonlyArray<{ id: string }>,
  opts?: HydrateThreadRepliesFromStatsOpts
): Promise<NEvent[]> {
  if (!candidates.length) return []

  const ids = [
    ...new Set(
      candidates
        .map((c) => c.id.trim())
        .filter((id) => /^[0-9a-f]{64}$/i.test(id))
    )
  ]
  if (!ids.length) return []

  const byId = new Map<string, NEvent>()

  for (const ev of await resolveLocalEventsByHexIds(ids)) {
    byId.set(ev.id, ev)
  }

  const missingAfterLocal = ids.filter((id) => !byId.has(id))
  for (let i = 0; i < missingAfterLocal.length; i += STATS_HYDRATE_FETCH_CHUNK) {
    const chunk = missingAfterLocal.slice(i, i + STATS_HYDRATE_FETCH_CHUNK)
    await Promise.allSettled(
      chunk.map(async (id) => {
        try {
          const ev = await eventService.fetchEvent(id)
          if (ev) byId.set(ev.id, ev)
        } catch {
          /* optional */
        }
      })
    )
  }

  const relayUrls = (opts?.relayUrls ?? []).filter(Boolean)
  const missingAfterFetch = ids.filter((id) => !byId.has(id))
  if (missingAfterFetch.length > 0 && relayUrls.length > 0) {
    for (let i = 0; i < missingAfterFetch.length; i += STATS_HYDRATE_RELAY_IDS_CHUNK) {
      const chunk = missingAfterFetch.slice(i, i + STATS_HYDRATE_RELAY_IDS_CHUNK)
      try {
        const fromRelay = await queryService.fetchEvents(
          relayUrls,
          [{ ids: chunk, limit: chunk.length }],
          {
            foreground: true,
            globalTimeout: 12_000,
            relayOpSource: 'ReplyNoteList.statsHydrate'
          }
        )
        for (const e of fromRelay) byId.set(e.id, e)
      } catch {
        /* optional */
      }
    }
  }

  const batch: NEvent[] = []
  for (const id of ids) {
    const ev = byId.get(id)
    if (!ev) continue
    if (isPollVoteKind(ev)) continue
    if (
      opts?.mutePubkeySet &&
      shouldHideThreadResponseEvent(ev, opts.mutePubkeySet, opts.hideContentMentioningMutedUsers)
    ) {
      continue
    }
    batch.push(ev)
  }
  return batch
}

export async function fetchPaymentAttestationsForRecipient(
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
        foreground: options.foreground,
        eoseTimeout: options.foreground ? 1600 : 4500,
        globalTimeout: options.foreground ? 5000 : 12_000
      })
      for (const e of rows) byId.set(e.id, e)
    } catch {
      /* optional */
    }
  }
  return [...byId.values()]
}

export function replyFeedZapsFirst(sortedNonZapReplies: NEvent[], superchats: NEvent[]) {
  return replyFeedSuperchatsFirst(sortedNonZapReplies, superchats)
}

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
export function partitionAndSortBacklinkTail(tail: NEvent[]): NEvent[] {
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

export function buildVisibleBacklinkRows(
  visibleFeed: TThreadFeedItem[],
  quoteUiIdSet: Set<string>
): TBacklinkDisplayRow[] {
  const rows: TBacklinkDisplayRow[] = []
  let i = 0
  while (i < visibleFeed.length) {
    const item = visibleFeed[i]!
    if (item.type === 'missing') {
      rows.push({
        type: 'missing-reply',
        id: item.id,
        pubkey: item.pubkey,
        created_at: item.created_at
      })
      i++
      continue
    }
    const evt = item.event
    if (!quoteUiIdSet.has(evt.id)) {
      rows.push({ type: 'reply', event: evt })
      i++
      continue
    }
    const sub = backlinkTailSubsection(evt)
    const run: NEvent[] = []
    while (i < visibleFeed.length) {
      const cur = visibleFeed[i]
      if (cur?.type !== 'event') break
      if (!quoteUiIdSet.has(cur.event.id)) break
      if (backlinkTailSubsection(cur.event) !== sub) break
      run.push(cur.event)
      i++
    }
    if (run.length > 0) {
      rows.push({ type: 'backlink-run', subsection: sub, events: run })
    }
  }
  return rows
}

export function backlinkRunSectionClass(
  subsection: TBacklinkSubsection,
  prev: TBacklinkDisplayRow | undefined
): string {
  if (!prev) {
    return subsection === 'report'
      ? 'mb-3 pt-1'
      : 'mb-3 pt-1'
  }
  if (prev.type === 'reply' || prev.type === 'missing-reply') {
    return subsection === 'report'
      ? 'mt-8 mb-3 border-t border-amber-500/40 pt-6 dark:border-amber-400/30'
      : 'mt-8 mb-3 border-t border-border/60 pt-6'
  }
  return subsection === 'report'
    ? 'mt-6 mb-3 border-t border-amber-500/40 pt-4 dark:border-amber-400/30'
    : 'mt-6 mb-3 border-t border-border/60 pt-4'
}

/** Preserve order except NIP-56 reports move to the end (after all non-reports). */
export function moveReportsToEndPreserveOrder(events: NEvent[]): NEvent[] {
  const non = events.filter((e) => !isNip56ReportEvent(e))
  const rep = events.filter((e) => isNip56ReportEvent(e))
  return [...non, ...rep]
}

/** Shown after thread replies for E/A roots (quote stream + kind 1 #q-only); matches {@link NOTE_STATS_OP_REFERENCE_KINDS}. */
export const EA_THREAD_TAIL_REFERENCE_KINDS = new Set<number>(NOTE_STATS_OP_REFERENCE_KINDS)

export function isWebThreadTailKind(kind: number): boolean {
  return EA_THREAD_TAIL_REFERENCE_KINDS.has(kind)
}

/** Kind 1111 / 1244 that includes the thread root id on an e/E tag (common on relays; stricter root-tag walks may miss these). */
export function commentReferencesThreadRootEventHex(evt: NEvent, rootHexLower: string): boolean {
  if (evt.kind !== ExtendedKind.COMMENT && evt.kind !== ExtendedKind.VOICE_COMMENT) return false
  const h = rootHexLower.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(h)) return false
  return evt.tags.some(
    (t) => (t[0] === 'e' || t[0] === 'E') && typeof t[1] === 'string' && t[1].toLowerCase() === h
  )
}

export function replyIdPresentInRepliesMap(
  map: Map<string, { events: NEvent[]; eventIdSet: Set<string> }>,
  replyId: string
): boolean {
  for (const { events } of map.values()) {
    if (events.some((e) => statsReplyHexIdsEqual(e.id, replyId))) return true
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
export function mergeFetchedKind7ReactionsIntoRootNoteStats(all: NEvent[], rootInfo: TRootInfo) {
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

export function replyMatchesThreadForList(
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
    isSuperchatKind(evt.kind) &&
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
  if (
    (rootInfo.type === 'E' || rootInfo.type === 'A') &&
    isNostrTargetWebBookmark(evt) &&
    eventReferencesThreadTarget(evt, rootInfo)
  ) {
    return true
  }
  return false
}

/** Attested superchat / zap rows allowed under “Antworten” for the opened note. */
export function shouldIncludeSuperchatInThreadReply(
  evt: NEvent,
  opEvent: NEvent,
  rootInfo: TRootInfo | undefined,
  isDiscussionRoot: boolean,
  threadWalk: ReadonlyMap<string, NEvent>,
  recipientPubkey?: string
): boolean {
  if (!isSuperchatKind(evt.kind)) return false
  if (!rootInfo) return false
  if (recipientPubkey && isProfileWallSuperchat(evt, recipientPubkey)) return false

  const opHex = openNoteHexId(opEvent)?.toLowerCase()
  if (!opHex) return false

  const directTargetHex = getParentEventHexId(evt)?.toLowerCase()
  if (directTargetHex === opHex) return true

  if (!replyMatchesThreadForList(evt, opEvent, rootInfo, isDiscussionRoot, threadWalk)) {
    return false
  }
  const viewingThreadRoot =
    (rootInfo.type === 'E' && rootInfo.id.trim().toLowerCase() === opHex) ||
    (rootInfo.type === 'A' && rootInfo.eventId.trim().toLowerCase() === opHex)
  if (!viewingThreadRoot && !replyIsInSubtreeBelowOpenNote(evt, opHex, threadWalk)) {
    return false
  }
  return true
}

/** NIP-69 poll responses (kind 1018): aggregated in the poll UI, not as thread rows under “Antworten”. */
export function isPollVoteKind(evt: Pick<NEvent, 'kind'>): boolean {
  return evt.kind === ExtendedKind.POLL_RESPONSE
}

export function threadBacklinkRelationLabel(item: NEvent, t: TFunction): string {
  if (item.kind === kinds.Highlights) return t('highlighted this note')
  if (item.kind === ExtendedKind.WEB_BOOKMARK) {
    return t('saved a web bookmark', { defaultValue: 'Saved a web bookmark' })
  }
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
export function isEaThreadTailBacklinkCandidate(evt: NEvent, root: TRootInfo): boolean {
  if (root.type !== 'E' && root.type !== 'A') return false
  if (evt.kind === kinds.ShortTextNote && kind1QuotesThreadRoot(evt, root)) return true
  if (isNostrTargetWebBookmark(evt) && eventReferencesThreadTarget(evt, root)) return true
  return EA_THREAD_TAIL_REFERENCE_KINDS.has(evt.kind)
}
