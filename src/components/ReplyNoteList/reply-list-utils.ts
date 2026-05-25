import { ExtendedKind, NOTE_STATS_OP_REFERENCE_KINDS } from '@/constants'
import { isNip56ReportEvent, kind1QuotesThreadRoot } from '@/lib/event'
import { isSuperchatKind, replyFeedSuperchatsFirst } from '@/lib/superchat'
import { eventReferencesThreadTarget } from '@/lib/op-reference-tags'
import { replyBelongsToNoteThread } from '@/lib/thread-reply-root-match'
import { isRssArticleUrlThreadInteraction } from '@/lib/rss-web-feed'
import { shouldHideThreadResponseEvent } from '@/lib/thread-response-filter'
import { buildThreadInteractionFilters } from '@/lib/thread-interaction-req'
import noteStatsService from '@/services/note-stats.service'
import client, { eventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { TSubRequestFilter } from '@/types'
import { Filter, Event as NEvent, kinds } from 'nostr-tools'
import type { TFunction } from 'i18next'
import type { TRootInfo } from './types'
import { THREAD_REPLY_LIMIT } from './types'

export type { TRootInfo } from './types'
export {
  THREAD_REPLY_LIMIT,
  THREAD_REPLY_SHOW_COUNT,
  MAX_PARENT_IDS_PER_NESTED_REQ,
  THREAD_PROFILE_BATCH_DEBOUNCE_MS,
  THREAD_PROFILE_CHUNK
} from './types'

/** Session LRU + publication store + archive: paint thread replies before relay round-trip. */
export async function loadThreadRepliesFromLocalStores(
  rootInfo: TRootInfo,
  opEvent: NEvent,
  isDiscussionRoot: boolean,
  mutePubkeySet: Set<string>,
  hideContentMentioningMutedUsers: boolean | undefined
): Promise<NEvent[]> {
  const filters = buildThreadInteractionFilters({
    root: rootInfo,
    opEventKind: opEvent.kind,
    limit: THREAD_REPLY_LIMIT
  })
  if (!filters.length) return []

  let local: NEvent[] = []
  try {
    local = await client.getLocalFeedEvents(
      filters.map((filter) => ({ urls: [], filter: filter as TSubRequestFilter })),
      { maxMatches: THREAD_REPLY_LIMIT, maxRowsScanned: 28_000 }
    )
  } catch {
    return []
  }

  const threadWalk = new Map(local.map((e) => [e.id.toLowerCase(), e] as const))
  return local.filter((evt) => {
    if (isPollVoteKind(evt)) return false
    if (shouldHideThreadResponseEvent(evt, mutePubkeySet, hideContentMentioningMutedUsers)) return false
    if (rootInfo.type === 'I') {
      return isRssArticleUrlThreadInteraction(evt, rootInfo.id)
    }
    return replyMatchesThreadForList(evt, opEvent, rootInfo, isDiscussionRoot, threadWalk)
  })
}

/** Resolve reply ids from note-stats via archive + session fetch, then thread-match filter. */
export async function hydrateThreadRepliesFromStats(
  candidates: ReadonlyArray<{ id: string }>,
  rootInfo: TRootInfo,
  opEvent: NEvent,
  isDiscussionRoot: boolean
): Promise<NEvent[]> {
  if (!candidates.length) return []

  const ids = candidates.map((c) => c.id)
  const byId = new Map<string, NEvent>()
  try {
    const archived = await indexedDb.getArchivedEventsByIds(ids)
    for (const e of archived) byId.set(e.id, e)
  } catch {
    /* optional */
  }
  for (const id of ids) {
    if (byId.has(id)) continue
    try {
      const ev = await eventService.fetchEvent(id)
      if (ev) byId.set(ev.id, ev)
    } catch {
      /* optional */
    }
  }

  const batch: NEvent[] = []
  for (const ev of byId.values()) {
    if (isPollVoteKind(ev)) continue
    if (rootInfo.type === 'I') {
      if (!isRssArticleUrlThreadInteraction(ev, rootInfo.id)) continue
    } else if (!replyMatchesThreadForList(ev, opEvent, rootInfo, isDiscussionRoot)) {
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

export type TBacklinkSubsection = 'primary' | 'bookmark' | 'list' | 'report'

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

export type TBacklinkDisplayRow =
  | { type: 'reply'; event: NEvent }
  | { type: 'backlink-run'; subsection: TBacklinkSubsection; events: NEvent[] }

export function buildVisibleBacklinkRows(
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

export function backlinkRunSectionClass(
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
  return false
}

/** NIP-69 poll responses (kind 1018): aggregated in the poll UI, not as thread rows under “Antworten”. */
export function isPollVoteKind(evt: Pick<NEvent, 'kind'>): boolean {
  return evt.kind === ExtendedKind.POLL_RESPONSE
}

export function threadBacklinkRelationLabel(item: NEvent, t: TFunction): string {
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
export function isEaThreadTailBacklinkCandidate(evt: NEvent, root: TRootInfo): boolean {
  if (root.type !== 'E' && root.type !== 'A') return false
  if (evt.kind === kinds.ShortTextNote && kind1QuotesThreadRoot(evt, root)) return true
  return EA_THREAD_TAIL_REFERENCE_KINDS.has(evt.kind)
}
