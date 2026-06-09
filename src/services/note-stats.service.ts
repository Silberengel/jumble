import { ExtendedKind, NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT } from '@/constants'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import {
  getNip18RepostTargetId,
  getParentEventHexId,
  getReplaceableCoordinateFromEvent,
  isNip18RepostKind,
  isNip25ReactionKind,
  isReplaceableEvent
} from '@/lib/event'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { appendMoneroNostrRelays } from '@/lib/monero-nostr-relays'
import { getMoneroTipInfo, xmrToPiconeros } from '@/lib/monero-tip'
import { piconerosToSats } from '@/lib/sats-fiat'
import { getCachedBtcUsdRate } from '@/lib/btc-usd-rate'
import { getCachedXmrUsdRate } from '@/lib/xmr-usd-rate'
import { getPaymentNotificationInfo } from '@/lib/superchat'
import logger from '@/lib/logger'
import {
  canonicalizeRssArticleUrl,
  expandArticleUrlThreadQueryValues,
  getArticleUrlFromCommentITags,
  getHighlightSourceHttpUrl,
  getReactionPageUrlFromRTags,
  getWebBookmarkArticleUrl,
  getWebExternalReactionTargetUrl,
  rssArticleStableEventId
} from '@/lib/rss-article'
import { expandWebBookmarkDTagQueryValues } from '@/lib/web-bookmark-nip'
import { eventReferencesThreadTarget, threadRootRefFromStatsRootEvent } from '@/lib/op-reference-tags'
import type { TThreadRootRef } from '@/lib/thread-reply-root-match'
import { filterRelaysToUserAllowlist, isRelayInUserAllowlist } from '@/lib/relay-allowlist'
import {
  prependAggrNostrLandIfViewerEligible,
  stripNostrLandAggrFromRelayUrls
} from '@/lib/nostr-land-relay-eligibility'
import { buildComprehensiveRelayList, relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import {
  getEmojiInfosFromEmojiTags,
  getNip25ReactionTargetHexFromTags,
  tagNameEquals
} from '@/lib/tag'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { getViewerBlockedRelayUrls } from '@/lib/viewer-blocked-relays'
import client, { eventService } from '@/services/client.service'
import { TEmoji } from '@/types'
import dayjs from 'dayjs'
import { Event, Filter, kinds } from 'nostr-tools'
import type { TArchivesInteractionCounts } from '@/types/nostr-archives'

const NOTE_STATS_ZAP_AND_MONERO_KINDS = [
  kinds.Zap,
  ExtendedKind.PAYMENT_NOTIFICATION,
  ExtendedKind.MONERO_TIP_DISCLOSURE,
  ExtendedKind.MONERO_TIP_RECEIPT
] as const

export type TNoteStats = {
  likeIdSet: Set<string>
  likes: { id: string; pubkey: string; created_at: number; emoji: TEmoji | string }[]
  repostPubkeySet: Set<string>
  reposts: { id: string; pubkey: string; created_at: number }[]
  zapPrSet: Set<string>
  zaps: { pr: string; pubkey: string; amount: number; created_at: number; comment?: string }[]
  moneroTipIdSet?: Set<string>
  moneroTips?: {
    id: string
    pubkey: string
    amountPiconero: number
    created_at: number
    comment?: string
  }[]
  paymentNotificationIdSet?: Set<string>
  paymentNotifications?: {
    id: string
    pubkey: string
    amountSats: number
    created_at: number
    comment?: string
  }[]
  replyIdSet: Set<string>
  replies: { id: string; pubkey: string; created_at: number }[]
  quoteIdSet: Set<string>
  quotes: { id: string; pubkey: string; created_at: number }[]
  highlightIdSet: Set<string>
  highlights: { id: string; pubkey: string; created_at: number }[]
  /** Pubkeys whose NIP-51 bookmark list includes this note id (`e` tag). */
  bookmarkPubkeySet?: Set<string>
  /** Aggregate counts from Nostr Archives `/v1/events/{id}/interactions` (floor for display until relay lists catch up). */
  archivesInteractions?: TArchivesInteractionCounts
  updatedAt?: number
}

export function noteStatsHasResolvableCounts(stats?: Partial<TNoteStats>): boolean {
  return stats?.updatedAt != null || stats?.archivesInteractions != null
}

export function displayListCountWithArchives(
  listLen: number | undefined,
  archives: TArchivesInteractionCounts | undefined,
  field: 'reactions' | 'replies' | 'reposts'
): number {
  return Math.max(listLen ?? 0, archives?.[field] ?? 0)
}

export function displayZapSatsWithArchives(
  zaps: TNoteStats['zaps'] | undefined,
  archives: TArchivesInteractionCounts | undefined
): number {
  const fromList = zaps?.reduce((acc, zap) => acc + zap.amount, 0) ?? 0
  return Math.max(fromList, archives?.zap_sats ?? 0)
}

/** Lightning + payment notifications + Monero tips (USD spot → sats) for the zap stat label. */
export function displayTotalTipSats(
  stats: Partial<TNoteStats> | undefined,
  rates?: { btcUsd?: number | null; xmrUsd?: number | null }
): number {
  const btcUsd = rates?.btcUsd ?? getCachedBtcUsdRate()
  const xmrUsd = rates?.xmrUsd ?? getCachedXmrUsdRate()
  const lightningSats = displayZapSatsWithArchives(stats?.zaps, stats?.archivesInteractions)
  const notificationSats =
    stats?.paymentNotifications?.reduce((acc, row) => acc + row.amountSats, 0) ?? 0
  const moneroPiconeros =
    stats?.moneroTips?.reduce((acc, tip) => acc + tip.amountPiconero, 0) ?? 0
  const moneroSats =
    moneroPiconeros > 0 && btcUsd != null && xmrUsd != null && btcUsd > 0 && xmrUsd > 0
      ? piconerosToSats(moneroPiconeros, btcUsd, xmrUsd)
      : 0
  return lightningSats + notificationSats + moneroSats
}

class NoteStatsService {
  static instance: NoteStatsService
  private noteStatsMap: Map<string, Partial<TNoteStats>> = new Map()
  /** Bumped whenever {@link notifyNoteStats} runs so {@link useNoteStatsById} can rely on `Object.is` (map entries alone are not always a new reference). */
  private noteStatsUiEpochByKey = new Map<string, number>()
  /** Last `{ stats, epoch }` object per note for {@link getNoteStatsExternalSnapshot} — must be stable across renders. */
  private noteStatsExternalSnapCache = new Map<
    string,
    { stats: Partial<TNoteStats> | undefined; epoch: number; out: { stats: Partial<TNoteStats> | undefined; epoch: number } }
  >()
  private noteStatsSubscribers = new Map<string, Set<() => void>>()
  /**
   * Batched, microtask-deferred subscriber wakes. Without this, {@link updateNoteStatsByEvents} called from
   * a React state updater (e.g. NoteList `setEvents`) synchronously notifies {@link useSyncExternalStore} listeners
   * and triggers "Cannot update NoteBoostBadges while rendering NoteList".
   */
  private subscriberNotifyKeys = new Set<string>()
  private subscriberNotifyMicrotaskQueued = false
  private processingCache = new Set<string>()
  private readonly hexNoteStatsIdRe = /^[0-9a-f]{64}$/i

  /** Canonical map key: reactions often copy `e` tag casing; UI uses lowercase ids from parsed events. */
  private statsKey(id: string): string {
    return this.hexNoteStatsIdRe.test(id) ? id.toLowerCase() : id
  }

  // Batch processing
  private pendingEvents = new Set<string>()
  /** Open note / explicit UI: drained before {@link pendingEvents} so detail pages are not stuck behind feed cards. */
  private pendingForeground = new Set<string>()
  /** If a foreground fetch hit {@link processingCache}, re-queue here so the follow-up run uses the priority lane. */
  private deferredRequeueForeground = new Set<string>()
  /** Favorite relays passed from the last fetchNoteStats call per note (used in processSingleEvent). */
  private pendingFetchFavoriteRelays = new Map<string, string[] | null | undefined>()
  /** Home feed: restrict stats REQs to favorites + trending (or reply widen stack) — no FAST_READ. */
  private pendingFetchRelayAllowlist = new Map<string, readonly string[] | undefined>()
  /** Merged favorite URLs requested while this note was already in {@link processingCache}. */
  private inFlightDeferredFavoriteRelays = new Map<string, string[]>()
  private batchTimeout: NodeJS.Timeout | null = null
  /** Prevents overlapping processBatch runs (reentrant calls corrupted pendingEvents). */
  private processBatchRunning = false
  /** When true (secondary panel open), skip background stats relay batches so the note panel is not starved. */
  private backgroundStatsPaused = false
  /** While greater than zero, {@link processBatch} defers so user publishes are not starved for WebSocket pool / bandwidth. */
  private publishPriorityDepth = 0
  private readonly BATCH_DELAY = 40
  /** Larger slices: feed cards each trigger a stats fetch; tiny slices left the tail of the feed starved. */
  private readonly MAX_BATCH_SIZE = 32
  /** Max `#e` values per REQ filter when batching thread reply stats (relays often cap array length). */
  private readonly THREAD_REPLY_STATS_BATCH_HEX_CHUNK = 32
  /** Parallel stats REQs per slice (bounded by relay pool pressure). */
  private readonly STATS_SLICE_CONCURRENCY = 8
  /** Client-only RSS/Web thread roots are not on relays; use the event passed into {@link fetchNoteStats}. */
  private pendingSyntheticRootById = new Map<string, Event>()
  /** Root event from {@link fetchNoteStats} (feed/card already has it; avoids fetchEvent miss → no stats UI). */
  private pendingStatsRootEventById = new Map<string, Event>()

  constructor() {
    if (!NoteStatsService.instance) {
      NoteStatsService.instance = this
    }
    return NoteStatsService.instance
  }

  /** Merge extra relay URLs into the pending fetch context for this note (deduped). */
  private mergeFavoriteRelaysIntoPending(eventId: string, extra: readonly string[] | null | undefined) {
    if (!extra?.length) return
    const cur = this.pendingFetchFavoriteRelays.get(eventId)
    const merged = new Set<string>([...(cur ?? []), ...extra])
    this.pendingFetchFavoriteRelays.set(eventId, [...merged])
  }

  private mergeFavoriteRelaysIntoDeferred(eventId: string, extra: readonly string[] | null | undefined) {
    if (!extra?.length) return
    const cur = this.inFlightDeferredFavoriteRelays.get(eventId)
    const merged = new Set<string>([...(cur ?? []), ...extra])
    this.inFlightDeferredFavoriteRelays.set(eventId, [...merged])
  }

  private armStatsBatchTimer() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
    }
    this.batchTimeout = setTimeout(() => {
      this.batchTimeout = null
      void this.processBatch()
    }, this.BATCH_DELAY)
  }

  /** Up to {@link MAX_BATCH_SIZE} ids, foreground queue first (same insertion order within each set). */
  private takeNextStatsSlice(): string[] {
    const out: string[] = []
    for (const id of this.pendingForeground) {
      if (out.length >= this.MAX_BATCH_SIZE) break
      this.pendingForeground.delete(id)
      out.push(id)
    }
    for (const id of this.pendingEvents) {
      if (out.length >= this.MAX_BATCH_SIZE) break
      this.pendingEvents.delete(id)
      out.push(id)
    }
    return out
  }

  setBackgroundStatsPaused(paused: boolean): void {
    this.backgroundStatsPaused = paused
  }

  /** Coalesce scroll bursts; flush immediately when backlog is large or a foreground note was queued. */
  private maybeFlushStatsBatch(foreground: boolean) {
    if (!foreground && this.backgroundStatsPaused) return
    if (this.processBatchRunning) {
      return
    }
    const backlogLarge =
      this.pendingForeground.size + this.pendingEvents.size >= this.MAX_BATCH_SIZE
    if (backlogLarge || foreground) {
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout)
        this.batchTimeout = null
      }
      void this.processBatch()
    } else {
      this.armStatsBatchTimer()
    }
  }

  /**
   * Queue relay-backed stats for `event`. Foreground (`opts.foreground`) is for the focused note page /
   * article detail so counts are not starved behind spell-feed cards (large pending backlog).
   */
  async fetchNoteStats(
    event: Event,
    _pubkey?: string | null,
    favoriteRelays?: readonly string[] | null,
    opts?: { foreground?: boolean; relayAllowlist?: readonly string[] | null }
  ) {
    const eventId = this.statsKey(event.id)
    const foreground = opts?.foreground === true

    /** Session LRU already has many reactions/replies/zaps — paint counts before relay batch runs. */
    if (event.kind !== ExtendedKind.RSS_THREAD_ROOT) {
      const preFromSession = eventService.getSessionEventsForNoteStatsTarget(event)
      if (preFromSession.length > 0) {
        this.updateNoteStatsByEvents(preFromSession, event.pubkey, { statsRootEvent: event })
      }
    }

    const rememberRoot = () => {
      if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
        this.pendingSyntheticRootById.set(eventId, event)
      } else {
        this.pendingStatsRootEventById.set(eventId, event)
      }
    }

    if (!foreground && this.backgroundStatsPaused) {
      rememberRoot()
      return
    }

    if (this.pendingEvents.has(eventId) || this.pendingForeground.has(eventId)) {
      this.mergeFavoriteRelaysIntoPending(eventId, favoriteRelays)
      rememberRoot()
      if (foreground) {
        this.pendingEvents.delete(eventId)
        this.pendingForeground.add(eventId)
      }
      this.maybeFlushStatsBatch(foreground)
      return
    }

    /** Background feed cards: one relay wave per note — effect re-runs must not stack REQs. */
    if (!foreground && this.noteStatsMap.get(eventId)?.updatedAt != null) {
      return
    }

    if (this.processingCache.has(eventId)) {
      this.mergeFavoriteRelaysIntoDeferred(eventId, favoriteRelays)
      rememberRoot()
      if (foreground) {
        this.deferredRequeueForeground.add(eventId)
      }
      return
    }

    this.pendingFetchFavoriteRelays.set(eventId, favoriteRelays?.length ? [...favoriteRelays] : null)
    if (opts?.relayAllowlist?.length) {
      this.pendingFetchRelayAllowlist.set(eventId, opts.relayAllowlist)
    } else {
      this.pendingFetchRelayAllowlist.delete(eventId)
    }
    if (foreground) {
      this.pendingForeground.add(eventId)
    } else {
      this.pendingEvents.add(eventId)
    }
    rememberRoot()

    this.maybeFlushStatsBatch(foreground)
  }

  /**
   * One relay wave for stats on many thread replies: chunked `#e` / `#q` filters instead of N
   * {@link fetchNoteStats} queue entries. Replaceable-address notes still use {@link fetchNoteStats};
   * non-hex ids use {@link fetchNoteStats} as well.
   *
   * Ingest uses {@link updateNoteStatsByEvents} without per-reply `statsRootEvent` (reactions/reposts/zaps
   * route by tags; OP-reference kinds that need `statsRootEvent` are uncommon on reply rows).
   */
  async fetchThreadReplyNoteStatsBatch(
    replies: Event[],
    relayUrls: string[],
    _pubkey?: string | null,
    opts?: { foreground?: boolean; threadRootHexId?: string }
  ): Promise<void> {
    const urls = prependAggrNostrLandIfViewerEligible(
      appendMoneroNostrRelays(sanitizeRelayUrlsForFetch((relayUrls ?? []).filter(Boolean)))
    )
    const hexReplies: Event[] = []
    const replaceableReplies: Event[] = []
    const oddIdReplies: Event[] = []

    for (const r of replies) {
      if (!this.hexNoteStatsIdRe.test(r.id)) {
        oddIdReplies.push(r)
        continue
      }
      if (isReplaceableEvent(r.kind)) {
        replaceableReplies.push(r)
      } else {
        hexReplies.push(r)
      }
    }

    const hexIdsSet = new Set(hexReplies.map((r) => this.statsKey(r.id)))
    for (const r of hexReplies) {
      if (!isNip25ReactionKind(r.kind)) continue
      const parentHex = getParentEventHexId(r)
      if (parentHex && this.hexNoteStatsIdRe.test(parentHex)) {
        hexIdsSet.add(this.statsKey(parentHex))
      }
    }
    const rootHex = opts?.threadRootHexId?.trim().toLowerCase()
    if (rootHex && this.hexNoteStatsIdRe.test(rootHex)) {
      hexIdsSet.add(this.statsKey(rootHex))
    }
    const hexIds = [...hexIdsSet]

    for (const r of hexReplies) {
      if (r.kind === ExtendedKind.RSS_THREAD_ROOT) continue
      const pre = eventService.getSessionEventsForNoteStatsTarget(r)
      if (pre.length > 0) {
        this.updateNoteStatsByEvents(pre, r.pubkey)
      }
    }

    const markHexTargetsLoaded = () => {
      for (const id of hexIds) {
        this.touchStatsLoadedMarker(id)
      }
    }

    try {
      if (hexIds.length > 0) {
        const onStatsEvent = (evt: Event) => {
          this.updateNoteStatsByEvents([evt], undefined)
        }
        if (urls.length > 0) {
          const { nonSocial, social } = this.buildBatchFilterGroupsForHexNoteTargets(hexIds)
          const fetchOpts = {
            eoseTimeout: 10_000,
            globalTimeout: 28_000,
            firstRelayResultGraceMs: false as const
          }
          const { queryService } = await import('@/services/client.service')
          await Promise.all([
            nonSocial.length > 0
              ? queryService.fetchEvents(urls, nonSocial, {
                  ...fetchOpts,
                  onevent: onStatsEvent
                })
              : Promise.resolve([] as Event[]),
            social.length > 0
              ? queryService.fetchEvents(urls, social, {
                  ...fetchOpts,
                  onevent: onStatsEvent
                })
              : Promise.resolve([] as Event[]),
            this.fetchMoneroPaymentStatsForHexTargets(hexIds, onStatsEvent)
          ])
        } else {
          await this.fetchMoneroPaymentStatsForHexTargets(hexIds, onStatsEvent)
        }
      }
    } catch (err) {
      logger.warn('[NoteStats] fetchThreadReplyNoteStatsBatch failed', {
        hexCount: hexIds.length,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      markHexTargetsLoaded()
      for (const r of replaceableReplies) {
        void this.fetchNoteStats(r, _pubkey, urls, opts)
      }
      for (const r of oddIdReplies) {
        void this.fetchNoteStats(r, _pubkey, urls, opts)
      }
    }
  }

  private touchStatsLoadedMarker(rawStatsKey: string) {
    const statsKey = this.statsKey(rawStatsKey)
    this.noteStatsMap.set(statsKey, {
      ...(this.noteStatsMap.get(statsKey) ?? {}),
      updatedAt: dayjs().unix()
    })
    this.notifyNoteStats(statsKey)
  }

  /**
   * Same shape as {@link buildFilterGroups} for fixed hex roots, but ORs many ids per filter via `#e` arrays.
   * Omits `#e` / `#E` filters whose kinds are merged only with `statsRootEvent` (OP-reference branch).
   */
  private buildBatchFilterGroupsForHexNoteTargets(hexIds: string[]): { nonSocial: Filter[]; social: Filter[] } {
    const reactionLimit = 900
    const interactionLimit = 200
    const nip18RepostKinds = [kinds.Repost, ExtendedKind.GENERIC_REPOST]
    const qKindsHex = Array.from(
      new Set<number>([
        kinds.ShortTextNote,
        ExtendedKind.COMMENT,
        ExtendedKind.VOICE_COMMENT,
        ...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT
      ])
    ).sort((a, b) => a - b)

    const nonSocial: Filter[] = []
    const social: Filter[] = []

    for (let off = 0; off < hexIds.length; off += this.THREAD_REPLY_STATS_BATCH_HEX_CHUNK) {
      const ch = hexIds.slice(off, off + this.THREAD_REPLY_STATS_BATCH_HEX_CHUNK)
      nonSocial.push(
        { '#e': ch, kinds: [kinds.Reaction], limit: reactionLimit },
        { '#E': ch, kinds: [kinds.Reaction], limit: reactionLimit },
        { '#e': ch, kinds: [...NOTE_STATS_ZAP_AND_MONERO_KINDS], limit: 100 },
        { '#E': ch, kinds: [...NOTE_STATS_ZAP_AND_MONERO_KINDS], limit: 100 }
      )
      social.push(
        {
          '#e': ch,
          kinds: [
            ...nip18RepostKinds,
            kinds.ShortTextNote,
            ExtendedKind.COMMENT,
            ExtendedKind.VOICE_COMMENT,
            kinds.Highlights
          ],
          limit: interactionLimit
        },
        {
          '#q': ch,
          kinds: qKindsHex,
          limit: 75
        }
      )
    }

    return { nonSocial, social }
  }

  private scheduleStatsBatchContinuation() {
    if (this.pendingForeground.size === 0 && this.pendingEvents.size === 0) return
    queueMicrotask(() => {
      void this.processBatch()
    })
  }

  /** Call around user-initiated {@link client.publishEvent} so stats REQ waves defer briefly. */
  beginPublishPriority(): void {
    this.publishPriorityDepth++
  }

  endPublishPriority(): void {
    this.publishPriorityDepth = Math.max(0, this.publishPriorityDepth - 1)
  }

  private async processBatch() {
    /** Defer only background fetches while the user is publishing; open note / `foreground` must not starve. */
    if (this.publishPriorityDepth > 0 && this.pendingForeground.size === 0) {
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout)
      }
      this.batchTimeout = setTimeout(() => {
        this.batchTimeout = null
        void this.processBatch()
      }, 450)
      return
    }
    if (this.processBatchRunning) {
      return
    }
    if (this.pendingForeground.size === 0 && this.pendingEvents.size === 0) {
      return
    }

    this.processBatchRunning = true
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }

    try {
      const eventsToProcess = this.takeNextStatsSlice()
      for (let i = 0; i < eventsToProcess.length; i += this.STATS_SLICE_CONCURRENCY) {
        const chunk = eventsToProcess.slice(i, i + this.STATS_SLICE_CONCURRENCY)
        await Promise.all(chunk.map((eventId) => this.processSingleEvent(eventId)))
      }
    } finally {
      this.processBatchRunning = false
      if (this.pendingForeground.size > 0 || this.pendingEvents.size > 0) {
        this.scheduleStatsBatchContinuation()
      }
    }
  }

  private async processSingleEvent(eventId: string) {
    if (this.processingCache.has(eventId)) {
      return
    }

    this.processingCache.add(eventId)

    const favoriteRelays = this.pendingFetchFavoriteRelays.get(eventId)
    this.pendingFetchFavoriteRelays.delete(eventId)
    const relayAllowlist = this.pendingFetchRelayAllowlist.get(eventId)
    this.pendingFetchRelayAllowlist.delete(eventId)

    let publishedStatsSnapshot = false
    const markStatsLoaded = (rawStatsKey: string) => {
      if (publishedStatsSnapshot) return
      publishedStatsSnapshot = true
      const statsKey = this.statsKey(rawStatsKey)
      this.noteStatsMap.set(statsKey, {
        ...(this.noteStatsMap.get(statsKey) ?? {}),
        updatedAt: dayjs().unix()
      })
      this.notifyNoteStats(statsKey)
    }

    let resolvedEvent: Event | undefined
    try {
      // Synthetic RSS/Web thread parents are not published; use the instance from fetchNoteStats.
      const synthetic = this.pendingSyntheticRootById.get(eventId)
      this.pendingSyntheticRootById.delete(eventId)
      const callerRoot = this.pendingStatsRootEventById.get(eventId)
      this.pendingStatsRootEventById.delete(eventId)
      resolvedEvent = synthetic ?? callerRoot
      if (!resolvedEvent && this.hexNoteStatsIdRe.test(eventId)) {
        resolvedEvent = eventService.peekSessionCachedEvent(eventId)
      }
      if (!resolvedEvent && this.hexNoteStatsIdRe.test(eventId)) {
        resolvedEvent = await eventService.peekPublicationStoreEvent(eventId)
      }
      if (!resolvedEvent) {
        resolvedEvent = await eventService.fetchEvent(eventId)
      }
      if (!resolvedEvent) {
        markStatsLoaded(eventId)
        return
      }

      // Feed/timeline often already has reposts, reactions, zaps in the session LRU — merge before relay list + REQ
      // so boost strips and counts paint without waiting on fetchRelayList / index relays.
      if (resolvedEvent.kind !== ExtendedKind.RSS_THREAD_ROOT) {
        const preFromSession = eventService.getSessionEventsForNoteStatsTarget(resolvedEvent)
        if (preFromSession.length > 0) {
          this.updateNoteStatsByEvents(preFromSession, resolvedEvent.pubkey, {
            statsRootEvent: resolvedEvent
          })
        }
      }

      const finalRelayUrls = await this.buildNoteStatsRelayList(
        resolvedEvent,
        favoriteRelays,
        relayAllowlist
      )

      const replaceableCoordinate = isReplaceableEvent(resolvedEvent.kind)
        ? getReplaceableCoordinateFromEvent(resolvedEvent)
        : undefined

      const { nonSocial, social } = this.buildFilterGroups(resolvedEvent, replaceableCoordinate)
      const fetchOpts = {
        eoseTimeout: 10_000,
        globalTimeout: 28_000,
        firstRelayResultGraceMs: false as const
      }

      const { queryService } = await import('@/services/client.service')
      const rootHex = this.statsKey(resolvedEvent.id)
      const onStatsEvent = (evt: Event) => {
        this.updateNoteStatsByEvents([evt], resolvedEvent!.pubkey, {
          statsRootEvent: resolvedEvent!,
          interactionTargetNoteId:
            evt.kind === kinds.Reaction && /^[0-9a-f]{64}$/i.test(rootHex) ? rootHex : undefined
        })
      }
      await Promise.all([
        nonSocial.length > 0
          ? queryService.fetchEvents(finalRelayUrls, nonSocial, {
              ...fetchOpts,
              onevent: onStatsEvent
            })
          : Promise.resolve([] as Event[]),
        social.length > 0
          ? queryService.fetchEvents(finalRelayUrls, social, {
              ...fetchOpts,
              onevent: onStatsEvent
            })
          : Promise.resolve([] as Event[]),
        this.fetchMoneroPaymentStatsForNoteTarget(resolvedEvent, onStatsEvent)
      ])

      if (resolvedEvent.kind !== ExtendedKind.RSS_THREAD_ROOT) {
        const likeCount = this.noteStatsMap.get(rootHex)?.likes?.length ?? 0
        if (likeCount === 0) {
          await this.fetchReactionsForNoteTarget(resolvedEvent, finalRelayUrls)
        }
      }

      markStatsLoaded(resolvedEvent.id)
    } catch (err) {
      logger.warn('[NoteStats] processSingleEvent failed', {
        eventId: eventId.substring(0, 8),
        error: err instanceof Error ? err.message : String(err)
      })
      markStatsLoaded(resolvedEvent?.id ?? eventId)
    } finally {
      if (!publishedStatsSnapshot) {
        markStatsLoaded(resolvedEvent?.id ?? eventId)
      }
      this.processingCache.delete(eventId)
      if (this.inFlightDeferredFavoriteRelays.has(eventId)) {
        const deferred = this.inFlightDeferredFavoriteRelays.get(eventId)!
        this.inFlightDeferredFavoriteRelays.delete(eventId)
        const requeueForeground = this.deferredRequeueForeground.has(eventId)
        this.deferredRequeueForeground.delete(eventId)
        if (deferred.length > 0) {
          if (this.pendingEvents.has(eventId) || this.pendingForeground.has(eventId)) {
            this.mergeFavoriteRelaysIntoPending(eventId, deferred)
          } else {
            this.pendingFetchFavoriteRelays.set(eventId, deferred)
            if (requeueForeground) {
              this.pendingForeground.add(eventId)
            } else {
              this.pendingEvents.add(eventId)
            }
          }
        }
      }
    }
  }

  /** Stats REQs: dedupe, user-blocked strip, then prepend {@link AGGR_NOSTR_LAND_WSS} when eligible. */
  private finalizeNoteStatsRelayUrls(urls: readonly string[]): string[] {
    return prependAggrNostrLandIfViewerEligible(
      appendMoneroNostrRelays(
        sanitizeRelayUrlsForFetch(dedupeNormalizeRelayUrlsOrdered(urls))
      )
    )
  }

  /** {@link buildComprehensiveRelayList} for reactions/reposts/zaps on a note (thread hints, capped author NIP-65). */
  private async buildNoteStatsRelayList(
    event: Event,
    favoriteRelays?: readonly string[] | null,
    relayAllowlist?: readonly string[]
  ): Promise<string[]> {
    const me = client.pubkey?.trim()
    const relayHints = [
      ...relayHintsFromEventTags(event),
      ...client.getSeenEventRelayUrls(event.id),
      ...client.eventService.getSessionRelayHintsForHexTarget(event.id),
      ...(favoriteRelays ?? [])
    ]

    if (relayAllowlist?.length) {
      const onAllowlist = (u: string) => isRelayInUserAllowlist(u, relayAllowlist)
      // Match home feed timeline policy: allowlisted stats must not hit aggr.nostr.land.
      return stripNostrLandAggrFromRelayUrls(
        appendMoneroNostrRelays(
          sanitizeRelayUrlsForFetch(
            dedupeNormalizeRelayUrlsOrdered(
              filterRelaysToUserAllowlist(
                [...relayAllowlist, ...relayHints.filter(onAllowlist)],
                relayAllowlist
              )
            )
          )
        )
      )
    }

    let useGlobal = true
    if (me) {
      try {
        const [fav, rl] = await Promise.all([
          client.fetchFavoriteRelays(me).catch(() => [] as string[]),
          client.peekRelayListFromStorage(me)
        ])
        useGlobal = viewerUsesGlobalRelayDefaults({
          viewerPubkey: me,
          favoriteRelayUrls: fav,
          relayList: rl ?? undefined
        })
      } catch {
        useGlobal = true
      }
    }

    const comprehensive = await buildComprehensiveRelayList({
      authorPubkey: event.pubkey,
      userPubkey: me,
      relayHints,
      blockedRelays: [...getViewerBlockedRelayUrls()],
      includeUserOwnRelays: Boolean(me),
      includeFavoriteRelays: Boolean(me),
      includeFastReadRelays: useGlobal,
      useGlobalRelayDefaults: useGlobal,
      includeProfileFetchRelays: false,
      includeSearchableRelays: false,
      includeLocalRelays: true,
      includeViewerHttpIndexRelays: true
    })
    return this.finalizeNoteStatsRelayUrls(comprehensive)
  }

  /**
   * Split REQ batches: filters that include social kinds (1 / 11 / 1111) trigger
   * {@link relayFilterIncludesSocialKindBlockedKind} and drop {@link SOCIAL_KIND_BLOCKED_RELAY_URLS}; keep reactions,
   * zaps, and `#r` queries in separate batches so read-only index relays ({@link READ_ONLY_RELAY_URLS}) still answer
   * where appropriate. RSS URL threads also need `#r` + kind 7 for NIP-73 page-targeted likes.
   */
  private buildFilterGroups(
    event: Event,
    replaceableCoordinate?: string
  ): { nonSocial: Filter[]; social: Filter[] } {
    const reactionLimit = 500
    const interactionLimit = 120
    const nip18RepostKinds = [kinds.Repost, ExtendedKind.GENERIC_REPOST]

    /** Synthetic RSS/Web parents are not on relays; `#e` on the fake id returns nothing. Use only URL-scoped filters. */
    if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
      const url = getArticleUrlFromCommentITags(event)
      if (!url) {
        return { nonSocial: [], social: [] }
      }
      const canonical = canonicalizeRssArticleUrl(url)
      const tagVals = expandArticleUrlThreadQueryValues(canonical)
      const iVals = tagVals.length > 0 ? tagVals : [canonical]
      const dVals = expandWebBookmarkDTagQueryValues(canonical)
      const nonSocial: Filter[] = [
        { '#i': iVals, kinds: [ExtendedKind.EXTERNAL_REACTION], limit: reactionLimit },
        { '#I': iVals, kinds: [ExtendedKind.EXTERNAL_REACTION], limit: reactionLimit },
        { '#i': iVals, kinds: [ExtendedKind.WEB_BOOKMARK], limit: 200 },
        { '#I': iVals, kinds: [ExtendedKind.WEB_BOOKMARK], limit: 200 }
      ]
      if (dVals.length > 0) {
        nonSocial.push({ '#d': dVals, kinds: [ExtendedKind.WEB_BOOKMARK], limit: 200 })
      }
      if (tagVals.length > 0) {
        nonSocial.push(
          { '#r': tagVals, kinds: [kinds.Highlights], limit: interactionLimit },
          { '#r': tagVals, kinds: [kinds.Reaction], limit: reactionLimit }
        )
      }
      const social: Filter[] = [
        { '#i': iVals, kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT], limit: interactionLimit },
        { '#I': iVals, kinds: [ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT], limit: interactionLimit }
      ]
      return { nonSocial, social }
    }

    const rootId = this.statsKey(event.id)
    const nonSocial: Filter[] = [
      { '#e': [rootId], kinds: [kinds.Reaction], limit: reactionLimit },
      { '#E': [rootId], kinds: [kinds.Reaction], limit: reactionLimit },
      { '#e': [rootId], kinds: [...NOTE_STATS_ZAP_AND_MONERO_KINDS], limit: 100 },
      { '#E': [rootId], kinds: [...NOTE_STATS_ZAP_AND_MONERO_KINDS], limit: 100 }
    ]

    const qKindsHex = Array.from(
      new Set<number>([
        kinds.ShortTextNote,
        ExtendedKind.COMMENT,
        ExtendedKind.VOICE_COMMENT,
        ...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT
      ])
    ).sort((a, b) => a - b)

    const social: Filter[] = [
      {
        '#e': [rootId],
        kinds: [
          ...nip18RepostKinds,
          kinds.ShortTextNote,
          ExtendedKind.COMMENT,
          ExtendedKind.VOICE_COMMENT,
          kinds.Highlights
        ],
        limit: interactionLimit
      },
      {
        '#e': [rootId],
        kinds: [...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT],
        limit: interactionLimit
      },
      {
        '#E': [rootId],
        kinds: [...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT],
        limit: interactionLimit
      },
      {
        '#q': [rootId],
        kinds: qKindsHex,
        limit: 50
      }
    ]

    if (replaceableCoordinate) {
      const qValsReplaceable = Array.from(
        new Set(
          [event.id, replaceableCoordinate]
            .map((x) => (typeof x === 'string' ? x.trim() : ''))
            .filter(Boolean)
        )
      )
      nonSocial.push(
        { '#a': [replaceableCoordinate], kinds: [kinds.Reaction], limit: reactionLimit },
        { '#A': [replaceableCoordinate], kinds: [kinds.Reaction], limit: reactionLimit },
        { '#a': [replaceableCoordinate], kinds: [...NOTE_STATS_ZAP_AND_MONERO_KINDS], limit: 100 },
        { '#A': [replaceableCoordinate], kinds: [...NOTE_STATS_ZAP_AND_MONERO_KINDS], limit: 100 }
      )
      social.push(
        {
          '#a': [replaceableCoordinate],
          kinds: [
            ...nip18RepostKinds,
            kinds.ShortTextNote,
            ExtendedKind.COMMENT,
            ExtendedKind.VOICE_COMMENT,
            kinds.Highlights
          ],
          limit: interactionLimit
        },
        {
          '#a': [replaceableCoordinate],
          kinds: [...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT],
          limit: interactionLimit
        },
        {
          '#A': [replaceableCoordinate],
          kinds: [...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT],
          limit: interactionLimit
        },
        {
          '#q': qValsReplaceable,
          kinds: qKindsHex,
          limit: 50
        }
      )
    }

    return { nonSocial, social }
  }


  subscribeNoteStats(noteId: string, callback: () => void) {
    const key = this.statsKey(noteId)
    let set = this.noteStatsSubscribers.get(key)
    if (!set) {
      set = new Set()
      this.noteStatsSubscribers.set(key, set)
    }
    set.add(callback)
    // Stats may have been merged while this note was off-screen (subscriberCount was 0 on publish).
    // One microtask ping lets `useSyncExternalStore` re-read after mount so counts are not stuck blank.
    queueMicrotask(() => {
      if (!set?.has(callback)) return
      try {
        callback()
      } catch (e) {
        logger.warn('[NoteStatsService] subscribeNoteStats ping failed', { err: e })
      }
    })
    return () => {
      set?.delete(callback)
      if (set?.size === 0) this.noteStatsSubscribers.delete(key)
    }
  }

  private flushNoteStatsSubscribers(): void {
    this.subscriberNotifyMicrotaskQueued = false
    const keys = [...this.subscriberNotifyKeys]
    this.subscriberNotifyKeys.clear()
    for (const key of keys) {
      const set = this.noteStatsSubscribers.get(key)
      if (!set?.size) continue
      for (const cb of [...set]) {
        try {
          cb()
        } catch (e) {
          logger.warn('[NoteStatsService] subscriber callback failed', { err: e })
        }
      }
    }
  }

  private notifyNoteStats(noteId: string) {
    const key = this.statsKey(noteId)
    this.noteStatsUiEpochByKey.set(key, (this.noteStatsUiEpochByKey.get(key) ?? 0) + 1)
    this.subscriberNotifyKeys.add(key)
    if (this.subscriberNotifyMicrotaskQueued) return
    this.subscriberNotifyMicrotaskQueued = true
    queueMicrotask(() => {
      this.flushNoteStatsSubscribers()
    })
  }

  getNoteStats(id: string): Partial<TNoteStats> | undefined {
    return this.noteStatsMap.get(this.statsKey(id))
  }

  /** Merge Archives aggregate interaction counts; does not replace relay-derived lists. */
  applyArchivesInteractionCounts(noteId: string, counts: TArchivesInteractionCounts): void {
    const key = this.statsKey(noteId)
    const old = this.noteStatsMap.get(key) ?? {}
    this.noteStatsMap.set(key, { ...old, archivesInteractions: counts })
    this.notifyNoteStats(key)
  }

  /** Batched prefetch via {@link queueArchivesInteractionPrefetch} (dynamic import avoids service cycle). */
  prefetchArchivesInteractions(noteId: string): void {
    void import('@/lib/note-stats-archives-prefetch').then((m) => m.queueArchivesInteractionPrefetch(noteId))
  }

  /** Same social `kinds` / tag filters as {@link fetchNoteStats} — for thread UI to load counted replies. */
  getSocialStatsFiltersForEvent(event: Event): Filter[] {
    const replaceableCoordinate = isReplaceableEvent(event.kind)
      ? getReplaceableCoordinateFromEvent(event)
      : undefined
    return this.buildFilterGroups(event, replaceableCoordinate).social
  }

  /**
   * Snapshot for {@link useNoteStatsById} / `useSyncExternalStore`: `epoch` changes on every stats notify so React
   * always re-renders when counts update (avoids stale UI when the map entry reference is reused or updates race mount).
   */
  getNoteStatsExternalSnapshot(noteId: string): {
    stats: Partial<TNoteStats> | undefined
    epoch: number
  } {
    const key = this.statsKey(noteId)
    const stats = this.noteStatsMap.get(key)
    const epoch = this.noteStatsUiEpochByKey.get(key) ?? 0
    const prev = this.noteStatsExternalSnapCache.get(key)
    if (prev && prev.stats === stats && prev.epoch === epoch) {
      return prev.out
    }
    const out = { stats, epoch }
    this.noteStatsExternalSnapCache.set(key, { stats, epoch, out })
    return out
  }

  addZap(
    pubkey: string,
    eventId: string,
    pr: string,
    amount: number,
    comment?: string,
    created_at: number = dayjs().unix(),
    notify: boolean = true
  ) {
    const key = this.statsKey(eventId)
    const old = this.noteStatsMap.get(key) || {}
    const zapPrSet = old.zapPrSet || new Set()
    const zaps = old.zaps || []
    if (zapPrSet.has(pr)) return

    zapPrSet.add(pr)
    zaps.push({ pr, pubkey, amount, comment, created_at })
    this.noteStatsMap.set(key, { ...old, zapPrSet, zaps })
    if (notify) {
      this.notifyNoteStats(key)
    }
    return key
  }

  addMoneroTip(
    pubkey: string,
    eventId: string,
    tipEventId: string,
    amountPiconero: number,
    comment?: string,
    created_at: number = dayjs().unix(),
    notify: boolean = true
  ) {
    const key = this.statsKey(eventId)
    const old = this.noteStatsMap.get(key) || {}
    const moneroTipIdSet = old.moneroTipIdSet || new Set<string>()
    const moneroTips = old.moneroTips || []
    if (moneroTipIdSet.has(tipEventId)) return

    moneroTipIdSet.add(tipEventId)
    moneroTips.push({
      id: tipEventId,
      pubkey,
      amountPiconero,
      comment,
      created_at
    })
    this.noteStatsMap.set(key, { ...old, moneroTipIdSet, moneroTips })
    if (notify) {
      this.notifyNoteStats(key)
    }
    return key
  }

  addPaymentNotification(
    pubkey: string,
    eventId: string,
    notificationEventId: string,
    amountSats: number,
    comment?: string,
    created_at: number = dayjs().unix(),
    notify: boolean = true
  ) {
    const key = this.statsKey(eventId)
    const old = this.noteStatsMap.get(key) || {}
    const paymentNotificationIdSet = old.paymentNotificationIdSet || new Set<string>()
    const paymentNotifications = old.paymentNotifications || []
    if (paymentNotificationIdSet.has(notificationEventId)) return

    paymentNotificationIdSet.add(notificationEventId)
    paymentNotifications.push({
      id: notificationEventId,
      pubkey,
      amountSats,
      comment,
      created_at
    })
    this.noteStatsMap.set(key, { ...old, paymentNotificationIdSet, paymentNotifications })
    if (notify) {
      this.notifyNoteStats(key)
    }
    return key
  }

  /**
   * @param mergeOpts When the UI just published a single interaction, pass the note id the user acted on
   *   so stats merge even if `e` tag shape varies (extensions, multiple ancestors).
   */
  updateNoteStatsByEvents(
    events: Event[],
    originalEventAuthor?: string,
    mergeOpts?: {
      interactionTargetNoteId?: string
      replyParentNoteId?: string
      /** Stats root from {@link fetchNoteStats} / relay batch — enables OP-reference kinds to count toward replies. */
      statsRootEvent?: Event
    }
  ) {
    const updatedEventIdSet = new Set<string>()

    // Process events in batches for better performance
    const batchSize = 50
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize)
      batch.forEach((evt) => {
        for (const id of this.processEvent(evt, originalEventAuthor, mergeOpts)) {
          updatedEventIdSet.add(this.statsKey(id))
        }
      })
    }

    updatedEventIdSet.forEach((eventId) => {
      this.notifyNoteStats(this.statsKey(eventId))
    })
  }

  private processEvent(
    evt: Event,
    originalEventAuthor?: string,
    mergeOpts?: {
      interactionTargetNoteId?: string
      replyParentNoteId?: string
      statsRootEvent?: Event
    }
  ): string[] {
    const out: string[] = []
    const push = (k: string | undefined) => {
      if (!k) return
      const s = this.statsKey(k)
      if (!out.includes(s)) out.push(s)
    }
    const pushMany = (ks: string[]) => {
      for (const k of ks) push(k)
    }

    if (evt.kind === kinds.Reaction) {
      push(this.addLikeByEvent(evt, originalEventAuthor, mergeOpts?.interactionTargetNoteId))
    } else if (evt.kind === ExtendedKind.EXTERNAL_REACTION) {
      push(
        this.addLikeByExternalWebReactionEvent(
          evt,
          originalEventAuthor,
          mergeOpts?.interactionTargetNoteId
        )
      )
    } else if (isNip18RepostKind(evt.kind)) {
      push(this.addRepostByEvent(evt, originalEventAuthor, mergeOpts?.interactionTargetNoteId))
    } else if (evt.kind === kinds.Zap) {
      push(this.addZapByEvent(evt, originalEventAuthor))
    } else if (evt.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
      push(this.addPaymentNotificationByEvent(evt, originalEventAuthor, mergeOpts?.interactionTargetNoteId))
    } else if (
      evt.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
      evt.kind === ExtendedKind.MONERO_TIP_RECEIPT
    ) {
      push(this.addMoneroTipByEvent(evt, originalEventAuthor))
    } else if (evt.kind === kinds.ShortTextNote || evt.kind === ExtendedKind.COMMENT || evt.kind === ExtendedKind.VOICE_COMMENT) {
      const isQuote = this.isQuoteByEvent(evt)
      if (isQuote) {
        push(this.addQuoteByEvent(evt, originalEventAuthor))
      } else if (mergeOpts?.replyParentNoteId) {
        pushMany(this.addReplyByEvent(evt, originalEventAuthor, mergeOpts.replyParentNoteId))
      } else {
        pushMany(this.addReplyByEvent(evt, originalEventAuthor))
      }
    } else if (
      mergeOpts?.statsRootEvent &&
      evt.kind !== kinds.Highlights &&
      NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT.includes(evt.kind)
    ) {
      pushMany(this.addOpReferenceAsThreadResponse(evt, originalEventAuthor, mergeOpts.statsRootEvent))
    } else if (evt.kind === kinds.Highlights) {
      push(this.addHighlightByEvent(evt, originalEventAuthor))
    } else if (evt.kind === ExtendedKind.WEB_BOOKMARK) {
      push(this.addWebBookmarkByArticleUrlEvent(evt))
    } else if (evt.kind === kinds.BookmarkList) {
      this.addBookmarkListRefsByEvent(evt)
    }

    return out
  }

  private reactionEmojiFromEvent(evt: Event): TEmoji | string {
    let emoji: TEmoji | string = evt.content.trim()
    if (!emoji) {
      const fromTags = getEmojiInfosFromEmojiTags(evt.tags)
      if (fromTags.length) {
        emoji = fromTags[0]
      } else {
        emoji = '+'
      }
    }

    if (typeof emoji === 'string' && emoji.startsWith(':') && emoji.endsWith(':')) {
      const emojiInfos = getEmojiInfosFromEmojiTags(evt.tags)
      const shortcode = emoji.split(':')[1]
      const emojiInfo = emojiInfos.find((info) => info.shortcode === shortcode)
      if (emojiInfo) {
        emoji = emojiInfo
      } else {
        const customCodes = emojiInfos.map((e) => e.shortcode)
        const normalized = replaceStandardEmojiShortcodesInContent(emoji, customCodes)
        if (normalized !== emoji) {
          emoji = normalized
        }
        // else keep `:custom:` string; UI resolves via reactor profile (ReactionEmojiDisplay)
      }
    }

    return emoji
  }

  private reactionTargetHexForLike(evt: Event, forcedTargetEventId?: string): string | undefined {
    const forced = forcedTargetEventId?.trim()
    if (forced) return this.statsKey(forced)
    const nip25 = getNip25ReactionTargetHexFromTags(evt.tags)
    if (nip25 && /^[0-9a-f]{64}$/i.test(nip25)) return nip25.toLowerCase()
    const parentHex = getParentEventHexId(evt)
    if (parentHex && /^[0-9a-f]{64}$/i.test(parentHex)) return parentHex.toLowerCase()
    if (evt.kind === kinds.Reaction) {
      const pageUrl = getReactionPageUrlFromRTags(evt)
      if (pageUrl) {
        return rssArticleStableEventId(canonicalizeRssArticleUrl(pageUrl))
      }
    }
    return undefined
  }

  /** Second pass when the main stats wave returned no kind-7 rows (common on direct note open). */
  private buildMoneroPaymentStatsFilters(rootId: string, replaceableCoordinate?: string): Filter[] {
    const filters: Filter[] = [
      { '#e': [rootId], kinds: [...NOTE_STATS_ZAP_AND_MONERO_KINDS], limit: 100 }
    ]
    if (replaceableCoordinate) {
      filters.push({
        '#a': [replaceableCoordinate],
        kinds: [...NOTE_STATS_ZAP_AND_MONERO_KINDS],
        limit: 100
      })
    }
    return filters
  }

  /** PMNR / Nosmero only — lowercase `#e` / `#a` filters; not blocked by personal-relay policy. */
  private async fetchMoneroPaymentStatsForNoteTarget(
    rootEvent: Event,
    onStatsEvent: (evt: Event) => void
  ): Promise<void> {
    const rootId = this.statsKey(rootEvent.id)
    if (!this.hexNoteStatsIdRe.test(rootId)) return

    const moneroUrls = appendMoneroNostrRelays([])
    if (moneroUrls.length === 0) return

    const replaceableCoordinate = isReplaceableEvent(rootEvent.kind)
      ? getReplaceableCoordinateFromEvent(rootEvent)
      : undefined

    const { queryService } = await import('@/services/client.service')
    try {
      await queryService.fetchEvents(
        moneroUrls,
        this.buildMoneroPaymentStatsFilters(rootId, replaceableCoordinate),
        {
          eoseTimeout: 8_000,
          globalTimeout: 18_000,
          firstRelayResultGraceMs: false,
          foreground: true,
          onevent: onStatsEvent
        }
      )
    } catch {
      /* optional */
    }
  }

  private async fetchMoneroPaymentStatsForHexTargets(
    hexIds: string[],
    onStatsEvent: (evt: Event) => void
  ): Promise<void> {
    const moneroUrls = appendMoneroNostrRelays([])
    if (moneroUrls.length === 0 || hexIds.length === 0) return

    const filters: Filter[] = []
    for (let off = 0; off < hexIds.length; off += this.THREAD_REPLY_STATS_BATCH_HEX_CHUNK) {
      const ch = hexIds.slice(off, off + this.THREAD_REPLY_STATS_BATCH_HEX_CHUNK)
      filters.push({ '#e': ch, kinds: [...NOTE_STATS_ZAP_AND_MONERO_KINDS], limit: 100 })
    }

    const { queryService } = await import('@/services/client.service')
    try {
      await queryService.fetchEvents(moneroUrls, filters, {
        eoseTimeout: 8_000,
        globalTimeout: 18_000,
        firstRelayResultGraceMs: false,
        foreground: true,
        onevent: onStatsEvent
      })
    } catch {
      /* optional */
    }
  }

  private async fetchReactionsForNoteTarget(rootEvent: Event, relayUrls: string[]): Promise<void> {
    const rootHex = this.statsKey(rootEvent.id)
    if (!/^[0-9a-f]{64}$/i.test(rootHex)) return

    const hintRelays = client.eventService.getSessionRelayHintsForHexTarget(rootHex)
    const urls = [...new Set([...relayUrls, ...hintRelays])]
    if (!urls.length) return

    const filters: Filter[] = [
      { '#e': [rootHex], kinds: [kinds.Reaction], limit: 500 },
      { '#E': [rootHex], kinds: [kinds.Reaction], limit: 500 }
    ]
    const { queryService } = await import('@/services/client.service')
    await queryService.fetchEvents(urls, filters, {
      eoseTimeout: 12_000,
      globalTimeout: 22_000,
      firstRelayResultGraceMs: false,
      onevent: (evt: Event) => {
        this.updateNoteStatsByEvents([evt], rootEvent.pubkey, {
          statsRootEvent: rootEvent,
          interactionTargetNoteId: rootHex
        })
      }
    })
    this.notifyNoteStats(rootHex)
  }

  private addLikeByEvent(evt: Event, _originalEventAuthor?: string, forcedTargetEventId?: string) {
    const targetEventIdRaw = this.reactionTargetHexForLike(evt, forcedTargetEventId)
    if (!targetEventIdRaw) return
    const targetEventId = this.statsKey(targetEventIdRaw)

    const old = this.noteStatsMap.get(targetEventId) || {}
    const likeIdSet = old.likeIdSet || new Set()
    const likes = old.likes || []
    if (likeIdSet.has(evt.id)) return

    const emoji = this.reactionEmojiFromEvent(evt)

    likeIdSet.add(evt.id)
    likes.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, emoji })
    this.noteStatsMap.set(targetEventId, { ...old, likeIdSet, likes })
    return targetEventId
  }

  /** NIP-25 kind 17 reactions to http(s) URLs; stats key matches synthetic RSS thread root id. */
  private addLikeByExternalWebReactionEvent(
    evt: Event,
    _originalEventAuthor?: string,
    forcedTargetEventId?: string
  ) {
    const url = getWebExternalReactionTargetUrl(evt)
    if (!url) return

    const targetEventId = this.statsKey(
      forcedTargetEventId ?? rssArticleStableEventId(canonicalizeRssArticleUrl(url))
    )

    const old = this.noteStatsMap.get(targetEventId) || {}
    const likeIdSet = old.likeIdSet || new Set()
    const likes = old.likes || []
    if (likeIdSet.has(evt.id)) return

    const emoji = this.reactionEmojiFromEvent(evt)

    likeIdSet.add(evt.id)
    likes.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, emoji })
    this.noteStatsMap.set(targetEventId, { ...old, likeIdSet, likes })
    return targetEventId
  }

  removeLike(eventId: string, reactionEventId: string) {
    const key = this.statsKey(eventId)
    const old = this.noteStatsMap.get(key) || {}
    const likeIdSet = old.likeIdSet || new Set()
    const likes = old.likes || []
    
    if (!likeIdSet.has(reactionEventId)) return key

    likeIdSet.delete(reactionEventId)
    const newLikes = likes.filter(like => like.id !== reactionEventId)
    this.noteStatsMap.set(key, { ...old, likeIdSet, likes: newLikes })
    this.notifyNoteStats(key)
    return key
  }

  /** Target id for repost stats: `e` first (NIP-18 for both kind 6 and 16), then embedded JSON, then `a` (generic only). */
  private repostStatsTargetId(evt: Event, forcedTargetEventId?: string): string | undefined {
    const forced = forcedTargetEventId?.trim()
    if (forced) return forced
    return getNip18RepostTargetId(evt)
  }

  private addRepostByEvent(evt: Event, originalEventAuthor?: string, forcedTargetEventId?: string) {
    const rawId = this.repostStatsTargetId(evt, forcedTargetEventId)
    if (!rawId) return
    const eventId = this.statsKey(rawId)

    const old = this.noteStatsMap.get(eventId) || {}
    const repostPubkeySet = old.repostPubkeySet || new Set()
    const reposts = old.reposts || []
    if (repostPubkeySet.has(evt.pubkey)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    repostPubkeySet.add(evt.pubkey)
    reposts.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at })
    this.noteStatsMap.set(eventId, { ...old, repostPubkeySet, reposts })
    return eventId
  }

  private addZapByEvent(evt: Event, originalEventAuthor?: string) {
    const info = getZapInfoFromEvent(evt)
    if (!info) return
    const { originalEventId, senderPubkey, invoice, amount, comment } = info
    if (!originalEventId || !senderPubkey) return
    if (!amount || amount <= 0) return // Suppress 0 sat zaps (spam)

    if (originalEventAuthor && originalEventAuthor === senderPubkey) {
      return
    }

    return this.addZap(
      senderPubkey,
      originalEventId!,
      invoice!,
      amount,
      comment,
      evt.created_at,
      false
    )
  }

  private addMoneroTipByEvent(evt: Event, originalEventAuthor?: string) {
    const info = getMoneroTipInfo(evt)
    if (!info) return

    const eTag = evt.tags.find((t) => t[0] === 'e' || t[0] === 'E')
    const targetHex = eTag?.[1]?.trim().toLowerCase()
    if (!targetHex || !/^[0-9a-f]{64}$/.test(targetHex)) return

    const senderPubkey = info.senderPubkey.toLowerCase()
    if (originalEventAuthor && originalEventAuthor.toLowerCase() === senderPubkey) {
      return
    }

    const amountPiconero = info.amountXmr ? xmrToPiconeros(info.amountXmr) : 0

    return this.addMoneroTip(
      senderPubkey,
      targetHex,
      evt.id,
      amountPiconero,
      info.comment,
      evt.created_at,
      false
    )
  }

  private addPaymentNotificationByEvent(
    evt: Event,
    originalEventAuthor?: string,
    forcedTargetEventId?: string
  ) {
    const info = getPaymentNotificationInfo(evt)
    if (!info) return

    const forced = forcedTargetEventId?.trim().toLowerCase()
    const targetHex =
      forced && /^[0-9a-f]{64}$/.test(forced)
        ? forced
        : info.referencedEventId?.trim().toLowerCase()
    if (!targetHex || !/^[0-9a-f]{64}$/.test(targetHex)) return

    const senderPubkey = info.senderPubkey.toLowerCase()
    if (originalEventAuthor && originalEventAuthor.toLowerCase() === senderPubkey) {
      return
    }

    return this.addPaymentNotification(
      senderPubkey,
      targetHex,
      evt.id,
      info.amountSats,
      info.comment,
      evt.created_at,
      false
    )
  }

  /** Walk parent notes (session cache) so subtree reply counts include all ancestors up the chain. */
  private replyAncestorChainStartingAt(immediateParentId: string): string[] {
    const chain: string[] = []
    const seen = new Set<string>()
    let cur: string | undefined = this.statsKey(immediateParentId)
    for (let hop = 0; hop < 14; hop++) {
      if (!cur) break
      if (seen.has(cur)) break
      seen.add(cur)
      chain.push(cur)
      if (!/^[0-9a-f]{64}$/i.test(cur)) break
      const parentEv = client.peekSessionCachedEvent(cur)
      if (!parentEv) break
      const p = getParentEventHexId(parentEv)
      if (!p || !/^[0-9a-f]{64}$/i.test(p)) break
      cur = this.statsKey(p)
    }
    return chain
  }

  /** Append `evt` to `replies` for each note id in `chain` (dedupe per note). */
  private appendReplyAtAncestorChain(evt: Event, chain: string[]): string[] {
    const affected: string[] = []
    for (const rawKey of chain) {
      const replyKey = this.statsKey(rawKey)
      const old = this.noteStatsMap.get(replyKey) || {}
      const replyIdSet = old.replyIdSet || new Set()
      const replies = old.replies || []
      if (replyIdSet.has(evt.id)) continue
      replyIdSet.add(evt.id)
      replies.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at })
      this.noteStatsMap.set(replyKey, { ...old, replyIdSet, replies })
      affected.push(replyKey)
    }
    return affected
  }

  private addOpReferenceAsThreadResponse(
    evt: Event,
    originalEventAuthor: string | undefined,
    statsRoot: Event
  ): string[] {
    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return []
    }
    const rootRef = threadRootRefFromStatsRootEvent(statsRoot)
    if (!rootRef || !eventReferencesThreadTarget(evt, rootRef)) {
      return []
    }
    const anchor = this.anchorNoteIdForOpReferenceStats(evt, rootRef)
    if (!anchor) return []
    const chain = /^[0-9a-f]{64}$/i.test(this.statsKey(anchor))
      ? this.replyAncestorChainStartingAt(anchor)
      : [this.statsKey(anchor)]
    return this.appendReplyAtAncestorChain(evt, chain)
  }

  private anchorNoteIdForOpReferenceStats(evt: Event, root: TThreadRootRef): string | undefined {
    const p = getParentEventHexId(evt)
    if (p && /^[0-9a-f]{64}$/i.test(p)) {
      return p.toLowerCase()
    }
    if (root.type === 'E') return root.id
    if (root.type === 'A') {
      const h = root.eventId.trim().toLowerCase()
      return /^[0-9a-f]{64}$/i.test(h) ? h : root.id
    }
    if (root.type === 'I') {
      return rssArticleStableEventId(canonicalizeRssArticleUrl(root.id))
    }
    return undefined
  }

  private addReplyByEvent(evt: Event, originalEventAuthor?: string, forcedOriginalEventId?: string): string[] {
    let originalEventId: string | undefined = forcedOriginalEventId

    if (!originalEventId) {
      if (evt.kind === ExtendedKind.COMMENT || evt.kind === ExtendedKind.VOICE_COMMENT) {
        const eTag = evt.tags.find(tagNameEquals('e')) ?? evt.tags.find(tagNameEquals('E'))
        originalEventId = eTag?.[1]
        if (!originalEventId) {
          const scopeUrl = getArticleUrlFromCommentITags(evt)
          if (scopeUrl) {
            originalEventId = rssArticleStableEventId(canonicalizeRssArticleUrl(scopeUrl))
          }
        }
      } else if (evt.kind === kinds.ShortTextNote) {
        // Prefer NIP-10 reply parent (matches getParentETag), not the first of reply|root in tag order.
        const parentHex = getParentEventHexId(evt)
        if (parentHex && /^[0-9a-f]{64}$/i.test(parentHex)) {
          originalEventId = parentHex.toLowerCase()
        }
        if (!originalEventId) {
          const aTag = evt.tags.find(tagNameEquals('a'))
          if (aTag) {
            originalEventId = aTag[1]
          }
        }
      }
    }

    if (!originalEventId) return []
    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return []
    }

    const replyKey = this.statsKey(originalEventId)
    const chain = /^[0-9a-f]{64}$/i.test(replyKey)
      ? this.replyAncestorChainStartingAt(originalEventId)
      : [replyKey]
    return this.appendReplyAtAncestorChain(evt, chain)
  }

  private isQuoteByEvent(evt: Event): boolean {
    return evt.tags.some(tag => tag[0] === 'q' && tag[1])
  }

  private addQuoteByEvent(evt: Event, originalEventAuthor?: string) {
    const quotedEventId = evt.tags.find(tag => tag[0] === 'q')?.[1]
    if (!quotedEventId) return
    const quoteKey = this.statsKey(quotedEventId)

    const old = this.noteStatsMap.get(quoteKey) || {}
    const quoteIdSet = old.quoteIdSet || new Set()
    const quotes = old.quotes || []

    if (quoteIdSet.has(evt.id)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    quoteIdSet.add(evt.id)
    quotes.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at })
    this.noteStatsMap.set(quoteKey, { ...old, quoteIdSet, quotes })
    return quoteKey
  }

  private addHighlightByEvent(evt: Event, originalEventAuthor?: string) {
    let highlightedEventId = evt.tags.find((tag) => tag[0] === 'e')?.[1]
    if (!highlightedEventId) {
      const pageUrl = getHighlightSourceHttpUrl(evt)
      if (pageUrl) {
        highlightedEventId = rssArticleStableEventId(canonicalizeRssArticleUrl(pageUrl))
      }
    }
    if (!highlightedEventId) return
    const highlightKey = this.statsKey(highlightedEventId)

    const old = this.noteStatsMap.get(highlightKey) || {}
    const highlightIdSet = old.highlightIdSet || new Set()
    const highlights = old.highlights || []

    if (highlightIdSet.has(evt.id)) return

    if (originalEventAuthor && originalEventAuthor === evt.pubkey) {
      return
    }

    highlightIdSet.add(evt.id)
    highlights.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at })
    this.noteStatsMap.set(highlightKey, { ...old, highlightIdSet, highlights })
    return highlightKey
  }

  /** Kind 39701: count one bookmark per pubkey for this article URL (synthetic thread id). */
  private addWebBookmarkByArticleUrlEvent(evt: Event): string | undefined {
    const url = getWebBookmarkArticleUrl(evt)
    if (!url) return
    const targetId = this.statsKey(rssArticleStableEventId(canonicalizeRssArticleUrl(url)))
    const old = this.noteStatsMap.get(targetId) || {}
    const bookmarkPubkeySet = old.bookmarkPubkeySet ?? new Set<string>()
    const replies = [...(old.replies ?? [])]

    const existingIdx = replies.findIndex((r) => r.pubkey === evt.pubkey)
    if (existingIdx >= 0) {
      const existing = replies[existingIdx]
      if (
        existing.created_at > evt.created_at ||
        (existing.created_at === evt.created_at && existing.id.localeCompare(evt.id) >= 0)
      ) {
        return targetId
      }
      replies.splice(existingIdx, 1)
    }

    bookmarkPubkeySet.add(evt.pubkey)
    if (!replies.some((r) => r.id === evt.id)) {
      replies.push({ id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at })
    }
    this.noteStatsMap.set(targetId, { ...old, bookmarkPubkeySet, replies })
    this.notifyNoteStats(targetId)
    return targetId
  }

  /** Each bookmark list author counts once per target `e` id in that list. */
  private addBookmarkListRefsByEvent(evt: Event) {
    for (const tag of evt.tags) {
      if (tag[0] !== 'e' || !tag[1]) continue
      const targetId = this.statsKey(tag[1])
      const old = this.noteStatsMap.get(targetId) || {}
      const bookmarkPubkeySet = old.bookmarkPubkeySet ?? new Set<string>()
      if (bookmarkPubkeySet.has(evt.pubkey)) continue
      bookmarkPubkeySet.add(evt.pubkey)
      this.noteStatsMap.set(targetId, { ...old, bookmarkPubkeySet })
      this.notifyNoteStats(targetId)
    }
  }
}

const instance = new NoteStatsService()

export default instance
