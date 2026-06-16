import {
  FAST_READ_RELAY_URLS,
  METADATA_CO_FETCH_KINDS,
  ExtendedKind,
  FAST_WRITE_RELAY_URLS,
  DOCUMENT_RELAY_URLS,
  FIRST_RELAY_RESULT_GRACE_MS,
  HTTP_TIMELINE_POLL_INTERVAL_MS,
  HTTP_TIMELINE_POLL_SINCE_OVERLAP_SEC,
  isAuthorProfileMetadataPublishKind,
  isDocumentRelayKind,
  isSocialKindBlockedKind,
  relayFilterIncludesSocialKindBlockedKind,
  relaysAfterSocialKindBlockedStrip,
  SOCIAL_KIND_BLOCKED_RELAY_URLS,
  MAX_CONCURRENT_RELAY_CONNECTIONS,
  MAX_PUBLISH_RELAYS,
  PUBLISH_RELAY_LIST_RESOLUTION_TIMEOUT_MS,
  FETCH_RELAY_LIST_UI_TIMEOUT_MS,
  MULTI_RELAY_PUBLISH_ACK_CAP_MS,
  PUBLISH_MULTI_RELAY_CONNECTION_CAP_MS,
  RELAY_NIP42_PUBLISH_ACK_TIMEOUT_MS,
  RELAY_POOL_CONNECTION_TIMEOUT_MS,
  RELAY_READ_ONLY_POOL_CONNECT_TIMEOUT_MS,
  TIMELINE_SHARD_SUBSCRIBE_CONCURRENCY,
  OUTBOX_PUBLISH_RETRY_DELAY_MS,
  EARLY_PUBLISH_SUCCESS_GRACE_MS,
  DEFAULT_FAVORITE_RELAYS,
  NIP66_DISCOVERY_RELAY_URLS,
  PROFILE_RELAY_URLS,
  READ_ONLY_RELAY_URLS,
  READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS,
  NIP42_POOL_AUTOMATIC_AUTH_RELAY_URLS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'

import { archivesMetadataListToProfiles } from '@/lib/archives-profile-metadata'
import { createEphemeralSigner } from '@/lib/anon-session'
import { getCacheRelayUrls } from '@/lib/private-relays'
import storage from '@/services/local-storage.service'
import {
  collectReadInboxUrlsFromRelayList,
  collectRemoteReadInboxUrlsFromRelayList,
  collectUserReadInboxUrls,
  collectViewerReadInboxUrls
} from '@/lib/viewer-read-inboxes'
import {
  collectUserWriteOutboxUrls,
  collectViewerWriteOutboxUrls,
  collectWriteOutboxUrlsFromRelayList
} from '@/lib/viewer-write-outboxes'
import { isMetadataPolicyProfileRelay } from '@/lib/metadata-policy-curated-relays'
import {
  buildPersonalRelayKeySet,
  sanitizeRelayUrlsForFetch,
  isReadOnlyIndexerRelay,
  isReadOnlyRelayAllowedForViewer,
  isRelayConnectionAllowedForViewer,
  isMetadataRelaysOnlyPolicyActive,
  isRelayUrlInViewerMetadataLists,
  grantRelayConnectionOperationScope,
  enterSingleRelayExplicitFetchScope,
  isSingleRelayExplicitBrowseActive,
  isSingleRelayExplicitFetchScopeActive,
  isSingleRelayExplicitPolicyActive,
  setViewerPersonalRelayKeys
} from '@/lib/read-only-relay-personal'
import {
  profileFetchRelayUrlsWithoutFastReadLayer,
  publicReadRelayFallbackUrls,
  viewerUsesGlobalRelayDefaults
} from '@/lib/viewer-relay-defaults'
import {
  filterViewerBlockedRelaysForFetch,
  getViewerBlockedRelayUrls,
  isViewerRelayBlocked,
  parseBlockedRelayUrlsFromEvent,
  setViewerBlockedRelayUrls
} from '@/lib/viewer-blocked-relays'
import {
  filterForRelay,
  sanitizeSubscribeFiltersBeforeReq,
  withDocumentRelayUrlsForFilters
} from './client-subscribe-filters'

/** Single key for `pool.seenOn` / query seen-on maps (hex ids are case-insensitive). */
function canonicalSeenOnEventId(eventId: string): string {
  const t = eventId.trim()
  return /^[0-9a-f]{64}$/i.test(t) ? t.toLowerCase() : t
}

import { shouldDropEventOnIngest, type ShouldDropEventOnIngestOptions } from '@/lib/event-ingest-filter'
import {
  getHttpRelayListFromEvent,
  getProfileFromEvent,
  getRelayListFromEvent,
  getRelaySetFromEvent,
  getRelayUrlFromRelayReviewEvent
} from '@/lib/event-metadata'
import logger from '@/lib/logger'
import type { PublishTrace } from '@/lib/publish-trace'
import { hiddenNetworkRelayUnavailableReason } from '@/lib/hidden-network-relay'
import { fetchHiddenNetworkRelayStatus } from '@/lib/hidden-network-relay-status'
import { installBrowserHiddenNetworkRelayWebSocket } from '@/lib/hidden-network-relay.browser'
import { patchPoolRelayAuthRaceAndFeedback } from '@/lib/nostr-relay-auth-patch'
import { queueRelayAuthSign } from '@/lib/relay-auth-sign-queue'
import {
  authenticateNip42Relay,
  isRelayAuthAccessDeniedMessage,
  isRelayAuthRequiredCloseReason,
  isRelayAuthRequiredErrorMessage,
  isRelayConnectionClosedError,
  isRelaySubscriptionClosedByCaller,
  RelayAuthAccessDeniedError
} from '@/lib/relay-nip42-auth'
import { applyRelayNip42AckTimeout } from '@/lib/relay-nip42-tuning'
import { getKeyForDeletedLookup } from '@/lib/deleted-event-key'
import { buildDeletionRelayUrls, dispatchTombstonesUpdated } from '@/lib/tombstone-events'
import { hexPubkeysEqual, isValidPubkey, pubkeyToNpub, userIdToPubkey } from '@/lib/pubkey'
import { collectNip05ValuesFromKind0, profileKind0MatchesSearchQuery } from '@/lib/profile-metadata-search'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'
import { getPubkeysFromPTags, tagNameEquals } from '@/lib/tag'
import { isReadOnlyRelayUrl } from '@/lib/relay-publish-filter'
import { getPaymentAttestationTargetId } from '@/lib/superchat'
import {
  buildPublicMessagePublishRelayUrls,
  collectRecipientInboxUrls
} from '@/lib/public-message-publish-relays'
import { buildPrioritizedWriteRelayUrls, dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { filterPublishingRelayUrls } from '@/lib/social-kind-blocked-relays'
import {
  IndexRelayTransportError,
  isIndexRelayTransportFailure,
  publishEventToHttpRelay
} from '@/lib/index-relay-http'
import {
  relayFiltersUseCapitalLetterTagKeys,
  relayUrlsStripExtendedTagReqBlocked
} from '@/lib/relay-extended-tag-req-blocks'
import {
  stripLocalNetworkRelaysFromRelayList,
  stripMailboxLocalUrlsForRemoteViewers,
  syntheticOriginalRelaysFromReadWrite,
  stripLocalNetworkRelaysForWssReq,
  urlIsNonLocalForRemoteViewer
} from '@/lib/relay-list-sanitize'
import {
  getViewerNostrLandAggrSearchRelayUrls,
  syncViewerRelayStackNostrLandAggrEligible
} from '@/lib/nostr-land-relay-eligibility'
import {
  canonicalRelaySessionKey,
  httpIndexBasesForRelayQuery,
  isKind10243HttpRelayTagUrl,
  isLocalNetworkUrl,
  isWebsocketUrl,
  normalizeAnyRelayUrl,
  normalizeHttpRelayUrl,
  normalizeRelayUrlByScheme,
  normalizeUrl,
  simplifyUrl,
  urlMatchesConfiguredHttpIndexRelay
} from '@/lib/url'
import { canonicalFeedFilter, canonicalRelayUrls } from '@/features/feed/descriptor'
import { initRelayPoolIdle, touchRelayPoolActivity, closePublishTransientRelaySockets, closeRelayPoolSocketsIfIdle } from '@/lib/relay-pool-idle'
import { classifyRelayNotice, relaySessionStrikes } from '@/lib/relay-strikes'
import { isSafari } from '@/lib/utils'
import {
  ISigner,
  TDraftEvent,
  TProfile,
  TPublishEventExtras,
  TPublishOptions,
  TRelayList,
  TMailboxRelay,
  TSignerType,
  TSubRequestFilter
} from '@/types'
import { sha256 } from '@noble/hashes/sha2'
import dayjs from 'dayjs'
import FlexSearch from 'flexsearch'
import { LRUCache } from 'lru-cache'
import {
  EventTemplate,
  Filter,
  kinds,
  matchFilters,
  Event as NEvent,
  Relay,
  VerifiedEvent,
  verifyEvent
} from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { AbstractRelay } from 'nostr-tools/abstract-relay'
import indexedDb from './indexed-db.service'
import postEditorService from './post-editor.service'
import { preloadGifsIntoIdbCache } from './gif.service'
import { invalidateArchiveFootprintCache } from './event-archive.service'
import { notifySessionInteractivePrewarmComplete } from './session-interactive-prewarm-bridge'
import { nip66Service } from './nip66.service'
import nostrArchivesApi from './nostr-archives-api.service'
import { buildProfileKind0SearchFilters } from '@/lib/profile-relay-search-filters'
import { patchRelayNoticeForFetchFailures } from '@/services/relay-notice-fetch-failure'
import {
  compactFilterForRelayLog,
  humanizeSubscribeTerminalDetail,
  relayHostForSubscribeLog,
  RelayOpTerminalRow,
  RelayPublishOpBatch,
  RelaySubscribeOpBatch
} from '@/services/relay-operation-log.service'
import { NIP50_QUERY_GLOBAL_TIMEOUT_FLOOR_MS, QueryService } from './client-query.service'
import { EventService } from './client-events.service'
import { ReplaceableEventService } from './client-replaceable-events.service'

/** Live timeline REQ: EOSE caps “connected but silent” relays. */
const SUBSCRIBE_RELAY_EOSE_TIMEOUT_MS = 4800
/** Coalesce pre-EOSE timeline snapshots; `setTimeout` so updates still run when rAF is throttled (background tab). */
const TIMELINE_STREAMING_COALESCE_MS = 24

/**
 * After initial timeline EOSE (incl. grace), events with `created_at` older than this many seconds
 * (relative to wall clock at EOSE) are treated as backlog stragglers and merged into the feed;
 * fresher timestamps go to `onNew` (live / “new notes” UX).
 */
const TIMELINE_STRAGGLER_MAX_AGE_SEC = 600

/** Same shape as `QueryService` `req_end` `perRelay` — NIP-50 search uses `subscribeTimeline`, not `query()`. */
function logSearchTimelineNip50ReqEnd(args: {
  timelineBatchId: string
  search: string
  subRequests: { urls: string[]; filter: TSubRequestFilter }[]
  eventsSnapshot: NEvent[]
  terminals: RelayOpTerminalRow[]
  getSeenForEvent: (eventId: string) => string[]
}): void {
  const { timelineBatchId, search, subRequests, eventsSnapshot, terminals, getSeenForEvent } = args
  const norm = (u: string) => normalizeUrl(u) || u
  type Row = {
    url: string
    host: string
    terminal?: RelayOpTerminalRow['outcome']
    detail?: string
    eventsReturned: number
  }
  const byKey = new Map<string, Row>()
  const rowFor = (url: string): Row => {
    const key = norm(url)
    let r = byKey.get(key)
    if (!r) {
      r = { url: key, host: relayHostForSubscribeLog(key), eventsReturned: 0 }
      byKey.set(key, r)
    }
    return r
  }
  for (const t of terminals) {
    const r = rowFor(t.relayUrl)
    r.terminal = t.outcome
    r.detail = humanizeSubscribeTerminalDetail(t.outcome, t.detail)
  }
  for (const e of eventsSnapshot) {
    for (const u of getSeenForEvent(e.id)) {
      rowFor(u).eventsReturned += 1
    }
  }
  const inputRelaysOrdered = Array.from(
    new Set(subRequests.flatMap((s) => s.urls).map((u) => norm(u)).filter(Boolean))
  )
  for (const u of inputRelaysOrdered) {
    rowFor(u)
  }
  const kindHistogram: Record<string, number> = {}
  for (const e of eventsSnapshot) {
    const k = String(e.kind)
    kindHistogram[k] = (kindHistogram[k] ?? 0) + 1
  }
  const perRelay = [...byKey.values()].sort((a, b) => a.host.localeCompare(b.host))
  logger.info('[QueryService] search_req_end', {
    timelineBatchId,
    source: 'subscribeTimeline',
    search,
    eventCount: eventsSnapshot.length,
    kindHistogram,
    perRelay
  })
}

function summarizeFiltersForRelayLog(filters: Filter[]): Record<string, unknown> {
  const f = filters[0]
  if (!f) return {}
  const out: Record<string, unknown> = {}
  if (f.kinds != null) out.kinds = f.kinds
  if (f.limit != null) out.limit = f.limit
  if (f.authors?.length) out.authorCount = f.authors.length
  if (f.ids?.length) out.idCount = f.ids.length
  if (f.search) out.search = true
  if (f['#p']?.length) out.pTagCount = f['#p'].length
  if (f['#e']?.length) out.eTagCount = f['#e'].length
  if (f['#t']?.length) out.tTagCount = f['#t'].length
  return out
}

/** Long connect + NIP-42 boost for global index relays — not {@link READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS}. */
const READ_ONLY_RELAY_CONNECT_BOOST_URLS = new Set(
  [
    ...READ_ONLY_RELAY_URLS.filter(
      (u) =>
        !READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS.some(
          (r) => (normalizeUrl(r) || r).toLowerCase() === (normalizeUrl(u) || u).toLowerCase()
        )
    ),
    ...NIP42_POOL_AUTOMATIC_AUTH_RELAY_URLS
  ].map((u) => normalizeUrl(u) || u)
)

/** Hostname (+ path when not "/") for readable publish / retry console lines. */
function relayHostForUserLog(url: string): string {
  const n = normalizeUrl(url) || url
  try {
    const u = new URL(n.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:'))
    const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : ''
    return path ? `${u.host}${path}` : u.host
  } catch {
    return n
  }
}

type TTimelineRef = [string, number]

/** Run async work on each item with at most `concurrency` tasks in flight; results match `items` order. */
async function mapPoolWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const c = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (true) {
      const i = next++
      if (i >= items.length) break
      results[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: c }, () => worker()))
  return results
}

/** Many features call `fetchRelayLists` in parallel; each timeout used to emit an identical WARN. */
let fetchRelayListBudgetWarnLastMs = 0
const FETCH_RELAY_LIST_BUDGET_WARN_MIN_INTERVAL_MS = 60_000
/** Background kind-10002 refresh per pubkey set — avoids re-REQ on every embed/publish lookup. */
const REFRESH_RELAY_LIST_BG_MIN_INTERVAL_MS = 5 * 60_000

class ClientService extends EventTarget {
  static instance: ClientService

  signer?: ISigner
  /** Set with signer from NostrProvider; used to skip relay AUTH when read-only (e.g. npub). */
  signerType?: TSignerType
  pubkey?: string
  /** Normalized kind **10243** index relay bases for the logged-in viewer (not arbitrary https URLs). */
  private viewerHttpIndexRelayBases: string[] = []
  private pool: SimplePool

  // Sub-services (public for direct access)
  public readonly queryService: QueryService
  public readonly eventService: EventService
  public readonly replaceableEventService: ReplaceableEventService

  private timelines: Record<
    string,
    | {
        refs: TTimelineRef[]
        filter: TSubRequestFilter
        urls: string[]
        /** When true, skip writing this shard to IndexedDB via {@link scheduleTimelinePersist} (relay-authoritative feeds). */
        disablePersist?: boolean
      }
    | string[]
    | undefined
  > = {}
  private timelinePersistTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** In-flight {@link fetchRelayList} dedupe: key = viewer pubkey + target pubkey (sanitization depends on viewer). */
  private relayListRequestCache = new Map<string, Promise<TRelayList>>()
  /** Dedupe {@link refreshRelayListsFromNetwork} — was firing on every cached lookup and stacking REQs. */
  private refreshRelayListsBgInFlight = new Set<string>()
  private refreshRelayListsBgLastAtMs = new Map<string, number>()
  private userIndex = new FlexSearch.Index({
    tokenize: 'forward'
  })


  /** Session-only: relay URL -> { successCount, sumLatencyMs } for preferring faster, proven relays when picking "random" relays. */
  private sessionRelayPublishStats = new Map<string, { successCount: number; sumLatencyMs: number }>()
  /** Author outbox / random publish targets to close after publish (not personal or profile index). */
  private publishTransientRelayUrls = new Set<string>()

  /**
   * IndexedDB profile index + NIP-66 relay discovery run once per page session. When logged in,
   * {@link initUserIndexFromFollowings} runs **after** this batch completes (deferred) so startup is not
   * blocked on hundreds of follow relay round-trips.
   * @see {@link runSessionPrewarm}
   */
  private sessionPrewarmBaseCompleted = false
  private profileSearchIndexWarmPromise: Promise<void> | null = null
  private profileSearchIndexWarmed = false
  /** Deferred follow-graph prefetch; cancelled on new session prewarm. */
  private followingIndexPrefetchTimer: ReturnType<typeof setTimeout> | null = null
  /** Deferred kind 1063 GIF preload from viewer outboxes; cancelled on new session prewarm. */
  private gifOutboxPreloadTimer: ReturnType<typeof setTimeout> | null = null
  /** Per-pubkey cooldown for {@link prefetchAuthorCoreReplaceables} from feed ingest (avoid REQ storms). */
  private authorCorePrefetchCooldownUntilMs = new Map<string, number>()
  private static readonly AUTHOR_CORE_PREFETCH_COOLDOWN_MS = 6 * 60 * 1000
  /**
   * Max kind-0 `created_at` already queued for IndexedDB from {@link QueryService} ingest (same profile
   * re-emitted across relays/batches should not each open tombstone + get + put).
   */
  private ingestProfileIdbMaxCreatedAt = new Map<string, number>()
  /** Dedupe {@link addUsernameToIndex} for the same kind-0 id (multi-relay / re-REQ spam). */
  private metadataIngestIndexDedupe = new LRUCache<string, true>({ max: 12_000 })

  constructor() {
    super()
    installBrowserHiddenNetworkRelayWebSocket()
    void fetchHiddenNetworkRelayStatus({ force: true })
    this.pool = new SimplePool()
    this.pool.trackRelays = true
    const rawEnsureRelay = this.pool.ensureRelay.bind(this.pool)
    this.pool.ensureRelay = async (
      url: string,
      params?: { connectionTimeout?: number; abort?: AbortSignal; purpose?: 'read' | 'write' }
    ) => {
      // While offline, skip any relay that isn't on the local network.
      // This prevents a flood of failed WebSocket/HTTP connection attempts across
      // every part of the app (feeds, profile lookups, relay-list fetches, etc.).
      if (!navigator.onLine && !isLocalNetworkUrl(url)) {
        throw new Error(`[offline] skipping non-local relay ${url}`)
      }
      const hiddenNetworkBlock = hiddenNetworkRelayUnavailableReason(url)
      if (hiddenNetworkBlock) {
        throw new Error(hiddenNetworkBlock)
      }
      if (params?.purpose !== 'write' && !isRelayConnectionAllowedForViewer(url)) {
        throw new Error(`[metadata-relays-only] skipping relay ${url}`)
      }
      if (params?.purpose !== 'write') {
        if (relaySessionStrikes.isRateLimited(url)) {
          throw new Error(`[relay-rate-limit] skipping relay ${url}`)
        }
        if (!isSingleRelayExplicitPolicyActive() && relaySessionStrikes.isReadHttpSkipped(url)) {
          throw new Error(`[relay-strike] skipping unresponsive relay ${url}`)
        }
      }
      if (!isWebsocketUrl(url) && isKind10243HttpRelayTagUrl(url)) {
        throw new Error(`[http-index-relay] ${url} uses the HTTPS index API, not WebSocket`)
      }
      const n = normalizeUrl(url) || url
      const base = params?.connectionTimeout ?? RELAY_POOL_CONNECTION_TIMEOUT_MS
      const connectionTimeout = READ_ONLY_RELAY_CONNECT_BOOST_URLS.has(n)
        ? Math.max(base, RELAY_READ_ONLY_POOL_CONNECT_TIMEOUT_MS)
        : base
      let relay
      try {
        relay = await rawEnsureRelay(url, {
          ...params,
          connectionTimeout
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const skipStrike =
          msg.includes('[metadata-relays-only]') ||
          msg.includes('[relay-strike]') ||
          msg.includes('[relay-rate-limit]') ||
          msg.includes('[offline]') ||
          msg.includes('[http-index-relay]') ||
          msg.includes('[hidden-network-relay]')
        if (
          !skipStrike &&
          (params?.purpose !== 'write' || isLocalNetworkUrl(url))
        ) {
          relaySessionStrikes.recordConnectionFailure(url, msg, 'connection')
        }
        throw err
      }
      patchPoolRelayAuthRaceAndFeedback(relay)
      applyRelayNip42AckTimeout(relay)
      touchRelayPoolActivity(url)
      return relay
    }

    // Initialize sub-services
    this.queryService = new QueryService(this.pool, {
      onRelayNoticeFetchFailure: (normalizedUrl, noticeMessage) =>
        this.handleRelayNoticeSession(normalizedUrl, noticeMessage)
    })
    this.eventService = new EventService(this.queryService)
    this.replaceableEventService = new ReplaceableEventService(
      this.queryService,
      (profileEvent) => this.addUsernameToIndex(profileEvent)
    )
    this.queryService.setQueryResultIngest((events) => {
      for (const e of events) {
        this.eventService.addEventToCache(e)
        // Kind 0 from timelines/REQs was only kept in the session LRU, not in PROFILE_EVENTS or FlexSearch,
        // so @-mention / profile search missed people you already saw on feeds (e.g. notifications).
        if (e.kind !== kinds.Metadata || shouldDropEventOnIngest(e)) continue
        const pk = e.pubkey.toLowerCase()
        const best = this.eventService.getSessionMetadataForPubkey(pk)
        if (!best || best.id !== e.id) continue
        if (!this.metadataIngestIndexDedupe.has(e.id)) {
          this.metadataIngestIndexDedupe.set(e.id, true)
          void this.addUsernameToIndex(e)
        }
        const prev = this.ingestProfileIdbMaxCreatedAt.get(pk) ?? -1
        if (e.created_at > prev) {
          this.ingestProfileIdbMaxCreatedAt.set(pk, e.created_at)
          this.trimIngestProfileIdbMap()
          void indexedDb.putReplaceableEvent(e).catch(() => {})
        }
      }
    })

    initRelayPoolIdle(this.pool, (relayKeyOrUrl) =>
      this.queryService.relayHasActiveSubscriptions(relayKeyOrUrl)
    )
  }

  public static getInstance(): ClientService {
    if (!ClientService.instance) {
      ClientService.instance = new ClientService()
    }
    return ClientService.instance
  }

  private async yieldForUiPaint(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve())
      } else {
        setTimeout(resolve, 0)
      }
    })
  }

  private async prewarmProfileSearchIndexFromIdb(): Promise<void> {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    let profileRows = 0
    await indexedDb.iterateProfileEvents(async (profileEvent) => {
      this.addUsernameToIndex(profileEvent)
      profileRows += 1
    })
    logger.info('[client] Prewarm: profile @-mention index from IndexedDB done', {
      profileRows,
      ms: typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : undefined
    })
  }

  /**
   * One-shot: local profile @-index + NIP-66 relay discovery (once per session). When logged in,
   * the heavy follow-list relay fetch runs **after** this returns (see {@link runSessionPrewarm}) so the
   * session gate and live-activities prewarm hook are not held for minutes on large follow graphs.
   */
  /**
   * Build FlexSearch @-mention index from IndexedDB on first use (not at session start).
   */
  async ensureProfileSearchIndexFromIdb(): Promise<void> {
    if (this.profileSearchIndexWarmed) return
    if (!this.profileSearchIndexWarmPromise) {
      this.profileSearchIndexWarmPromise = this.prewarmProfileSearchIndexFromIdb()
        .catch(() => {})
        .finally(() => {
          this.profileSearchIndexWarmed = true
        })
    }
    await this.profileSearchIndexWarmPromise
  }

  async runSessionPrewarm(options: { pubkey: string | null; signal?: AbortSignal }): Promise<void> {
    const signal = options.signal ?? new AbortController().signal

    if (!this.sessionPrewarmBaseCompleted) {
      this.sessionPrewarmBaseCompleted = true
    }

    /** Unblock sidebar/widgets immediately — no IndexedDB scan or NIP-66 at startup. */
    notifySessionInteractivePrewarmComplete()

    if (this.gifOutboxPreloadTimer != null) {
      clearTimeout(this.gifOutboxPreloadTimer)
    }
    /** GIF relays + viewer mailbox → IndexedDB; not tied to hydrate AbortSignal (that aborts on account switch). */
    this.gifOutboxPreloadTimer = setTimeout(() => {
      this.gifOutboxPreloadTimer = null
      void this.runGifCachePreload(options.pubkey).catch((err) => {
        logger.debug('[client] Prewarm: GIF cache preload failed', {
          pubkeySlice: options.pubkey?.slice(0, 12) ?? null,
          err: err instanceof Error ? err.message : String(err)
        })
      })
    }, 2_000)

    if (options.pubkey) {
      const pk = options.pubkey
      if (this.followingIndexPrefetchTimer != null) {
        clearTimeout(this.followingIndexPrefetchTimer)
      }
      /** Idle follow-graph prefetch only after the first minute (feeds win the connection pool). */
      this.followingIndexPrefetchTimer = setTimeout(() => {
        this.followingIndexPrefetchTimer = null
        if (signal.aborted) return
        void this.initUserIndexFromFollowings(pk, signal).catch((err) => {
          logger.debug('[client] Prewarm: following index background pass failed', {
            pubkeySlice: pk.slice(0, 12),
            err: err instanceof Error ? err.message : String(err)
          })
        })
      }, 60_000)
    }
  }

  /** {@link runSessionPrewarm} — background fetch into GIF IndexedDB cache. */
  private async runGifCachePreload(pubkey: string | null): Promise<void> {
    let followings: string[] = []
    let noteFallbackRelays: string[] = []
    if (pubkey) {
      const ev = await this.fetchFollowListEvent(pubkey)
      if (ev) followings = getPubkeysFromPTags(ev.tags)
      const rl = await this.peekRelayListFromStorage(pubkey)
      noteFallbackRelays = await collectViewerReadInboxUrls(pubkey, rl)
    }
    await preloadGifsIntoIdbCache(pubkey, followings, noteFallbackRelays)
  }

  /** NIP-66 discovery for Explore / publish hints — call when the user opens Explore, not at boot. */
  scheduleNip66RelayDiscoveryFromExplore(): void {
    if (typeof window === 'undefined') return
    window.setTimeout(() => {
      void this.fetchNip66RelayDiscovery()
    }, 500)
  }

  // Update signer in query service when it changes
  setSigner(signer: ISigner | undefined, signerType: TSignerType | undefined) {
    this.signer = signer
    this.signerType = signerType
    this.queryService.setSigner(signer, signerType)
    /**
     * NIP-42: proactive `AUTH` for relays that need it before the first REQ (read-only aggregators +
     * {@link NIP42_POOL_AUTOMATIC_AUTH_RELAY_URLS}). Without this, a REQ can EOSE empty while the extension
     * is still signing; the batch then finishes and never refetches. Other relays stay on reactive
     * `relay.auth()` after `auth-required` to avoid double-sign races with the wider pool.
     */
    if (signer && signerType !== 'npub' && signerType !== 'anon') {
      this.pool.automaticallyAuth = (relayURL: string) => {
        const n = normalizeUrl(relayURL) || relayURL
        if (!READ_ONLY_RELAY_CONNECT_BOOST_URLS.has(n)) return null
        // Read-only index relays (e.g. filter.nostr.wine): only AUTH when on the viewer's relay lists.
        if (isReadOnlyIndexerRelay(n) && !isReadOnlyRelayAllowedForViewer(n)) return null
        return async (event: EventTemplate) => {
          const evt = await queueRelayAuthSign(() => signer.signEvent(event))
          return evt as VerifiedEvent
        }
      }
    } else if (signerType === 'anon') {
      this.pool.automaticallyAuth = () => {
        return async (event: EventTemplate) => {
          const ephemeral = createEphemeralSigner()
          return (await ephemeral.signEvent(event)) as VerifiedEvent
        }
      }
    } else {
      this.pool.automaticallyAuth = undefined
    }
  }

  /**
   * NIP-65 read/write + favorites (10012) + cache relays (10432) for the logged-in viewer.
   * Used to gate {@link READ_ONLY_RELAY_URLS} and proactive NIP-42 on those relays.
   */
  async syncViewerPersonalRelayKeys(pubkey?: string): Promise<void> {
    const pk = pubkey?.trim() || this.pubkey?.trim()
    if (!pk) {
      this.viewerHttpIndexRelayBases = []
      setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
      syncViewerRelayStackNostrLandAggrEligible([])
      setViewerBlockedRelayUrls([])
      relaySessionStrikes.setSessionCacheRelayKeysFromKind10432(null)
      return
    }

    /** IndexedDB-first: personal lists (incl. cache + HTTP) before policy or network so locals stay allowed. */
    const storageUrls = await this.collectViewerPersonalRelayUrlsFromStorage(pk)

    try {
      const blockedEvt = await indexedDb.getReplaceableEvent(pk, ExtendedKind.BLOCKED_RELAYS)
      setViewerBlockedRelayUrls(parseBlockedRelayUrlsFromEvent(blockedEvt ?? null))
    } catch {
      setViewerBlockedRelayUrls([])
    }

    this.viewerHttpIndexRelayBases = filterViewerBlockedRelaysForFetch(storageUrls.httpIndexBases)
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(storageUrls.all), { viewerActive: true })
    syncViewerRelayStackNostrLandAggrEligible(storageUrls.all)
    relaySessionStrikes.setSessionCacheRelayKeysFromKind10432(
      storage.getCacheRelaysEnabled() ? storageUrls.cacheRelayEvent : null
    )
    this.closeMetadataPolicyDisallowedRelayConnections()
    this.closeViewerBlockedRelayConnections()

    const urls = [...storageUrls.all]
    try {
      urls.push(...(await this.fetchFavoriteRelays(pk)))
    } catch {
      // ignore
    }
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(urls), { viewerActive: true })
    syncViewerRelayStackNostrLandAggrEligible(urls)
    this.closeMetadataPolicyDisallowedRelayConnections()
    this.closeViewerBlockedRelayConnections()
  }

  /** NIP-65 / 10243 / 10432 / favorites (10012) from IndexedDB only — no network. */
  private async collectViewerPersonalRelayUrlsFromStorage(pubkey: string): Promise<{
    all: string[]
    httpIndexBases: string[]
    cacheRelayEvent: NEvent | undefined
  }> {
    const urls: string[] = []
    let httpIndexBases: string[] = []
    let cacheRelayEvent: NEvent | undefined
    try {
      const rl = await this.peekRelayListFromStorage(pubkey)
      httpIndexBases = [...(rl.httpRead ?? []), ...(rl.httpWrite ?? [])]
        .map((u) => normalizeHttpRelayUrl(u) || u)
        .filter(Boolean)
      urls.push(
        ...(rl.read ?? []),
        ...(rl.write ?? []),
        ...(rl.httpRead ?? []),
        ...(rl.httpWrite ?? [])
      )
    } catch {
      httpIndexBases = []
    }
    try {
      urls.push(...(await this.fetchFavoriteRelaysFromStorage(pubkey)))
    } catch {
      // ignore
    }
    try {
      cacheRelayEvent = (await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)) ?? undefined
      urls.push(...(await getCacheRelayUrls(pubkey)))
    } catch {
      cacheRelayEvent = undefined
    }
    try {
      for (const set of storage.getRelaySets()) {
        urls.push(...set.relayUrls)
      }
    } catch {
      // ignore
    }
    const all = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)))
    return { all, httpIndexBases, cacheRelayEvent }
  }

  /**
   * Kind 10243 bases used to route publish targets through the HTTP index API (not WebSocket).
   * Refreshes from IndexedDB when the batch includes https targets so reactions/posts work right
   * after saving kind 10243 without waiting for a full account re-sync.
   */
  private async resolveViewerHttpIndexBasesForPublish(
    publishTargetUrls: readonly string[]
  ): Promise<string[]> {
    const hasHttpTarget = publishTargetUrls.some((u) => isKind10243HttpRelayTagUrl(u.trim()))
    if (!hasHttpTarget) return this.viewerHttpIndexRelayBases

    const pk = this.pubkey?.trim()
    if (!pk) return this.viewerHttpIndexRelayBases

    try {
      const rl = await this.peekRelayListFromStorage(pk)
      const fresh = [...(rl.httpRead ?? []), ...(rl.httpWrite ?? [])]
        .map((u) => normalizeHttpRelayUrl(u) || u)
        .filter(Boolean)
      if (fresh.length > 0) {
        const filtered = filterViewerBlockedRelaysForFetch(fresh)
        this.viewerHttpIndexRelayBases = filtered
        return filtered
      }
    } catch {
      /* keep session cache */
    }
    return this.viewerHttpIndexRelayBases
  }

  /** Kind 10012 + embedded NIP-51 relay sets from IndexedDB only (no network). */
  async fetchFavoriteRelaysFromStorage(pubkey: string): Promise<string[]> {
    try {
      const favoriteRelaysEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.FAVORITE_RELAYS)
      if (!favoriteRelaysEvent) return []
      return await this.expandFavoriteRelayUrlsFromEvent(pubkey, favoriteRelaysEvent)
    } catch {
      return []
    }
  }

  /** Drop pooled WebSocket connections that violate the metadata-only read policy. */
  closeMetadataPolicyDisallowedRelayConnections(): void {
    if (!isMetadataRelaysOnlyPolicyActive()) return
    try {
      const toClose = [...this.pool.listConnectionStatus().keys()].filter(
        (url) => !isRelayConnectionAllowedForViewer(url)
      )
      if (toClose.length > 0) this.pool.close(toClose)
    } catch {
      // ignore
    }
  }

  /** Close pooled sockets to relays on the viewer block list (hostname-aware, wss/https). */
  closeViewerBlockedRelayConnections(): void {
    if (!getViewerBlockedRelayUrls().length) return
    try {
      const toClose = [...this.pool.listConnectionStatus().keys()].filter((url) =>
        isViewerRelayBlocked(url)
      )
      if (toClose.length > 0) this.pool.close(toClose)
    } catch {
      // ignore
    }
  }

  /** NIP-66: fetch relay discovery events (30166) in background to supplement search/NIP support. */
  private async fetchNip66RelayDiscovery(): Promise<void> {
    if (isMetadataRelaysOnlyPolicyActive()) return
    try {
      const discoveryRelays = Array.from(new Set([...FAST_READ_RELAY_URLS, ...NIP66_DISCOVERY_RELAY_URLS]))
      const events = await this.queryService.query(
        discoveryRelays,
        { kinds: [ExtendedKind.RELAY_DISCOVERY], limit: 2000 },
        undefined,
        { eoseTimeout: 4000, globalTimeout: 8000 }
      )
      if (events.length > 0) {
        const capped = events.length > 2000 ? events.slice(0, 2000) : events
        nip66Service.loadFromEvents(capped)
        logger.info('[client] Prewarm: NIP-66 relay discovery list updated', { count: capped.length })
      }
    } catch (err) {
      logger.warn('[client] Prewarm: NIP-66 relay discovery fetch failed', { err })
    }
  }

  /**
   * NIP-66: fetch 30166 events for a single relay (relay info page). Uses discovery relay set,
   * filter by #d so we get the newest report for this relay and can show monitor (author) info.
   */
  async fetchNip66DiscoveryForRelay(relayUrl: string): Promise<void> {
    const discoveryRelays = Array.from(new Set([...FAST_READ_RELAY_URLS, ...NIP66_DISCOVERY_RELAY_URLS]))
    const dTag = normalizeAnyRelayUrl(relayUrl) || relayUrl
    const shortForm = simplifyUrl(dTag)
    const dValues = dTag !== shortForm ? [dTag, shortForm] : [dTag]
    try {
      const events = await this.queryService.query(
        discoveryRelays,
        { kinds: [ExtendedKind.RELAY_DISCOVERY], '#d': dValues, limit: 20 },
        undefined,
        { eoseTimeout: 4000, globalTimeout: 6000 }
      )
      if (events.length > 0) {
        nip66Service.loadFromEvents(events)
      }
    } catch {
      // ignore per-relay fetch failure
    }
  }

  /** Sign with the session signer, or a fresh ephemeral key in anon write mode. */
  async signEventWithSession(draft: TDraftEvent): Promise<VerifiedEvent> {
    if (this.signerType === 'anon') {
      const ephemeral = createEphemeralSigner()
      return (await ephemeral.signEvent(draft)) as VerifiedEvent
    }
    if (!this.signer) {
      throw new Error('Please login first to sign the event')
    }
    return (await this.signer.signEvent(draft)) as VerifiedEvent
  }

  /** Read-only logins (e.g. npub) cannot sign relay AUTH challenges; avoid calling signEvent. */
  private canSignerAuthenticateRelay(): boolean {
    if (this.signerType === 'npub') return false
    if (this.signerType === 'anon') return true
    if (!this.signer) return false
    return true
  }

  /**
   * Pubkeys to pull **read** (inbox) relays for: `p`/`P` mentions and `e` tag relay pubkey hint (NIP-10).
   * Excludes the event author.
   */
  private collectReplyAndMentionPubkeys(event: NEvent): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (pk: string | undefined) => {
      if (!pk || !isValidPubkey(pk) || pk === event.pubkey || seen.has(pk)) return
      seen.add(pk)
      out.push(pk)
    }
    for (const t of event.tags) {
      const name = t[0]
      const v = t[1]
      const hint = t[3]
      if ((name === 'p' || name === 'P') && v) add(v)
      if (name === 'e' && hint) add(hint)
    }
    return out
  }

  /**
   * Write publish order: user outboxes → author inboxes → favorites → FAST_WRITE → FAST_READ → other.
   * Normalize, dedupe, then cap at {@link MAX_PUBLISH_RELAYS}.
   */
  private filterPublishingRelays(relays: string[], event: NEvent): string[] {
    return filterPublishingRelayUrls(relays, event.kind)
  }

  /** Kind 31987: always attempt the reviewed relay (`d` tag) first in the publish stack. */
  private pinReviewedRelayForRelayReviewPublish(relays: string[], event: NEvent): string[] {
    if (event.kind !== ExtendedKind.RELAY_REVIEW) return relays
    const reviewedRelay = getRelayUrlFromRelayReviewEvent(event)
    if (!reviewedRelay) return relays
    const normalized = normalizeRelayUrlByScheme(reviewedRelay) || reviewedRelay.trim()
    if (!normalized) return relays
    const [pinned] = this.filterPublishingRelays([normalized], event)
    if (!pinned) return relays
    const pinnedKey = (normalizeRelayUrlByScheme(pinned) || pinned).toLowerCase()
    return dedupeNormalizeRelayUrlsOrdered([
      pinned,
      ...relays.filter((url) => (normalizeRelayUrlByScheme(url) || url).toLowerCase() !== pinnedKey)
    ])
  }

  private relayListHasWriteUrls(relayList: TRelayList): boolean {
    return collectUserWriteOutboxUrls(relayList).length > 0
  }

  private relayListUsableForInboxOrdering(relayList: TRelayList): boolean {
    return (
      this.relayListHasWriteUrls(relayList) || collectUserReadInboxUrls(relayList).length > 0
    )
  }

  /** IndexedDB/session first; network only when no write relays are cached (keeps publish off the 20s path). */
  private async peekOrFetchRelayListForPublish(pubkey: string): Promise<TRelayList> {
    try {
      const peeked = await this.peekRelayListFromStorage(pubkey)
      if (this.relayListHasWriteUrls(peeked)) return peeked
    } catch {
      /* fall through to bounded network fetch */
    }
    return this.fetchRelayListWithPublishTimeout(pubkey)
  }

  /** NIP-65 / 10243 / 10432 write outboxes for `event.pubkey`, filtered for publish. */
  private async getUserOutboxRelayUrlsForPublish(event: NEvent): Promise<string[]> {
    try {
      const relayList = await this.peekOrFetchRelayListForPublish(event.pubkey)
      const raw = await collectViewerWriteOutboxUrls(event.pubkey, relayList)
      if (raw.length === 0) return []
      return this.filterPublishingRelays(raw, event)
    } catch {
      return []
    }
  }

  private async retryFailedOutboxPublishesOnce(
    event: NEvent,
    userOutboxUrls: string[],
    relayStatuses: { url: string; success: boolean; error?: string }[]
  ): Promise<void> {
    const norm = (u: string) => normalizeRelayUrlByScheme(u) || u
    const hadSuccess = new Set<string>()
    for (const r of relayStatuses) {
      if (r.success) hadSuccess.add(norm(r.url))
    }
    const failedOutboxes = userOutboxUrls.filter((u) => !hadSuccess.has(norm(u)))
    if (failedOutboxes.length === 0) return

    const anyRelaySucceeded = relayStatuses.some((r) => r.success)
    if (
      anyRelaySucceeded &&
      failedOutboxes.length > 0 &&
      failedOutboxes.every((u) => isLocalNetworkUrl(u))
    ) {
      logger.info(
        '[Publish] Skipping NIP-65 outbox retry: unreachable local write relay(s) only; note already reached at least one relay.',
        { failedOutboxes }
      )
      return
    }

    const statusHint = (url: string): string => {
      const n = norm(url)
      const forUrl = relayStatuses.filter((r) => norm(r.url) === n)
      const failMsgs = forUrl.filter((r) => !r.success).map((r) => r.error).filter(Boolean)
      if (failMsgs.length) return failMsgs[failMsgs.length - 1]!
      return 'No OK from this relay (timeout, connection failed, or still pending when the first wave ended)'
    }

    const okOutboxes = userOutboxUrls.filter((u) => hadSuccess.has(norm(u)))
    const eventHint =
      event.id && /^[0-9a-f]{64}$/i.test(event.id)
        ? `note id ${event.id.slice(0, 12)}… (kind ${event.kind})`
        : `kind ${event.kind} note`

    const failedSummary = failedOutboxes
      .map((u) => `  • ${relayHostForUserLog(u)} — ${statusHint(u)}`)
      .join('\n')
    const okSummary =
      okOutboxes.length > 0
        ? okOutboxes.map((u) => `  • ${relayHostForUserLog(u)}`).join('\n')
        : '  (none)'

    logger.info(
      `[Publish] NIP-65 write relays (your outboxes): ${failedOutboxes.length} did not confirm ${eventHint}. ` +
        `Retrying only those in ${OUTBOX_PUBLISH_RETRY_DELAY_MS / 1000}s (one more try each).\n` +
        `Not OK:\n${failedSummary}\n` +
        `Confirmed on first publish wave:\n${okSummary}`,
      {
        delaySeconds: OUTBOX_PUBLISH_RETRY_DELAY_MS / 1000,
        failed: failedOutboxes.map((url) => ({
          url,
          host: relayHostForUserLog(url),
          reason: statusHint(url)
        })),
        confirmed: okOutboxes.map((url) => ({ url, host: relayHostForUserLog(url) }))
      }
    )

    await new Promise<void>((r) => setTimeout(r, OUTBOX_PUBLISH_RETRY_DELAY_MS))
    await this.publishEvent(failedOutboxes, event, {
      skipOutboxRetry: true,
      publishBatchLabel: 'NIP-65 outbox retry — 2nd attempt (failed write relays only)'
    })
  }

  /**
   * When the user explicitly picked relays, reorder **only within that list** using a bounded
   * {@link fetchRelayListWithPublishTimeout} for the author — not {@link fetchRelayLists} for every
   * reply/mention context (which could stall publish for a long time on slow or failing relays).
   */
  private async prioritizeSpecifiedRelayPickerUrls(
    pickerUrls: string[],
    event: NEvent,
    favoriteRelayUrls: string[] = []
  ): Promise<string[]> {
    const deduped = dedupeNormalizeRelayUrlsOrdered(pickerUrls)
    let relayList: TRelayList
    try {
      relayList = await this.peekOrFetchRelayListForPublish(event.pubkey)
    } catch {
      relayList = this.emptyRelayListForPublish()
    }
    const writeSet = new Set<string>()
    for (const u of relayList.write ?? []) {
      const n = normalizeUrl(u) || u
      if (n) writeSet.add(n)
    }
    for (const u of relayList.httpWrite ?? []) {
      const n = normalizeHttpRelayUrl(u) || u
      if (n) writeSet.add(n)
    }
    const favSet = new Set(
      favoriteRelayUrls.map((f) => normalizeUrl(f) || f).filter((u): u is string => !!u)
    )

    const outbox: string[] = []
    const favRest: string[] = []
    const other: string[] = []
    for (const u of deduped) {
      const n = normalizeAnyRelayUrl(u) || u
      if (!n) continue
      if (writeSet.has(n)) outbox.push(u)
      else if (favSet.has(n)) favRest.push(u)
      else other.push(u)
    }
    const merged = dedupeNormalizeRelayUrlsOrdered([...outbox, ...favRest, ...other])
    return this.filterPublishingRelays(merged, event).slice(0, MAX_PUBLISH_RELAYS)
  }

  /**
   * Cap/filter only — {@link determineTargetRelays} already ordered relays.
   */
  private capPublishRelayUrlsForPublish(
    relayUrls: string[],
    event: NEvent,
    _favoriteRelayUrls: string[] = []
  ): Promise<string[]> {
    const filtered = this.filterPublishingRelays(dedupeNormalizeRelayUrlsOrdered(relayUrls), event)
    return Promise.resolve(filtered.slice(0, MAX_PUBLISH_RELAYS))
  }

  private emptyRelayListForPublish(): TRelayList {
    return {
      write: [],
      read: [],
      originalRelays: [],
      httpRead: [],
      httpWrite: [],
      httpOriginalRelays: []
    }
  }

  /** Bounded wait so NIP-65 fetch cannot block publishing (reactions, replies without relay picker, etc.). */
  private async fetchRelayListWithPublishTimeout(pubkey: string): Promise<TRelayList> {
    const empty = this.emptyRelayListForPublish()
    try {
      const peeked = await this.peekRelayListFromStorage(pubkey)
      if (this.relayListHasWriteUrls(peeked)) return peeked
    } catch {
      /* network */
    }
    try {
      return await Promise.race([
        this.fetchRelayList(pubkey),
        new Promise<TRelayList>((resolve) =>
          setTimeout(() => {
            logger.warn('[DetermineTargetRelays] fetchRelayList timed out; using IndexedDB / default merge', {
              pubkeySlice: pubkey.slice(0, 12)
            })
            void this.peekRelayListFromStorage(pubkey).then(resolve).catch(() => resolve(empty))
          }, PUBLISH_RELAY_LIST_RESOLUTION_TIMEOUT_MS)
        )
      ])
    } catch (err) {
      logger.warn('[DetermineTargetRelays] fetchRelayList failed, using fallback relays', {
        pubkeySlice: pubkey.slice(0, 12),
        error: err instanceof Error ? err.message : String(err)
      })
      try {
        return await this.peekRelayListFromStorage(pubkey)
      } catch {
        return empty
      }
    }
  }

  private async fetchRelayListsWithPublishTimeout(pubkeys: string[]): Promise<TRelayList[]> {
    if (pubkeys.length === 0) return []
    const peeked = await Promise.all(
      pubkeys.map((pk) =>
        this.peekRelayListFromStorage(pk).catch(() => this.emptyRelayListForPublish())
      )
    )
    const missingPubkeys = pubkeys.filter((_, i) => !this.relayListUsableForInboxOrdering(peeked[i]))
    if (missingPubkeys.length === 0) return peeked

    const mergeFetchedIntoPeeked = (fetched: TRelayList[]): TRelayList[] => {
      const byPk = new Map(missingPubkeys.map((pk, i) => [pk, fetched[i]]))
      return pubkeys.map((pk, i) => {
        if (this.relayListUsableForInboxOrdering(peeked[i])) return peeked[i]
        return byPk.get(pk) ?? peeked[i]
      })
    }

    try {
      const fetched = await Promise.race([
        this.fetchRelayLists(missingPubkeys),
        new Promise<TRelayList[]>((resolve) =>
          setTimeout(() => {
            logger.warn('[DetermineTargetRelays] fetchRelayLists timed out; using IndexedDB / default merge', {
              pubkeyCount: missingPubkeys.length
            })
            void Promise.all(missingPubkeys.map((pk) => this.peekRelayListFromStorage(pk)))
              .then(resolve)
              .catch(() => resolve(missingPubkeys.map(() => this.emptyRelayListForPublish())))
          }, PUBLISH_RELAY_LIST_RESOLUTION_TIMEOUT_MS)
        )
      ])
      return mergeFetchedIntoPeeked(fetched)
    } catch (err) {
      logger.warn('[DetermineTargetRelays] fetchRelayLists failed', {
        pubkeyCount: missingPubkeys.length,
        error: err instanceof Error ? err.message : String(err)
      })
      try {
        const fetched = await Promise.all(missingPubkeys.map((pk) => this.peekRelayListFromStorage(pk)))
        return mergeFetchedIntoPeeked(fetched)
      } catch {
        return pubkeys.map(() => this.emptyRelayListForPublish())
      }
    }
  }

  /**
   * Determine which relays to publish an event to.
   * Fallbacks (used when user relay list is empty or fetch fails):
   * - General events (reactions, notes, etc.): FAST_WRITE_RELAY_URLS
   * - Relay list / cache relays / contacts: FAST_READ_RELAY_URLS + PROFILE_RELAY_URLS (added to additional)
   * - Favorite relays: FAST_WRITE_RELAY_URLS (added to additional)
   * - Report events: FAST_WRITE_RELAY_URLS when no user/seen relays
   */
  async determineTargetRelays(
    event: NEvent,
    {
      specifiedRelayUrls,
      additionalRelayUrls,
      favoriteRelayUrls,
      blockedRelayUrls,
      publishTrace
    }: TPublishOptions = {}
  ) {
    this.publishTransientRelayUrls.clear()
    const finish = (relays: string[]): string[] => {
      publishTrace?.step('determineTargetRelays picked', {
        relayCount: relays.length,
        kind: event.kind
      })
      this.stagePublishTransientRelays(relays)
      return relays
    }
    const writeRelayPubOpts = {
      blockedRelays: blockedRelayUrls,
      applySocialKindBlockedFilter: isSocialKindBlockedKind(event.kind)
    }
    const policyRelayList = await this.peekRelayListFromStorage(event.pubkey).catch(() =>
      this.emptyRelayListForPublish()
    )
    const useGlobalRelayDefaults = viewerUsesGlobalRelayDefaults({
      viewerPubkey: event.pubkey,
      favoriteRelayUrls: favoriteRelayUrls ?? [],
      relayList: policyRelayList
    })
    if (event.kind === kinds.RelayList) {
      logger.info('[DetermineTargetRelays] Determining target relays for relay list event', {
        pubkey: event.pubkey,
        hasSpecifiedRelays: !!specifiedRelayUrls?.length,
        specifiedRelayCount: specifiedRelayUrls?.length ?? 0,
        hasAdditionalRelays: !!additionalRelayUrls?.length,
        additionalRelayCount: additionalRelayUrls?.length ?? 0
      })
    }
    // For Report events, always include user's write relays first, then add seen relays if they're write-capable
    if (event.kind === kinds.Report) {
      const relayList = await this.fetchRelayListWithPublishTimeout(event.pubkey)
      const userWriteRelays = await collectViewerWriteOutboxUrls(event.pubkey, relayList)
      
      // Get seen relays where the reported event was found
      const targetEventId = event.tags.find(tagNameEquals('e'))?.[1]
      const seenRelays: string[] = []
      
      if (targetEventId) {
        const allSeenRelays = this.getSeenEventRelayUrls(targetEventId)
        // Filter seen relays: only include those that are in user's write list
        // This ensures we don't try to publish to read-only relays
        const userWriteRelaySet = new Set(userWriteRelays.map((url) => normalizeRelayUrlByScheme(url) || url))
        seenRelays.push(...allSeenRelays.filter(url => {
          const normalized = normalizeRelayUrlByScheme(url) || url
          return userWriteRelaySet.has(normalized)
        }))
      }
      
      if (userWriteRelays.length === 0 && seenRelays.length === 0) {
        if (!useGlobalRelayDefaults) {
          return finish(
            this.filterPublishingRelays(
              buildPrioritizedWriteRelayUrls({
                userWriteRelays: [],
                favoriteRelays: favoriteRelayUrls ?? [],
                maxRelays: MAX_PUBLISH_RELAYS,
                includeGlobalFastWriteReadTails: false,
                ...writeRelayPubOpts
              }),
              event
            )
          )
        }
        return finish(
          this.filterPublishingRelays(
            buildPrioritizedWriteRelayUrls({
              userWriteRelays: [...FAST_WRITE_RELAY_URLS],
              favoriteRelays: favoriteRelayUrls ?? [],
              maxRelays: MAX_PUBLISH_RELAYS,
              includeGlobalFastWriteReadTails: false,
              ...writeRelayPubOpts
            }),
            event
          )
        )
      }
      return finish(
        this.filterPublishingRelays(
          buildPrioritizedWriteRelayUrls({
            userWriteRelays: userWriteRelays,
            authorReadRelays: [],
            favoriteRelays: favoriteRelayUrls ?? [],
            extraRelays: seenRelays,
            maxRelays: MAX_PUBLISH_RELAYS,
            includeGlobalFastWriteReadTails: useGlobalRelayDefaults,
            ...writeRelayPubOpts
          }),
          event
        )
      )
    }

    // Public messages (kind 24) and calendar RSVPs (kind 31925): only author's outboxes + each recipient's
    // inboxes — no user favorites, FAST_WRITE, or FAST_READ padding (see relay-selection getPublicMessageRelays).
    if (
      event.kind === ExtendedKind.PUBLIC_MESSAGE ||
      event.kind === ExtendedKind.CALENDAR_EVENT_RSVP
    ) {
      const recipientPubkeys = Array.from(
        new Set(
          event.tags.filter((t) => t[0] === 'p' && t[1] && isValidPubkey(t[1])).map((t) => t[1] as string)
        )
      ).filter((p) => p !== event.pubkey)
      const recipientListsPromise =
        recipientPubkeys.length > 0
          ? this.fetchRelayListsWithPublishTimeout(recipientPubkeys)
          : Promise.resolve([] as TRelayList[])
      const [authorRelayList, recipientRelayLists] = await Promise.all([
        this.fetchRelayListWithPublishTimeout(event.pubkey),
        recipientListsPromise
      ])
      const authorWrite = await collectViewerWriteOutboxUrls(event.pubkey, authorRelayList)
      const recipientRead = dedupeNormalizeRelayUrlsOrdered(
        recipientRelayLists.flatMap((rl) => collectRecipientInboxUrls(rl))
      )
      let pubRelays = buildPublicMessagePublishRelayUrls(authorWrite, recipientRead, {
        blockedRelays: blockedRelayUrls
      })
      pubRelays = this.filterPublishingRelays(pubRelays, event)
      logger.debug('[DetermineTargetRelays] Public message / calendar RSVP: author outbox + recipient inboxes only', {
        kind: event.kind,
        relayCount: pubRelays.length,
        authorWriteCount: authorWrite.length,
        recipientReadCount: recipientRead.length
      })
      return finish(pubRelays)
    }

    // Payment attestations (9741): attester outbox + attester read inboxes (profile wall REQ) +
    // payment sender inboxes + relays that carried the attested payment.
    if (event.kind === ExtendedKind.PAYMENT_ATTESTATION) {
      const targetEventId = getPaymentAttestationTargetId(event)
      const paymentSenderPubkey = event.tags.find(([name]) => name === 'e')?.[3]?.trim()
      const senderPubkeys =
        paymentSenderPubkey && isValidPubkey(paymentSenderPubkey) ? [paymentSenderPubkey] : []
      const [authorRelayList, senderRelayLists] = await Promise.all([
        this.fetchRelayListWithPublishTimeout(event.pubkey),
        senderPubkeys.length > 0
          ? this.fetchRelayListsWithPublishTimeout(senderPubkeys)
          : Promise.resolve([] as TRelayList[])
      ])
      const authorWrite = await collectViewerWriteOutboxUrls(event.pubkey, authorRelayList)
      const authorRead = collectRecipientInboxUrls(authorRelayList)
      const senderInboxes = dedupeNormalizeRelayUrlsOrdered(
        senderRelayLists.flatMap((rl) => collectRecipientInboxUrls(rl))
      )
      const seenRelays = targetEventId ? this.getSeenEventRelayUrls(targetEventId) : []
      const attestationRelays = this.filterPublishingRelays(
        buildPrioritizedWriteRelayUrls({
          userWriteRelays: authorWrite,
          authorReadRelays: dedupeNormalizeRelayUrlsOrdered([...authorRead, ...senderInboxes]),
          favoriteRelays: favoriteRelayUrls ?? [],
          extraRelays: seenRelays,
          maxRelays: MAX_PUBLISH_RELAYS,
          includeGlobalFastWriteReadTails: useGlobalRelayDefaults,
          ...writeRelayPubOpts
        }),
        event
      )
      logger.debug('[DetermineTargetRelays] Payment attestation: outbox + inboxes + seen relays', {
        kind: event.kind,
        relayCount: attestationRelays.length,
        authorWriteCount: authorWrite.length,
        authorReadCount: authorRead.length,
        senderInboxCount: senderInboxes.length,
        seenRelayCount: seenRelays.length
      })
      return finish(attestationRelays)
    }

    let relays: string[]
    if (specifiedRelayUrls?.length) {
      relays = specifiedRelayUrls
      if (isDocumentRelayKind(event.kind)) {
        relays = dedupeNormalizeRelayUrlsOrdered([...relays, ...DOCUMENT_RELAY_URLS])
      }
    } else {
      // Kind 777 spells: merged write list (kind 10002 outbox + kind 10432 CACHE_RELAYS) + fast write.
      if (event.kind === ExtendedKind.SPELL) {
        let spellRelayList: TRelayList | undefined
        try {
          spellRelayList = await this.fetchRelayListWithPublishTimeout(event.pubkey)
        } catch (err) {
          logger.warn('[DetermineTargetRelays] fetchRelayList failed for spell', {
            pubkey: event.pubkey,
            error: err instanceof Error ? err.message : String(err)
          })
          spellRelayList = this.emptyRelayListForPublish()
        }
        const spellWriteFilteredRaw = await collectViewerWriteOutboxUrls(event.pubkey, spellRelayList)
        const spellWriteFiltered = spellWriteFilteredRaw.filter((url) => !isReadOnlyRelayUrl(url))
        return finish(
          this.filterPublishingRelays(
            buildPrioritizedWriteRelayUrls({
              userWriteRelays:
                spellWriteFiltered.length > 0
                  ? spellWriteFiltered
                  : useGlobalRelayDefaults
                    ? dedupeNormalizeRelayUrlsOrdered(FAST_WRITE_RELAY_URLS)
                    : [],
              favoriteRelays: favoriteRelayUrls ?? [],
              extraRelays: [],
              maxRelays: MAX_PUBLISH_RELAYS,
              includeGlobalFastWriteReadTails:
                spellWriteFiltered.length > 0 ? useGlobalRelayDefaults : false,
              ...writeRelayPubOpts
            }),
            event
          )
        )
      }

      const bootstrapExtras: string[] = [...(additionalRelayUrls ?? [])]
      const authorInboxFromContext: string[] = []
      const shouldMergeContextInboxes =
        !specifiedRelayUrls?.length &&
        ![kinds.Contacts, kinds.Mutelist, ExtendedKind.FOLLOW_SET].includes(event.kind)
      const ctxPubkeys = shouldMergeContextInboxes ? this.collectReplyAndMentionPubkeys(event) : []
      const relayListsPromise =
        ctxPubkeys.length > 0
          ? this.fetchRelayListsWithPublishTimeout(ctxPubkeys)
          : Promise.resolve([] as TRelayList[])
      const relayListPromise = this.fetchRelayListWithPublishTimeout(event.pubkey)
      const [relayLists, relayList] = await Promise.all([relayListsPromise, relayListPromise])
      relayLists.forEach((rl) => {
        authorInboxFromContext.push(...collectRemoteReadInboxUrlsFromRelayList(rl))
      })
      if (
        isAuthorProfileMetadataPublishKind(event.kind) ||
        [
          kinds.RelayList,
          ExtendedKind.CACHE_RELAYS,
          kinds.Contacts,
          ExtendedKind.FOLLOW_SET,
          ExtendedKind.BLOSSOM_SERVER_LIST,
          ExtendedKind.RELAY_REVIEW
        ].includes(event.kind)
      ) {
        bootstrapExtras.push(
          ...(useGlobalRelayDefaults ? PROFILE_RELAY_URLS : profileFetchRelayUrlsWithoutFastReadLayer())
        )
        logger.debug('[DetermineTargetRelays] Profile / list event: adding profile-fetch relays', {
          kind: event.kind,
          profileFetchRelays: useGlobalRelayDefaults
            ? PROFILE_RELAY_URLS
            : profileFetchRelayUrlsWithoutFastReadLayer(),
          additionalRelayCount: bootstrapExtras.length
        })
      } else if (event.kind === ExtendedKind.FAVORITE_RELAYS || event.kind === kinds.Relaysets) {
        // Use fast write relays for favorite-relays and kind 30002 relay-set replaceables to avoid
        // timeouts and auth-only relays dominating the attempt list.
        if (useGlobalRelayDefaults) {
          bootstrapExtras.push(...FAST_WRITE_RELAY_URLS)
        }
        logger.debug('[DetermineTargetRelays] Favorite relays or relay set event, adding FAST_WRITE_RELAY_URLS', {
          kind: event.kind,
          fastWriteRelays: FAST_WRITE_RELAY_URLS,
          additionalRelayCount: bootstrapExtras.length
        })
      } else if (event.kind === ExtendedKind.RSS_FEED_LIST) {
        if (useGlobalRelayDefaults) {
          bootstrapExtras.push(...FAST_WRITE_RELAY_URLS, ...PROFILE_RELAY_URLS)
        } else {
          bootstrapExtras.push(...profileFetchRelayUrlsWithoutFastReadLayer())
        }
      }
      if (isDocumentRelayKind(event.kind)) {
        bootstrapExtras.push(...DOCUMENT_RELAY_URLS)
      }

      if (
        event.kind === kinds.RelayList ||
        event.kind === ExtendedKind.FAVORITE_RELAYS ||
        event.kind === kinds.Relaysets
      ) {
        logger.debug('[DetermineTargetRelays] User relay list resolved for publication', {
          pubkey: event.pubkey,
          kind: event.kind,
          hasRelayList: !!relayList,
          writeRelayCount: relayList?.write?.length ?? 0,
          readRelayCount: relayList?.read?.length ?? 0,
          writeRelays: relayList?.write?.slice(0, MAX_PUBLISH_RELAYS) ?? []
        })
      }
      const userWritesOrdered = await collectViewerWriteOutboxUrls(
        event.pubkey,
        relayList ?? this.emptyRelayListForPublish()
      )
      relays = this.filterPublishingRelays(
        buildPrioritizedWriteRelayUrls({
          userWriteRelays: userWritesOrdered,
          authorReadRelays: authorInboxFromContext,
          favoriteRelays: favoriteRelayUrls ?? [],
          extraRelays: bootstrapExtras,
          maxRelays: MAX_PUBLISH_RELAYS,
          includeGlobalFastWriteReadTails: useGlobalRelayDefaults,
          ...writeRelayPubOpts
        }),
        event
      )
      if (
        event.kind === kinds.RelayList ||
        event.kind === ExtendedKind.FAVORITE_RELAYS ||
        event.kind === kinds.Relaysets
      ) {
        logger.info('[DetermineTargetRelays] Final relay list for event publication', {
          kind: event.kind,
          totalRelayCount: relays.length,
          userWriteRelays: userWritesOrdered.slice(0, MAX_PUBLISH_RELAYS),
          additionalRelays: dedupeNormalizeRelayUrlsOrdered(bootstrapExtras),
          allRelays: relays
        })
      }
    }

    // Fallback for all publishing when no relays (e.g. after cache clear or fetch failure).
    // Use FAST_WRITE_RELAY_URLS so writes always have known-good write relays.
    if (!relays.length) {
      if (useGlobalRelayDefaults) {
        relays = isDocumentRelayKind(event.kind)
          ? dedupeNormalizeRelayUrlsOrdered([...FAST_WRITE_RELAY_URLS, ...DOCUMENT_RELAY_URLS])
          : [...FAST_WRITE_RELAY_URLS]
        logger.info('[DetermineTargetRelays] Using default write relays (no user/extra relays)', {
          count: relays.length
        })
      }
    }

    relays = this.filterPublishingRelays(relays, event)
    relays = this.pinReviewedRelayForRelayReviewPublish(relays, event)

    if (specifiedRelayUrls?.length) {
      const checkedCount = specifiedRelayUrls.length
      /**
       * User already chose relays — do not block publish on {@link fetchRelayLists} for every reply/mention
       * context pubkey (can take tens of seconds on bad networks). Reorder only within the picker set:
       * author's NIP-65 write relays first, then favorites among the selection, then remaining picker order.
       */
      relays = await this.prioritizeSpecifiedRelayPickerUrls(relays, event, favoriteRelayUrls ?? [])
      if (checkedCount > relays.length) {
        logger.info('[Publish] Relay picker: checked count exceeds per-publish cap (stage 1)', {
          checkedInRelayPicker: checkedCount,
          keptAfterOutboxInboxPriorityCap: relays.length,
          maxPublishRelays: MAX_PUBLISH_RELAYS
        })
      }
    } else {
      relays = dedupeNormalizeRelayUrlsOrdered(relays).slice(0, MAX_PUBLISH_RELAYS)
    }
    return finish(relays)
  }

  /** NOTICE handler: session strikes + rate-limit cooldown + debug log for fetch failures. */
  private handleRelayNoticeSession(relayKey: string, noticeMessage: string) {
    relaySessionStrikes.handleNotice(relayKey, noticeMessage)
    if (/failed to fetch events/i.test(noticeMessage)) {
      const n = canonicalRelaySessionKey(relayKey)
      logger.debug('[Relay] NOTICE failed-fetch', {
        url: n ?? relayKey,
        noticeSnippet: noticeMessage.slice(0, 220)
      })
    }
  }

  /** Record a successful publish and its latency for session-based preference when selecting random relays. */
  recordPublishSuccess(url: string, latencyMs: number) {
    const n = canonicalRelaySessionKey(url)
    if (!n) return
    relaySessionStrikes.recordPublishSuccess(url)
    const cur = this.sessionRelayPublishStats.get(n)
    if (cur) {
      cur.successCount += 1
      cur.sumLatencyMs += latencyMs
    } else {
      this.sessionRelayPublishStats.set(n, { successCount: 1, sumLatencyMs: latencyMs })
    }
  }

  /**
   * Relays that returned OK on at least one publish this session — merged ahead of NIP-66 lively list
   * so they stay in the random-relay pool even if not currently in monitoring data.
   */
  getSessionSuccessfulPublishRelayUrlsForRandomPool(): string[] {
    const out: string[] = []
    for (const [url, stats] of this.sessionRelayPublishStats.entries()) {
      if (stats.successCount < 1) continue
      const n = canonicalRelaySessionKey(url)
      if (!n || isReadOnlyRelayUrl(n)) continue
      out.push(n)
    }
    out.sort((a, b) => {
      const sa = this.sessionRelayPublishStats.get(a)!
      const sb = this.sessionRelayPublishStats.get(b)!
      if (sb.successCount !== sa.successCount) return sb.successCount - sa.successCount
      return sa.sumLatencyMs / sa.successCount - sb.sumLatencyMs / sb.successCount
    })
    return out
  }

  /** Session-only debug for Settings: scored publish relays. */
  getSessionRelayDebug(): {
    scoredRelays: { url: string; successCount: number; avgLatencyMs: number }[]
    presetWorking: string[]
    relayStrikes: ReturnType<typeof relaySessionStrikes.getDebugSnapshot>
  } {
    const presetSet = new Set<string>()
    for (const u of [
      ...FAST_WRITE_RELAY_URLS,
      ...FAST_READ_RELAY_URLS,
      ...DEFAULT_FAVORITE_RELAYS,
      ...SEARCHABLE_RELAY_URLS
    ]) {
      const n = normalizeUrl(u) || u
      if (n) presetSet.add(canonicalRelaySessionKey(n))
    }
    const preset = Array.from(presetSet)
    const scoredRelays = Array.from(this.sessionRelayPublishStats.entries()).map(([url, s]) => ({
      url,
      successCount: s.successCount,
      avgLatencyMs: Math.round(s.sumLatencyMs / s.successCount)
    }))
    scoredRelays.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)
    return { scoredRelays, presetWorking: preset, relayStrikes: relaySessionStrikes.getDebugSnapshot() }
  }

  /** Clear session strike / cooldown for one relay (Settings → Session relays). */
  clearSessionRelayStrike(urlOrSessionKey: string): void {
    relaySessionStrikes.clearKey(urlOrSessionKey)
  }

  /** Stage non-personal publish targets (e.g. from {@link determineTargetRelays}) for post-publish socket cleanup. */
  stagePublishTransientRelays(urls: readonly string[]): void {
    for (const raw of urls) {
      if (!raw?.trim()) continue
      if (isRelayUrlInViewerMetadataLists(raw)) continue
      if (isMetadataPolicyProfileRelay(raw)) continue
      this.publishTransientRelayUrls.add(normalizeUrl(raw) || raw.trim())
    }
  }

  /** Close author outbox / random publish sockets; keeps profile index and viewer list relays up. */
  closePublishTransientRelays(extraUrls?: readonly string[]): void {
    const seen = new Set<string>()
    const urls: string[] = []
    const add = (list: readonly string[]) => {
      for (const raw of list) {
        const n = normalizeUrl(raw) || raw.trim()
        if (!n || seen.has(n)) continue
        seen.add(n)
        urls.push(n)
      }
    }
    add([...this.publishTransientRelayUrls])
    if (extraUrls?.length) add(extraUrls)
    this.publishTransientRelayUrls.clear()
    closePublishTransientRelaySockets(urls)
  }

  /**
   * From a list of candidate relay URLs (e.g. public lively), return up to `count` relays,
   * preferring those that have succeeded and been fast this session. Excludes read-only relays.
   */
  getPreferredRelaysForRandom(candidateUrls: string[], count: number): string[] {
    const normalizedCandidates = candidateUrls
      .map((u) => normalizeAnyRelayUrl(u) || u)
      .filter((n) => n && !isReadOnlyRelayUrl(n))
    const unique = Array.from(new Set(normalizedCandidates))
    const preferred: string[] = []
    const rest: string[] = []
    for (const url of unique) {
      const sk = canonicalRelaySessionKey(url)
      const stats = sk ? this.sessionRelayPublishStats.get(sk) : undefined
      if (stats && stats.successCount >= 1) preferred.push(url)
      else rest.push(url)
    }
    preferred.sort((a, b) => {
      const sa = this.sessionRelayPublishStats.get(canonicalRelaySessionKey(a))
      const sb = this.sessionRelayPublishStats.get(canonicalRelaySessionKey(b))
      if (!sa || !sb) return 0
      if (sb.successCount !== sa.successCount) return sb.successCount - sa.successCount
      const avgA = sa.sumLatencyMs / sa.successCount
      const avgB = sb.sumLatencyMs / sb.successCount
      return avgA - avgB
    })
    const result: string[] = []
    let pi = 0
    let ri = 0
    // Preserve candidate order (e.g. NIP-66 write-proven relays first); avoid full shuffle so monitoring hints apply.
    const orderedRest = rest.slice()
    while (result.length < count && (pi < preferred.length || ri < orderedRest.length)) {
      if (pi < preferred.length) {
        result.push(preferred[pi++])
      } else if (ri < orderedRest.length) {
        result.push(orderedRest[ri++])
      }
    }
    return result.slice(0, count)
  }

  async publishEvent(relayUrls: string[], event: NEvent, publishExtras?: TPublishEventExtras) {
    const trace: PublishTrace | undefined = publishExtras?.publishTrace
    const skipOutboxRetry = publishExtras?.skipOutboxRetry === true
    trace?.step('publishEvent begin', { pickerRelays: relayUrls.length, skipOutboxRetry })
    let userOutboxUrls: string[] = []
    let mergedRelayUrls = relayUrls
    if (!skipOutboxRetry) {
      userOutboxUrls = await this.getUserOutboxRelayUrlsForPublish(event)
      trace?.step('outbox relays loaded', { count: userOutboxUrls.length })
      mergedRelayUrls =
        userOutboxUrls.length > 0
          ? dedupeNormalizeRelayUrlsOrdered([...userOutboxUrls, ...relayUrls])
          : relayUrls
    }

    let filtered = filterPublishingRelayUrls(mergedRelayUrls, event.kind)
    filtered = Array.from(new Set(filtered))
    const countAfterFiltersBeforeCap = filtered.length
    filtered = await this.capPublishRelayUrlsForPublish(
      filtered,
      event,
      publishExtras?.favoriteRelayUrls ?? []
    )

    const uniqueRelayUrls = filtered
    const publishTargetUrls = relaySessionStrikes.filterPublishUrls(uniqueRelayUrls)
    trace?.step('publishEvent targets ready', {
      afterOutboxMerge: mergedRelayUrls.length,
      afterFilters: countAfterFiltersBeforeCap,
      contacted: publishTargetUrls.length
    })
    /** Single-relay publish: force a fresh socket so explorer / one-relay flows still try hard. */
    if (publishTargetUrls.length === 1) {
      try {
        this.pool.close(publishTargetUrls)
      } catch {
        /* ignore */
      }
    }
    /** Single-relay: full NIP-42 ACK budget; multi-relay: avoid waiting on the slowest peer for “all settled”. */
    const publishAckBudgetCapMs =
      publishTargetUrls.length <= 1
        ? RELAY_NIP42_PUBLISH_ACK_TIMEOUT_MS
        : Math.min(RELAY_NIP42_PUBLISH_ACK_TIMEOUT_MS, MULTI_RELAY_PUBLISH_ACK_CAP_MS)

    if (relayUrls.length !== publishTargetUrls.length || mergedRelayUrls.length !== publishTargetUrls.length) {
      logger.info('[PublishEvent] Publish target relays (UI selection vs actually contacted)', {
        eventId: event.id?.substring(0, 12),
        kind: event.kind,
        maxPublishRelays: MAX_PUBLISH_RELAYS,
        fromPickerOrDetermineCount: relayUrls.length,
        afterMergeWithYourOutboxes: mergedRelayUrls.length,
        afterReadonlySocialFilter: countAfterFiltersBeforeCap,
        afterStrikeFilter: publishTargetUrls.length,
        finalContactedRelayCount: publishTargetUrls.length,
        finalRelays: publishTargetUrls,
        explain:
          'Your NIP-65 write relays are prepended, then the list is de-duplicated, filtered (read-only / social-kind blocks), and capped at maxPublishRelays in outbox→inbox→favorite→fast-write priority. Unchecked relays in the picker are never contacted; checked relays beyond the cap or filtered out are also skipped.'
      })
    }

    logger.debug('[PublishEvent] Starting publishEvent', {
      eventId: event.id?.substring(0, 8),
      kind: event.kind,
      relayCount: publishTargetUrls.length,
      relayUrlsPassedInCount: relayUrls.length
    })
    if (publishTargetUrls.length === 0) {
      const emptyBatch = new RelayPublishOpBatch('ClientService.publishEvent', event.id, [])
      emptyBatch.logBegin()
      emptyBatch.logEnd('no_targets')
      return Promise.resolve({
        success: false,
        relayStatuses: [],
        successCount: 0,
        totalCount: 0
      })
    }
    if (
      event.kind === kinds.RelayList ||
      event.kind === ExtendedKind.HTTP_RELAY_LIST ||
      event.kind === ExtendedKind.FAVORITE_RELAYS ||
      event.kind === kinds.Relaysets
    ) {
      logger.info('[PublishEvent] Publishing event to relays', {
        eventId: event.id?.substring(0, 8),
        kind: event.kind,
        totalRelayCount: publishTargetUrls.length,
        allRelays: publishTargetUrls
      })
    } else {
      logger.debug('[PublishEvent] Unique relays', { count: publishTargetUrls.length, relays: publishTargetUrls.slice(0, 5) })
    }

    const publishBatchSource = publishExtras?.publishBatchLabel
      ? `publish — ${publishExtras.publishBatchLabel}`
      : 'ClientService.publishEvent'
    if (publishExtras?.publishBatchLabel) {
      const idBit =
        event.id && /^[0-9a-f]{64}$/i.test(event.id) ? `${event.id.slice(0, 12)}…` : '(unsigned or no id)'
      logger.info(`[Publish] ${publishExtras.publishBatchLabel}`, {
        readable: `Kind ${event.kind} note ${idBit} → ${publishTargetUrls.length} relay(s): ${publishTargetUrls.map(relayHostForUserLog).join(', ')}`,
        targets: publishTargetUrls.map((url) => ({ where: relayHostForUserLog(url), url }))
      })
    }

    const relayStatuses: { url: string; success: boolean; error?: string }[] = []
    const publishOpBatch = new RelayPublishOpBatch(publishBatchSource, event.id, publishTargetUrls)
    publishOpBatch.logBegin()

    const httpIndexBasesForPublish = await this.resolveViewerHttpIndexBasesForPublish(publishTargetUrls)

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const client = this
    return new Promise<{ success: boolean; relayStatuses: typeof relayStatuses; successCount: number; totalCount: number }>((resolve) => {
      let successCount = 0
      let finishedCount = 0
      const errors: { url: string; error: any }[] = []
      let publishOpBatchFlushed = false
      const flushPublishOpBatch = (status: string) => {
        if (publishOpBatchFlushed) return
        publishOpBatchFlushed = true
        publishTargetUrls.forEach((url, idx) => {
          const rs = [...relayStatuses].reverse().find((r) => r.url === url)
          publishOpBatch.record(idx, url, rs?.success === true, rs?.error)
        })
        publishOpBatch.logEnd(status)
        queueMicrotask(() => {
          closePublishTransientRelaySockets(publishTargetUrls)
          client.closePublishTransientRelays()
        })
      }

      /**
       * Publish intentionally does **not** use {@link QueryService.acquireGlobalRelayConnectionSlot}: feed
       * REQ setup can hold every slot for hung `ensureRelay` handshakes, which left `finishedCount === 0`
       * until the global timeout (user saw “Request timed out” on every relay). Publish is already bounded
       * by {@link MAX_PUBLISH_RELAYS}. Budget still scales with relay count as a rough upper bound.
       */
      const slotCap = Math.max(1, MAX_CONCURRENT_RELAY_CONNECTIONS)
      const publishWaves = Math.max(1, Math.ceil(publishTargetUrls.length / slotCap))
      const perWaveBudgetMs =
        RELAY_POOL_CONNECTION_TIMEOUT_MS + publishAckBudgetCapMs + 10_000
      const publishGlobalDeadlineMs = Math.min(
        600_000,
        Math.max(
          RELAY_POOL_CONNECTION_TIMEOUT_MS + publishAckBudgetCapMs + 30_000,
          publishWaves * perWaveBudgetMs + 25_000
        )
      )
      logger.debug('[PublishEvent] Setting up global timeout', {
        publishGlobalDeadlineMs,
        publishWaves,
        relayCount: publishTargetUrls.length,
        slotCap
      })
      trace?.step('publishEvent waiting for relays', {
        relayCount: publishTargetUrls.length,
        publishGlobalDeadlineMs,
        earlyGraceMs: EARLY_PUBLISH_SUCCESS_GRACE_MS
      })
      let hasResolved = false
      let earlyGraceTimer: ReturnType<typeof setTimeout> | null = null

      const finishUnfinishedRelaysWithTimeout = (errorMsg: string) => {
        publishTargetUrls.forEach((url) => {
          const alreadyFinished = relayStatuses.some((rs) => rs.url === url)
          if (!alreadyFinished) {
            logger.warn('[PublishEvent] Marking relay as timed out', { url })
            relayStatuses.push({ url, success: false, error: errorMsg })
            relaySessionStrikes.recordPublishFailure(url)
            finishedCount++
          }
        })
      }
      /**
       * Live timelines listen for {@link emitNewEvent} on the first relay ACK — not after N/3 successes.
       * Waiting for a third of many relays meant the profile/home feed stayed stale until a subscription
       * picked the note up from the network (minutes later if few relays accepted the publish).
       */
      let newEventLiveFanoutEmitted = false
      const maybeEmitNewEventForLiveFeeds = () => {
        if (newEventLiveFanoutEmitted || successCount < 1) return
        newEventLiveFanoutEmitted = true
        client.emitNewEvent(event)
      }

      const globalTimeout = setTimeout(() => {
        if (hasResolved) {
          logger.debug('[PublishEvent] Already resolved, ignoring timeout')
          return
        }

        logger.warn('[PublishEvent] Global timeout reached!', {
          finishedCount,
          totalRelays: publishTargetUrls.length,
          successCount,
          relayStatusesCount: relayStatuses.length
        })

        finishUnfinishedRelaysWithTimeout('Timeout: Operation took too long')

        // Ensure we resolve even if not all relays finished
        if (!hasResolved) {
          if (earlyGraceTimer != null) {
            clearTimeout(earlyGraceTimer)
            earlyGraceTimer = null
          }
          hasResolved = true
          trace?.step('publishEvent resolve', {
            reason: 'global_timeout',
            successCount,
            finishedCount,
            totalRelays: publishTargetUrls.length
          })
          maybeEmitNewEventForLiveFeeds()
          logger.debug('[PublishEvent] Resolving due to timeout', {
            success: successCount >= publishTargetUrls.length / 3,
            successCount,
            totalCount: publishTargetUrls.length,
            relayStatuses: relayStatuses.length
          })
          flushPublishOpBatch('global_timeout')
          resolve({
            success: successCount >= publishTargetUrls.length / 3,
            relayStatuses,
            successCount,
            totalCount: publishTargetUrls.length
          })
        }
      }, publishGlobalDeadlineMs)

      logger.debug('[PublishEvent] Starting Promise.allSettled for all relays')
      const relayPublishAllSettled = Promise.allSettled(
        publishTargetUrls.map(async (url, index) => {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const that = this
          const startMs = Date.now()
          const relayLabel = (() => {
            try {
              return new URL(url).host
            } catch {
              return url.slice(0, 48)
            }
          })()
          logger.debug(`[PublishEvent] Starting relay ${index + 1}/${publishTargetUrls.length}`, { url })
          const isLocal = isLocalNetworkUrl(url)
          /** Match pool handshake budget; a shorter outer race used to abort `ensureRelay` at 8s while the pool allowed 20s — slow TLS never won. */
          const connectionTimeout = isLocal
            ? 5_000
            : publishTargetUrls.length >= 4
              ? Math.min(RELAY_POOL_CONNECTION_TIMEOUT_MS, PUBLISH_MULTI_RELAY_CONNECTION_CAP_MS)
              : RELAY_POOL_CONNECTION_TIMEOUT_MS
          /** ACK wait: pool sets {@link RELAY_NIP42_PUBLISH_ACK_TIMEOUT_MS}; outer race uses {@link publishAckBudgetCapMs} for multi-relay. */
          const publishAckBudgetMs = isLocal ? 5_000 : publishAckBudgetCapMs
          const httpPublishBudgetMs = isLocal ? 5_000 : 8_000
          /** Hard cap so a hung `ensureRelay` / NIP-42 auth chain cannot block {@link publishEvent} forever. */
          const relayHardBudgetMs = connectionTimeout + publishAckBudgetMs + 4_000
          trace?.step(`relay ${index + 1}/${publishTargetUrls.length} begin`, {
            host: relayLabel,
            isLocal,
            connectionTimeoutMs: connectionTimeout,
            publishAckBudgetMs,
            relayHardBudgetMs
          })

          try {
            await Promise.race([
              (async () => {
                try {
            if (urlMatchesConfiguredHttpIndexRelay(url, httpIndexBasesForPublish)) {
              const base = normalizeHttpRelayUrl(url) || url
              logger.debug(`[PublishEvent] Publishing to kind 10243 HTTP index relay`, { url: base })
              await Promise.race([
                publishEventToHttpRelay(base, event),
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () => reject(new Error(`HTTP publish timeout after ${httpPublishBudgetMs}ms`)),
                    httpPublishBudgetMs
                  )
                )
              ])
              that.recordPublishSuccess(url, Date.now() - startMs)
              that.queryService.trackEventSeenOnByUrl(event.id, base)
              successCount++
              relayStatuses.push({ url, success: true })
              return
            }

            let relay: Relay
            for (let wsAttempt = 0; wsAttempt < 2; wsAttempt++) {
              try {
                logger.debug(`[PublishEvent] Ensuring relay connection`, {
                  url,
                  isLocal,
                  connectionTimeout,
                  wsAttempt
                })

                const ensureOpts = { connectionTimeout, purpose: 'write' as const }
                const connectionPromise = isLocal
                  ? Promise.race([
                      this.pool.ensureRelay(url, ensureOpts),
                      new Promise<Relay>((_, reject) =>
                        setTimeout(() => reject(new Error('Local relay connection timeout')), connectionTimeout)
                      )
                    ])
                  : Promise.race([
                      this.pool.ensureRelay(url, ensureOpts),
                      new Promise<Relay>((_, reject) =>
                        setTimeout(() => reject(new Error('Remote relay connection timeout')), connectionTimeout)
                      )
                    ])

                relay = await connectionPromise
                logger.debug(`[PublishEvent] Relay connected`, { url })
                const relayKeyPub = normalizeUrl(url) || url
                patchRelayNoticeForFetchFailures(relay as unknown as AbstractRelay, relayKeyPub, (u, m) =>
                  that.handleRelayNoticeSession(u, m)
                )

                applyRelayNip42AckTimeout(relay as unknown as AbstractRelay)

                logger.debug(`[PublishEvent] Publishing to relay`, { url })

                const publishPromise = relay
                  .publish(event)
                  .then(() => {
                    logger.debug(`[PublishEvent] Successfully published to relay`, { url })
                    that.recordPublishSuccess(url, Date.now() - startMs)
                    this.trackEventSeenOn(event.id, relay)
                    successCount++
                    relayStatuses.push({ url, success: true })
                  })
                  .catch((error) => {
                    logger.warn(`[PublishEvent] Publish failed, checking if auth required`, {
                      url,
                      error: error.message
                    })
                    if (
                      error instanceof Error &&
                      isRelayAuthRequiredErrorMessage(error.message) &&
                      that.canSignerAuthenticateRelay()
                    ) {
                      logger.debug(`[PublishEvent] Auth required, attempting authentication`, { url })
                      applyRelayNip42AckTimeout(relay as unknown as AbstractRelay)
                      const signAuth = (authEvt: EventTemplate) =>
                        queueRelayAuthSign(() => that.signer!.signEvent(authEvt))
                      const preparePublishRelay = async (): Promise<Relay> => {
                        const r = await that.pool.ensureRelay(url, ensureOpts)
                        const relayKeyPub = normalizeUrl(url) || url
                        patchRelayNoticeForFetchFailures(r as unknown as AbstractRelay, relayKeyPub, (u, m) =>
                          that.handleRelayNoticeSession(u, m)
                        )
                        applyRelayNip42AckTimeout(r as unknown as AbstractRelay)
                        return r
                      }
                      const publishAfterAuth = async (): Promise<void> => {
                        await authenticateNip42Relay(relay as unknown as AbstractRelay, signAuth)
                        let liveRelay = await preparePublishRelay()
                        for (let authPubAttempt = 0; authPubAttempt < 2; authPubAttempt++) {
                          try {
                            await liveRelay.publish(event)
                            return
                          } catch (retryErr) {
                            if (!isRelayConnectionClosedError(retryErr) || authPubAttempt === 1) {
                              throw retryErr
                            }
                            logger.debug('[PublishEvent] Publish after auth on closed socket; reconnecting', {
                              url
                            })
                            try {
                              that.pool.close([url])
                            } catch {
                              /* ignore */
                            }
                            await new Promise((r) => setTimeout(r, 350))
                            liveRelay = await preparePublishRelay()
                            await authenticateNip42Relay(liveRelay as unknown as AbstractRelay, signAuth)
                          }
                        }
                      }
                      return publishAfterAuth()
                        .then(() => {
                          logger.debug(`[PublishEvent] Successfully published after auth`, { url })
                          that.recordPublishSuccess(url, Date.now() - startMs)
                          this.trackEventSeenOn(event.id, relay)
                          successCount++
                          relayStatuses.push({ url, success: true })
                        })
                        .catch((authError) => {
                          const authMsg =
                            authError instanceof Error ? authError.message : String(authError)
                          logger.error(`[PublishEvent] Auth or publish failed`, { url, error: authMsg })
                          errors.push({ url, error: authError })
                          relayStatuses.push({ url, success: false, error: authMsg })
                          relaySessionStrikes.recordPublishFailure(url, authMsg)
                          if (
                            authError instanceof RelayAuthAccessDeniedError ||
                            isRelayAuthAccessDeniedMessage(authMsg)
                          ) {
                            relaySessionStrikes.recordReadFailure(url, 'connection')
                          }
                        })
                    } else {
                      logger.error(`[PublishEvent] Publish failed`, { url, error: error.message })
                      errors.push({ url, error })
                      relayStatuses.push({ url, success: false, error: error.message })
                      relaySessionStrikes.recordPublishFailure(url, error.message)
                    }
                  })

                await Promise.race([
                  publishPromise,
                  new Promise<void>((_, reject) =>
                    setTimeout(
                      () => reject(new Error(`Publish timeout after ${publishAckBudgetMs}ms`)),
                      publishAckBudgetMs
                    )
                  )
                ])
                break
              } catch (wsErr) {
                const msg = wsErr instanceof Error ? wsErr.message : String(wsErr)
                const localConnDead =
                  isLocal &&
                  /Local relay connection timeout|connection timed out/i.test(msg)
                const retriable =
                  !localConnDead &&
                  wsAttempt === 0 &&
                  /Remote relay connection timeout|Local relay connection timeout|Publish timeout after|publish timed out|websocket closed|connection failed|relay connection closed|SendingOnClosedConnection/i.test(
                    msg
                  )
                if (!retriable) {
                  throw wsErr
                }
                logger.info('[PublishEvent] Closing pooled relay and retrying publish once', { url, msg })
                try {
                  this.pool.close([url])
                } catch {
                  /* ignore */
                }
                await new Promise((r) => setTimeout(r, 400))
              }
            }
                } catch (error) {
            const softHttpDown =
              urlMatchesConfiguredHttpIndexRelay(url, httpIndexBasesForPublish) &&
              (error instanceof IndexRelayTransportError || isIndexRelayTransportFailure(error))
            if (softHttpDown) {
              logger.debug('[PublishEvent] HTTP index relay unreachable', {
                url,
                error: error instanceof Error ? error.message : String(error)
              })
            } else {
              logger.error(`[PublishEvent] Connection or setup failed`, {
                url,
                error: error instanceof Error ? error.message : String(error)
              })
            }
            errors.push({ url, error })
            relayStatuses.push({
              url,
              success: false,
              error: error instanceof Error ? error.message : 'Connection failed'
            })
            const errMsg = error instanceof Error ? error.message : 'Connection failed'
            if (classifyRelayNotice(errMsg) === 'rate_limit' || /\b429\b/.test(errMsg)) {
              relaySessionStrikes.applyConnectionRateLimitCooldownForUrl(url)
            } else {
              relaySessionStrikes.recordPublishFailure(url, errMsg)
            }
                }
              })(),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () =>
                    reject(new Error(`Relay operation timed out after ${relayHardBudgetMs}ms`)),
                  relayHardBudgetMs
                )
              )
            ])
          } catch (error) {
            const alreadyRecorded = relayStatuses.some((rs) => rs.url === url)
            if (!alreadyRecorded) {
              const errMsg = error instanceof Error ? error.message : 'Connection failed'
              logger.warn('[PublishEvent] Relay hard timeout', { url, error: errMsg })
              errors.push({ url, error })
              relayStatuses.push({ url, success: false, error: errMsg })
              relaySessionStrikes.recordPublishFailure(url, errMsg)
            }
          } finally {
            const currentFinished = ++finishedCount
            const rs = relayStatuses.find((r) => r.url === url)
            trace?.step(`relay ${index + 1}/${publishTargetUrls.length} end`, {
              host: relayLabel,
              ok: rs?.success === true,
              ms: Date.now() - startMs,
              error: rs?.error
            })
            logger.debug(`[PublishEvent] Relay finished`, { 
              url, 
              finishedCount: currentFinished, 
              totalRelays: publishTargetUrls.length,
              successCount 
            })
            
            maybeEmitNewEventForLiveFeeds()
            if (currentFinished >= publishTargetUrls.length && !hasResolved) {
              if (earlyGraceTimer != null) {
                clearTimeout(earlyGraceTimer)
                earlyGraceTimer = null
              }
              hasResolved = true
              trace?.step('publishEvent resolve', {
                reason: 'all_relays_finished',
                successCount,
                finishedCount: currentFinished,
                totalRelays: publishTargetUrls.length
              })
              logger.debug('[PublishEvent] All relays finished, resolving', {
                success: successCount >= publishTargetUrls.length / 3,
                successCount,
                totalCount: publishTargetUrls.length,
                relayStatusesCount: relayStatuses.length
              })
              clearTimeout(globalTimeout)
              flushPublishOpBatch('all_relays_finished')
              resolve({
                success: successCount >= publishTargetUrls.length / 3,
                relayStatuses,
                successCount,
                totalCount: publishTargetUrls.length
              })
            } else if (!hasResolved && successCount >= 1 && earlyGraceTimer == null) {
              earlyGraceTimer = setTimeout(() => {
                earlyGraceTimer = null
                if (hasResolved) return
                hasResolved = true
                clearTimeout(globalTimeout)
                flushPublishOpBatch('early_any_success_grace')
                trace?.step('publishEvent resolve', {
                  reason: 'early_any_success_grace',
                  successCount,
                  finishedRelays: currentFinished,
                  graceMs: EARLY_PUBLISH_SUCCESS_GRACE_MS
                })
                logger.debug('[PublishEvent] Resolving after first success grace', {
                  success: successCount >= publishTargetUrls.length / 3,
                  successCount,
                  totalCount: publishTargetUrls.length,
                  finishedRelays: currentFinished,
                  graceMs: EARLY_PUBLISH_SUCCESS_GRACE_MS
                })
                resolve({
                  success: successCount >= publishTargetUrls.length / 3,
                  relayStatuses,
                  successCount,
                  totalCount: publishTargetUrls.length
                })
              }, EARLY_PUBLISH_SUCCESS_GRACE_MS)
            }
          }
        })
      )

      if (!skipOutboxRetry && userOutboxUrls.length > 0) {
        void relayPublishAllSettled.then(() => {
          void client
            .retryFailedOutboxPublishesOnce(event, userOutboxUrls, relayStatuses)
            .catch((err) =>
              logger.warn(
                '[Publish] NIP-65 outbox retry (2nd attempt) failed — check the network or relay logs above',
                {
                  error: err instanceof Error ? err.message : String(err),
                  eventKind: event.kind,
                  eventId: event.id && /^[0-9a-f]{64}$/i.test(event.id) ? `${event.id.slice(0, 16)}…` : event.id
                }
              )
            )
        })
      }
    })
  }

  emitNewEvent(event: NEvent) {
    this.dispatchEvent(new CustomEvent('newEvent', { detail: event }))
  }

  async signHttpAuth(url: string, method: string, description = '') {
    if (!this.signer) {
      throw new Error('Please login first to sign the event')
    }
    const event = await this.signer?.signEvent({
      content: description,
      kind: kinds.HTTPAuth,
      created_at: dayjs().unix(),
      tags: [
        ['u', url],
        ['method', method]
      ]
    })
    return 'Nostr ' + btoa(JSON.stringify(event))
  }

  /** =========== Timeline =========== */

  private scheduleTimelinePersist(timelineKey: string): void {
    const prev = this.timelinePersistTimers.get(timelineKey)
    if (prev) clearTimeout(prev)
    const t = setTimeout(() => {
      this.timelinePersistTimers.delete(timelineKey)
      void this.flushTimelinePersist(timelineKey)
    }, 1600)
    this.timelinePersistTimers.set(timelineKey, t)
  }

  private async flushTimelinePersist(timelineKey: string): Promise<void> {
    const tl = this.timelines[timelineKey]
    if (!tl || Array.isArray(tl) || !tl.refs?.length) return
    try {
      await indexedDb.putTimelinePersistedState(timelineKey, {
        refs: [...tl.refs],
        filter: { ...(tl.filter as object) } as Record<string, unknown>,
        urls: [...tl.urls]
      })
    } catch (e) {
      logger.warn('[ClientService] Timeline persist failed', { timelineKey: timelineKey.slice(0, 12), e })
    }
  }

  private generateTimelineKey(urls: string[], filter: Filter) {
    const paramsStr = JSON.stringify({
      urls: canonicalRelayUrls(urls),
      filter: canonicalFeedFilter(filter)
    })
    const encoder = new TextEncoder()
    const data = encoder.encode(paramsStr)
    const hashBuffer = sha256(data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private generateMultipleTimelinesKey(subRequests: { urls: string[]; filter: Filter }[]) {
    const keys = subRequests.map(({ urls, filter }) => this.generateTimelineKey(urls, filter))
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(keys.sort()))
    const hashBuffer = sha256(data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Load the last persisted timeline rows from IndexedDB for each shard (same keys as live subscribe),
   * without opening relay subscriptions. Used for stale-while-revalidate first paint on feeds.
   */
  async getTimelineDiskSnapshotEvents(
    subRequests: { urls: string[]; filter: TSubRequestFilter }[]
  ): Promise<NEvent[]> {
    if (!subRequests.length) return []
    const mergedTimelineLimit = Math.max(
      500,
      ...subRequests.map(({ filter }) =>
        typeof filter.limit === 'number' && filter.limit > 0 ? filter.limit : 0
      )
    )
    const merged: NEvent[] = []
    const eventIdSet = new Set<string>()
    const shardReads = subRequests.map(async ({ urls, filter }) => {
      let relays = Array.from(new Set(urls))
      if (!navigator.onLine) {
        relays = relays.filter((url) => isLocalNetworkUrl(url))
      }
      if (relayFiltersUseCapitalLetterTagKeys(filter as Filter)) {
        relays = relayUrlsStripExtendedTagReqBlocked(relays)
        if (relays.length === 0 && navigator.onLine) {
          relays = relayUrlsStripExtendedTagReqBlocked([...publicReadRelayFallbackUrls()])
        }
      }
      const key = this.generateTimelineKey(relays, filter as Filter)
      try {
        const st = await indexedDb.getTimelinePersistedState(key)
        if (!st?.refs?.length) return
        const hexIds = st.refs.map((r) => r[0])
        const list = await indexedDb.getArchivedEventsByIds(hexIds)
        for (const ev of list) {
          if (shouldDropEventOnIngest(ev)) continue
          if (eventIdSet.has(ev.id)) continue
          eventIdSet.add(ev.id)
          merged.push(ev)
        }
        for (const refId of hexIds) {
          if (eventIdSet.has(refId)) continue
          const sess = this.eventService.peekSessionCachedEvent(refId)
          if (sess && !shouldDropEventOnIngest(sess)) {
            eventIdSet.add(refId)
            merged.push(sess)
          }
        }
      } catch (err) {
        logger.debug('[ClientService] Timeline disk snapshot shard read failed', { err })
      }
    })
    await Promise.all(shardReads)
    merged.sort((a, b) => b.created_at - a.created_at)
    return merged.slice(0, mergedTimelineLimit)
  }

  async getLocalFeedEvents(
    subRequests: { urls: string[]; filter: TSubRequestFilter }[],
    options?: {
      maxRowsScanned?: number
      maxMatches?: number
      /**
       * When true, only load rows persisted for this feed’s timeline shard(s) — no global session scan or
       * archive/publication sweeps. Used for single-relay explore so kindless `{ limit }` does not match every
       * cached note while the UI is scoped to one relay.
       */
      strictRelayShardSourcesOnly?: boolean
    }
  ): Promise<NEvent[]> {
    if (!subRequests.length) return []
    const filters = subRequests.map(({ filter }) => filter as Filter)
    const maxMatches = Math.min(
      Math.max(
        options?.maxMatches ??
          Math.max(
            500,
            ...subRequests.map(({ filter }) =>
              typeof filter.limit === 'number' && filter.limit > 0 ? filter.limit : 0
            )
          ),
        1
      ),
      3000
    )
    const maxRowsScanned = Math.min(Math.max(options?.maxRowsScanned ?? 18_000, 200), 50_000)
    const byId = new Map<string, NEvent>()
    const add = (rows: NEvent[]) => {
      for (const event of rows) {
        if (shouldDropEventOnIngest(event)) continue
        if (!byId.has(event.id)) byId.set(event.id, event)
      }
    }

    if (options?.strictRelayShardSourcesOnly) {
      const timelineRows = await this.getTimelineDiskSnapshotEvents(subRequests).catch(() => [] as NEvent[])
      add(timelineRows)
      return [...byId.values()]
        .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
        .slice(0, maxMatches)
    }

    add(this.eventService.getSessionEventsMatchingFilters(filters, maxMatches))

    const [timelineRows, paymentSuperchatRows] = await Promise.all([
      this.getTimelineDiskSnapshotEvents(subRequests).catch(() => [] as NEvent[]),
      indexedDb
        .getPaymentSuperchatEventsMatchingFilters(filters, maxMatches)
        .catch(() => [] as NEvent[])
    ])
    add(timelineRows)
    add(paymentSuperchatRows)

    const [archiveRows, publicationRows] = await Promise.all([
      indexedDb
        .scanEventArchiveByFilters(filters, { maxRowsScanned, maxMatches })
        .catch(() => [] as NEvent[]),
      indexedDb
        .scanPublicationEventsByFilters(filters, { maxRowsScanned: Math.min(maxRowsScanned, 16_000), maxMatches })
        .catch(() => [] as NEvent[])
    ])
    add(archiveRows)
    add(publicationRows)

    return [...byId.values()]
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
      .slice(0, maxMatches)
  }

  async subscribeTimeline(
    subRequests: { urls: string[]; filter: TSubRequestFilter }[],
    {
      onEvents,
      onNew,
      onClose
    }: {
      onEvents: (events: NEvent[], eosed: boolean) => void
      onNew: (evt: NEvent) => void
      onClose?: (url: string, reason: string) => void
    },
    {
      startLogin,
      needSort = true,
      firstRelayResultGraceMs = FIRST_RELAY_RESULT_GRACE_MS,
      onRelaySubscribeWaveComplete,
      relayAuthoritativeTimeline = false,
      connectionSlotPriority = false
    }: {
      startLogin?: () => void
      needSort?: boolean
      /** Passed to each shard’s {@link ClientService._subscribeTimeline}: 2s after first event completes initial load if EOSE is slower. */
      firstRelayResultGraceMs?: number
      /** After every timeline shard’s REQ wave has ended (per-relay EOSE / close / timeout), merged rows in shard order. */
      onRelaySubscribeWaveComplete?: (rows: RelayOpTerminalRow[]) => void,
      /**
       * Single-relay “what this relay stores” feeds: skip IndexedDB + session snapshot hydrate before the live REQ,
       * skip persisting this shard, and do not widen an empty shard to {@link FAST_READ_RELAY_URLS}.
       */
      relayAuthoritativeTimeline?: boolean
      /** Jump the global {@link QueryService.acquireGlobalRelayConnectionSlot} queue (profile timelines). */
      connectionSlotPriority?: boolean
    } = {}
  ) {
    const timelineBatchId = `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
    const timelineT0 = performance.now()
    logger.debug('[relay-req] timeline_batch_start', {
      timelineBatchId,
      subRequestCount: subRequests.length,
      relayCounts: subRequests.map((r) => r.urls.length)
    })

    const nip50SearchTerm = (() => {
      for (const s of subRequests) {
        const q =
          typeof (s.filter as Filter).search === 'string' ? (s.filter as Filter).search!.trim() : ''
        if (q.length > 0) return q
      }
      return ''
    })()
    if (nip50SearchTerm) {
      const relaysForLog = Array.from(
        new Set(subRequests.flatMap((s) => s.urls.map((u) => normalizeUrl(u) || u).filter(Boolean)))
      )
      logger.info('[QueryService] search_req_begin', {
        timelineBatchId,
        source: 'subscribeTimeline',
        search: nip50SearchTerm,
        relays: relaysForLog,
        shardCount: subRequests.length,
        relayCountsPerShard: subRequests.map((r) => r.urls.length),
        filters: subRequests.map((s) => compactFilterForRelayLog(s.filter as Filter))
      })
    }

    const newEventIdSet = new Set<string>()
    const requestCount = subRequests.length
    let eventIdSet = new Set<string>()
    let events: NEvent[] = []
    let eosedCount = 0
    /** One merged buffer — slice using the largest child `limit` so a later child with a smaller limit cannot drop other relays’ events. */
    const mergedTimelineLimit = Math.max(
      500,
      ...subRequests.map(({ filter }) =>
        typeof filter.limit === 'number' && filter.limit > 0 ? filter.limit : 0
      )
    )

    let firstPaintLogged = false
    const deliverTimelineToConsumer = (snapshot: NEvent[], allEosed: boolean) => {
      if (!firstPaintLogged && snapshot.length > 0) {
        firstPaintLogged = true
        logger.debug('[relay-req] first_paint', {
          timelineBatchId,
          phase: 'data_to_feed',
          rowCount: snapshot.length,
          allEosed,
          ms: Math.round(performance.now() - timelineT0)
        })
      }
      onEvents(snapshot, allEosed)
    }

    let outerFlushQueued = false
    let outerFlushBump = 0
    const scheduleOuterFlush = (immediate = false) => {
      const run = () => {
        outerFlushQueued = false
        const snapshot = events.length ? [...events] : []
        const allEosed = eosedCount >= requestCount
        deliverTimelineToConsumer(snapshot, allEosed)
      }
      if (immediate || eosedCount >= requestCount || events.length <= 1) {
        outerFlushBump++
        outerFlushQueued = false
        run()
        return
      }
      if (!outerFlushQueued) {
        outerFlushQueued = true
        const b = outerFlushBump
        queueMicrotask(() => {
          if (b !== outerFlushBump) return
          run()
        })
      }
    }

    let subscribeWaveShardsRemaining = subRequests.length
    const subscribeWaveAcc: RelayOpTerminalRow[] = []
    const onShardSubscribeBatchEnd = (rows: RelayOpTerminalRow[]) => {
      subscribeWaveAcc.push(...rows)
      subscribeWaveShardsRemaining--
      if (subscribeWaveShardsRemaining === 0) {
        if (nip50SearchTerm) {
          logSearchTimelineNip50ReqEnd({
            timelineBatchId,
            search: nip50SearchTerm,
            subRequests,
            eventsSnapshot: events.length ? [...events] : [],
            terminals: subscribeWaveAcc.slice(),
            getSeenForEvent: (id) => this.getSeenEventRelayUrls(id)
          })
        }
        onRelaySubscribeWaveComplete?.(subscribeWaveAcc.slice())
      }
    }

    const subs = await mapPoolWithConcurrency(
      subRequests,
      TIMELINE_SHARD_SUBSCRIBE_CONCURRENCY,
      ({ urls, filter }, shardIndex) =>
        this._subscribeTimeline(
          urls,
          filter,
          {
            onEvents: (_events, _eosed) => {
              if (_eosed) {
                eosedCount++
              }

              _events.forEach((evt) => {
                if (eventIdSet.has(evt.id)) return
                eventIdSet.add(evt.id)
                events.push(evt)
              })
              events = needSort
                ? events.sort((a, b) => b.created_at - a.created_at).slice(0, mergedTimelineLimit)
                : events.slice(0, mergedTimelineLimit)
              eventIdSet = new Set(events.map((evt) => evt.id))

              scheduleOuterFlush(!!_eosed)
            },
            onNew: (evt) => {
              if (newEventIdSet.has(evt.id)) return
              newEventIdSet.add(evt.id)
              onNew(evt)
            },
            onClose
          },
          {
            startLogin,
            needSort,
            firstRelayResultGraceMs,
            relayAuthoritativeTimeline,
            connectionSlotPriority,
            relayReqLog: {
              groupId: `${timelineBatchId}:shard${shardIndex}`,
              onBatchEnd: onShardSubscribeBatchEnd
            }
          }
        )
    )

    const key = this.generateMultipleTimelinesKey(subRequests)
    this.timelines[key] = subs.map((sub) => sub.timelineKey)

    return {
      closer: () => {
        onEvents = () => {}
        onNew = () => {}
        subs.forEach((sub) => {
          sub.closer()
        })
      },
      timelineKey: key
    }
  }

  /**
   * Append another {@link subscribeTimeline} composite’s leaf keys onto `primaryCompositeKey` so
   * {@link loadMoreTimeline} fans out to both waves. Removes `secondaryCompositeKey` from the map after merge.
   * Returns the leaf keys that were appended (for removal when the delta wave closes).
   */
  appendTimelinesToComposite(primaryCompositeKey: string, secondaryCompositeKey: string): string[] {
    const primary = this.timelines[primaryCompositeKey]
    const secondary = this.timelines[secondaryCompositeKey]
    if (!Array.isArray(primary) || !Array.isArray(secondary)) return []
    const added = secondary.slice()
    this.timelines[primaryCompositeKey] = [...primary, ...added]
    delete this.timelines[secondaryCompositeKey]
    return added
  }

  /** Undo part of {@link appendTimelinesToComposite} when a delta subscription is torn down. */
  removeTimelineLeavesFromComposite(compositeKey: string, leafKeys: string[]): void {
    if (leafKeys.length === 0) return
    const t = this.timelines[compositeKey]
    if (!Array.isArray(t)) return
    const drop = new Set(leafKeys)
    this.timelines[compositeKey] = t.filter((k) => !drop.has(k))
  }

  /**
   * Check if a timeline has more events available (either cached or from network)
   */
  hasMoreTimelineEvents(key: string, until: number): boolean {
    const timeline = this.timelines[key]
    if (!timeline) return false

    if (Array.isArray(timeline)) {
      // For multiple timelines, check if any has more events
      return timeline.some((subKey) => {
        const subTimeline = this.timelines[subKey]
        if (!subTimeline || Array.isArray(subTimeline)) return false
        const { refs } = subTimeline
        // Check if there are refs with created_at <= until that we haven't loaded
        return refs.some(([, createdAt]) => createdAt <= until)
      })
    }

    const { refs } = timeline
    // Check if there are refs with created_at <= until that we haven't loaded
    return refs.some(([, createdAt]) => createdAt <= until)
  }

  async loadMoreTimeline(key: string, until: number, limit: number) {
    const timeline = this.timelines[key]
    if (!timeline) return []

    if (!Array.isArray(timeline)) {
      return this._loadMoreTimeline(key, until, limit)
    }
    const timelines = await Promise.all(
      timeline.map((key) => this._loadMoreTimeline(key, until, limit))
    )

    const eventIdSet = new Set<string>()
    const events: NEvent[] = []
    timelines.forEach((timeline) => {
      timeline.forEach((evt) => {
        if (eventIdSet.has(evt.id)) return
        eventIdSet.add(evt.id)
        events.push(evt)
      })
    })
    return events.sort((a, b) => b.created_at - a.created_at).slice(0, limit)
  }

  subscribe(
    urls: string[],
    filter: Filter | Filter[],
    {
      onevent,
      oneose,
      onclose,
      startLogin,
      onAllClose,
      connectionSlotPriority,
      singleRelayExplicit
    }: {
      onevent?: (evt: NEvent) => void
      oneose?: (eosed: boolean) => void
      onclose?: (url: string, reason: string) => void
      startLogin?: () => void
      onAllClose?: (reasons: string[]) => void
      /** Jump the global connection queue (single-relay authoritative timelines). */
      connectionSlotPriority?: boolean
      /** Authoritative single-relay timeline: keep the target relay through sanitizers and strikes. */
      singleRelayExplicit?: boolean
    },
    relayReqLog?: { groupId?: string; onBatchEnd?: (rows: RelayOpTerminalRow[]) => void }
  ) {
    const originalDedupedRelays = Array.from(new Set(urls))
    const preserveExplicitSingleRelay =
      originalDedupedRelays.length === 1 &&
      (singleRelayExplicit === true || isSingleRelayExplicitBrowseActive())
    const revokeFetchScope = preserveExplicitSingleRelay ? enterSingleRelayExplicitFetchScope() : () => {}
    const revokeOperationScope = grantRelayConnectionOperationScope(originalDedupedRelays)
    const httpKeys = new Set(
      httpIndexBasesForRelayQuery(originalDedupedRelays, this.viewerHttpIndexRelayBases).map((u) =>
        canonicalRelaySessionKey(u)
      )
    )
    let relays = sanitizeRelayUrlsForFetch(
      originalDedupedRelays.filter((url) => !httpKeys.has(canonicalRelaySessionKey(url))),
      undefined,
      { preserveExplicitSingleRelay }
    )
    if (navigator.onLine) {
      relays = stripLocalNetworkRelaysForWssReq(relays)
    } else {
      // While offline, silently drop every non-local relay so nothing is added to groupedRequests.
      relays = relays.filter((url) => isLocalNetworkUrl(url))
    }
    const filters = sanitizeSubscribeFiltersBeforeReq(filter)
    if (filters.length === 0) {
      logger.debug('[relay-req] batch_skip', {
        reason: 'no_filters_after_sanitize',
        filterSummary: summarizeFiltersForRelayLog(Array.isArray(filter) ? filter : [filter])
      })
      queueMicrotask(() => {
        oneose?.(true)
        relayReqLog?.onBatchEnd?.([])
      })
      revokeOperationScope()
      revokeFetchScope()
      return {
        close: () => {}
      }
    }

    relays = withDocumentRelayUrlsForFilters(relays, filters, {
      singleRelayFeed: originalDedupedRelays.length === 1
    })

    const stripSocialBlockedRelays =
      SOCIAL_KIND_BLOCKED_RELAY_URLS.length > 0 &&
      filters.some((f) => relayFilterIncludesSocialKindBlockedKind(f))
    if (stripSocialBlockedRelays) {
      const socialKindBlockedSet = new Set(SOCIAL_KIND_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
      const stripped = relays.filter((url) => !socialKindBlockedSet.has(normalizeUrl(url) || url))
      relays = relaysAfterSocialKindBlockedStrip(originalDedupedRelays, stripped)
    }
    if (relayFiltersUseCapitalLetterTagKeys(filters)) {
      relays = relayUrlsStripExtendedTagReqBlocked(relays)
      if (relays.length === 0) {
        relays = relayUrlsStripExtendedTagReqBlocked([...publicReadRelayFallbackUrls()])
      }
    }
    relays = Array.from(new Set(relays))

    const wsRelayCountBeforeStrikes = relays.length
    if (wsRelayCountBeforeStrikes > 1) {
      relays = relaySessionStrikes.filterReadHttpUrls(relays, this.viewerHttpIndexRelayBases)
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this
    const _knownIds = new Set<string>()

    // Group by relay (same as pool.subscribeMap) so one REQ per relay with all filters
    const grouped = new Map<string, Filter[]>()
    for (const url of relays) {
      const key = normalizeUrl(url) || url
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(...filters)
    }
    const searchableSet = new Set([
      ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u),
      ...getViewerNostrLandAggrSearchRelayUrls().map((u) => normalizeUrl(u) || u),
      ...nip66Service.getSearchableRelayUrls().map((u) => normalizeUrl(u) || u)
    ])
    const groupedRequests = Array.from(grouped.entries()).map(([url, f]) => {
      const relaySupportsSearch = searchableSet.has(url) || nip66Service.isRelaySearchable(url)
      const filtersForRelay = f.map((one) => filterForRelay(one, relaySupportsSearch))
      return { url, filters: filtersForRelay }
    })

    const hasNip50Search = filters.some(
      (f) => typeof f.search === 'string' && f.search.trim().length > 0
    )
    /**
     * Same rule as {@link QueryService.subscribe}: never `pool.close` a lone relay when the REQ carries NIP-50
     * `search` — overlapping one-shots (e.g. Strict Mode) otherwise reset the socket before EOSE.
     * Also skip for explicit single-relay browse feeds: close+reconnect on every timeline resubscribe triggers 429s.
     */
    if (groupedRequests.length === 1 && !hasNip50Search && !preserveExplicitSingleRelay) {
      try {
        this.pool.close([groupedRequests[0]!.url])
      } catch {
        /* ignore */
      }
    }

    // Social-kind queries drop SOCIAL_KIND_BLOCKED_RELAY_URLS; if every URL was removed, no subs run and
    // oneose would never fire — timelines stay loading forever (e.g. favorites feed).
    if (groupedRequests.length === 0) {
      logger.debug('[relay-req] batch_skip', {
        reason: 'no_relays_after_filters',
        filterSummary: summarizeFiltersForRelayLog(filters)
      })
      queueMicrotask(() => {
        oneose?.(true)
        relayReqLog?.onBatchEnd?.([])
      })
      revokeOperationScope()
      revokeFetchScope()
      return {
        close: () => {}
      }
    }

    const reqGroupId =
      relayReqLog?.groupId ??
      `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const opBatch = new RelaySubscribeOpBatch(reqGroupId, groupedRequests, {
      onBatchEnd: relayReqLog?.onBatchEnd
    })
    opBatch.logBegin()
    const reqT0 = performance.now()
    let firstRelayResponseLogged = false
    /** When the first `first_response` was `eose` (no row yet), log once when the first EVENT arrives. */
    let awaitingFirstEventAfterEoseFirstResponse = false
    const logFirstRelayResponse = (kind: 'event' | 'eose', relayUrl: string) => {
      if (firstRelayResponseLogged) return
      firstRelayResponseLogged = true
      if (kind === 'eose') awaitingFirstEventAfterEoseFirstResponse = true
      logger.debug('[relay-req] first_response', {
        reqGroupId,
        kind,
        relayUrl,
        ms: Math.round(performance.now() - reqT0)
      })
    }
    const logFirstEventIfFirstResponseWasEmpty = (evt: NEvent, relayKey: string) => {
      if (!awaitingFirstEventAfterEoseFirstResponse) return
      awaitingFirstEventAfterEoseFirstResponse = false
      logger.debug('[relay-req] first_event', {
        reqGroupId,
        relayUrl: relayKey,
        eventId: evt.id,
        eventKind: evt.kind,
        ms: Math.round(performance.now() - reqT0),
        note: 'first_relay_response_was_eose_not_event'
      })
    }

    const eosesReceived: boolean[] = []
    const closesReceived: (string | undefined)[] = []
    const handleEose = (i: number) => {
      if (eosesReceived[i]) return
      eosesReceived[i] = true
      opBatch.setTerminal(i, 'eose')
      logFirstRelayResponse('eose', groupedRequests[i]!.url)
      relaySessionStrikes.recordReadSuccess(groupedRequests[i]!.url)
      if (eosesReceived.filter(Boolean).length === groupedRequests.length) {
        oneose?.(true)
      }
    }
    const handleClose = (i: number, reason: string) => {
      if (closesReceived[i] !== undefined) return
      handleEose(i)
      closesReceived[i] = reason
      opBatch.setTerminal(i, 'closed', reason)
      const { url } = groupedRequests[i]!
      onclose?.(url, reason)
      if (closesReceived.every((r) => r !== undefined)) {
        onAllClose?.(closesReceived as string[])
      }
    }

    const localAlreadyHaveEvent = (id: string) => {
      const have = _knownIds.has(id)
      if (have) return true
      _knownIds.add(id)
      return false
    }

    const forwardOnevent = onevent
      ? (evt: NEvent) => {
          if (shouldDropEventOnIngest(evt)) return
          onevent(evt)
        }
      : undefined

    const subs: { relayKey: string; close: () => void }[] = []
    /** Ignore a follow-up `closed by caller` while NIP-42 auth + resubscribe is in flight (parent `close()` must not finalize the batch early). */
    const nip42ResubscribePending = new Set<number>()
    const nip42HasAuthedOnce = new Set<number>()
    const slotPriority = connectionSlotPriority === true
    const allOpened = Promise.all(
      groupedRequests.map(async ({ url, filters: relayFilters }, i) => {
        await that.queryService.acquireGlobalRelayConnectionSlot(
          slotPriority ? { priority: true } : undefined
        )
        try {
          const relayKey = normalizeUrl(url) || url
          await that.queryService.acquireSubSlot(relayKey)
          let relay: AbstractRelay
          try {
            relay = await that.pool.ensureRelay(url, { connectionTimeout: RELAY_POOL_CONNECTION_TIMEOUT_MS })
            patchRelayNoticeForFetchFailures(relay, relayKey, (u, m) => that.handleRelayNoticeSession(u, m))
          } catch (err) {
            relaySessionStrikes.recordConnectionFailure(
              url,
              (err as Error)?.message ?? String(err),
              'connection'
            )
            that.queryService.releaseSubSlot(relayKey)
            handleClose(i, (err as Error)?.message ?? String(err))
            return
          }

          let slotReleased = false
          const releaseOnce = () => {
            if (!slotReleased) {
              slotReleased = true
              that.queryService.releaseSubSlot(relayKey)
            }
          }

          const sub = relay.subscribe(relayFilters, {
            receivedEvent: (_relay, id) => that.trackEventSeenOn(id, _relay),
            onevent: (evt: NEvent) => {
              logFirstEventIfFirstResponseWasEmpty(evt, relayKey)
              logFirstRelayResponse('event', relayKey)
              forwardOnevent?.(evt)
            },
            oneose: () => handleEose(i),
            onclose: (reason: string) => {
              if (isRelaySubscriptionClosedByCaller(reason) && nip42ResubscribePending.has(i)) {
                return
              }
              releaseOnce()
              if (
                isRelayAuthRequiredCloseReason(reason) &&
                that.canSignerAuthenticateRelay() &&
                !nip42HasAuthedOnce.has(i)
              ) {
                nip42ResubscribePending.add(i)
                applyRelayNip42AckTimeout(relay)
                authenticateNip42Relay(relay, async (authEvt: EventTemplate) => {
                  const evt = await queueRelayAuthSign(() => that.signer!.signEvent(authEvt))
                  if (!evt) throw new Error('sign event failed')
                  return evt as VerifiedEvent
                })
                  .then(async () => {
                    nip42HasAuthedOnce.add(i)
                    await that.queryService.acquireGlobalRelayConnectionSlot(
                      slotPriority ? { priority: true } : undefined
                    )
                    try {
                      await that.queryService.acquireSubSlot(relayKey)
                      // After AUTH the socket may be closed or the relay dropped from the pool;
                      // resubscribe on a fresh connection from ensureRelay (fixes SendingOnClosedConnection).
                      let liveRelay: AbstractRelay
                      try {
                        liveRelay = await that.pool.ensureRelay(url, {
                          connectionTimeout: RELAY_POOL_CONNECTION_TIMEOUT_MS
                        })
                        patchRelayNoticeForFetchFailures(liveRelay, relayKey, (u, m) =>
                          that.handleRelayNoticeSession(u, m)
                        )
                      } catch (err) {
                        relaySessionStrikes.recordConnectionFailure(
                          url,
                          (err as Error)?.message ?? String(err),
                          'connection'
                        )
                        nip42ResubscribePending.delete(i)
                        that.queryService.releaseSubSlot(relayKey)
                        handleClose(i, (err as Error)?.message ?? String(err))
                        return
                      }
                      let slotReleased2 = false
                      const releaseSlot2 = () => {
                        if (!slotReleased2) {
                          slotReleased2 = true
                          that.queryService.releaseSubSlot(relayKey)
                        }
                      }
                      try {
                        const sub2 = liveRelay.subscribe(relayFilters, {
                          receivedEvent: (_relay, id) => that.trackEventSeenOn(id, _relay),
                          onevent: (evt: NEvent) => {
                            logFirstEventIfFirstResponseWasEmpty(evt, relayKey)
                            logFirstRelayResponse('event', relayKey)
                            forwardOnevent?.(evt)
                          },
                          oneose: () => handleEose(i),
                          onclose: (reason2: string) => {
                            releaseSlot2()
                            handleClose(i, reason2)
                          },
                          alreadyHaveEvent: localAlreadyHaveEvent,
                          eoseTimeout: SUBSCRIBE_RELAY_EOSE_TIMEOUT_MS
                        })
                        logger.debug('[relay-req] req_sent', {
                          reqGroupId,
                          url: relayKey,
                          ms: Math.round(performance.now() - reqT0),
                          note: 'after_auth'
                        })
                        subs.push({
                          relayKey,
                          close: () => {
                            releaseSlot2()
                            sub2.close()
                          }
                        })
                        nip42ResubscribePending.delete(i)
                      } catch (err) {
                        nip42ResubscribePending.delete(i)
                        releaseSlot2()
                        handleClose(i, (err as Error)?.message ?? String(err))
                      }
                    } finally {
                      that.queryService.releaseGlobalRelayConnectionSlot()
                    }
                  })
                  .catch((err) => {
                    nip42ResubscribePending.delete(i)
                    const authMsg = err instanceof Error ? err.message : String(err)
                    if (
                      err instanceof RelayAuthAccessDeniedError ||
                      isRelayAuthAccessDeniedMessage(authMsg)
                    ) {
                      nip42HasAuthedOnce.add(i)
                      relaySessionStrikes.recordReadFailure(url, 'connection')
                    }
                    handleClose(i, authMsg || reason)
                  })
                return
              }
              if (isRelayAuthRequiredCloseReason(reason)) {
                startLogin?.()
              }
              handleClose(i, reason)
            },
            alreadyHaveEvent: localAlreadyHaveEvent,
            eoseTimeout: SUBSCRIBE_RELAY_EOSE_TIMEOUT_MS
          })
          logger.debug('[relay-req] req_sent', {
            reqGroupId,
            url: relayKey,
            ms: Math.round(performance.now() - reqT0)
          })
          subs.push({
            relayKey,
            close: () => {
              releaseOnce()
              sub.close()
            }
          })
        } finally {
          that.queryService.releaseGlobalRelayConnectionSlot()
        }
      })
    )

    const handleNewEventFromInternal = (data: Event) => {
      const customEvent = data as CustomEvent<NEvent>
      const evt = customEvent.detail
      if (!matchFilters(filters, evt)) return
      if (shouldDropEventOnIngest(evt)) return

      const id = evt.id
      const have = _knownIds.has(id)
      if (have) return

      _knownIds.add(id)
      forwardOnevent?.(evt)
    }

    this.addEventListener('newEvent', handleNewEventFromInternal)

    return {
      close: () => {
        this.removeEventListener('newEvent', handleNewEventFromInternal)
        void allOpened.then(() => {
          subs.forEach(({ close: subClose }) => subClose())
          setTimeout(() => {
            opBatch.finalize('closed', 'subscription_closed')
            revokeOperationScope()
            revokeFetchScope()
            if (!preserveExplicitSingleRelay) {
              closeRelayPoolSocketsIfIdle(relays)
            }
          }, 0)
        })
      }
    }
  }

  private async _subscribeTimeline(
    urls: string[],
    filter: TSubRequestFilter, // filter with limit,
    {
      onEvents,
      onNew,
      onClose
    }: {
      onEvents: (events: NEvent[], eosed: boolean) => void
      onNew: (evt: NEvent) => void
      onClose?: (url: string, reason: string) => void
    },
    {
      startLogin,
      needSort = true,
      /**
       * After the **first** stored event arrives from any relay, wait this long then treat the initial
       * backlog as complete (same as aggregate EOSE): enables pagination + live `onNew` without waiting for
       * every slow/hung relay. Real EOSE still clears the timer and completes earlier if all relays finish first.
       */
      firstRelayResultGraceMs = FIRST_RELAY_RESULT_GRACE_MS,
      relayReqLog,
      relayAuthoritativeTimeline = false,
      connectionSlotPriority
    }: {
      startLogin?: () => void
      needSort?: boolean
      firstRelayResultGraceMs?: number
      /** Correlate {@link ClientService.subscribe} logs with a timeline shard */
      relayReqLog?: { groupId: string; onBatchEnd?: (rows: RelayOpTerminalRow[]) => void },
      /** See {@link ClientService.subscribeTimeline} third-arg `relayAuthoritativeTimeline`. */
      relayAuthoritativeTimeline?: boolean
      /** See {@link ClientService.subscribeTimeline} third-arg `connectionSlotPriority`. */
      connectionSlotPriority?: boolean
    } = {}
  ) {
    const originalDedupedRelays = Array.from(new Set(urls))
    let wsRelayUrls = originalDedupedRelays
    if (navigator.onLine) {
      // HTTPS index relays are polled via HTTP API — never WebSocket REQ (see httpTimelinePollBases below).
      wsRelayUrls = stripLocalNetworkRelaysForWssReq(originalDedupedRelays)
    } else {
      // While offline, strip non-local relays before any further processing so the
      // capital-letter-tag fallback below cannot re-introduce internet relays.
      wsRelayUrls = originalDedupedRelays.filter((url) => isLocalNetworkUrl(url))
    }
    if (relayFiltersUseCapitalLetterTagKeys(filter as Filter)) {
      wsRelayUrls = relayUrlsStripExtendedTagReqBlocked(wsRelayUrls)
      if (wsRelayUrls.length === 0 && navigator.onLine && !relayAuthoritativeTimeline) {
        wsRelayUrls = relayUrlsStripExtendedTagReqBlocked([...publicReadRelayFallbackUrls()])
      }
    }
    const timelineUrls = originalDedupedRelays
    const key = this.generateTimelineKey(timelineUrls, filter)
    let timeline = this.timelines[key]

    if (!timeline || Array.isArray(timeline)) {
      this.timelines[key] = {
        refs: [],
        filter,
        urls: timelineUrls,
        ...(relayAuthoritativeTimeline ? { disablePersist: true as const } : {})
      }
      timeline = this.timelines[key]
    } else {
      // New subscription wave for this leaf key: the prior closer does not delete `timelines[key]`.
      // Reusing stale `refs` made `handleTimelineEose` merge against an old head timestamp — e.g. when the
      // relay sent a full `limit` batch whose newest row was still older than that head, `newRefs` became
      // empty and `tl.refs` was replaced with [] or failed to adopt fresh rows (feed looked permanently stale).
      timeline.filter = filter
      timeline.urls = timelineUrls
      timeline.refs = []
      if (relayAuthoritativeTimeline) {
        timeline.disablePersist = true
      } else {
        delete timeline.disablePersist
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this
    const maybePersistTimeline = () => {
      if (!relayAuthoritativeTimeline) that.scheduleTimelinePersist(key)
    }
    let events: NEvent[] = []
    /** `null` until initial backlog is considered complete; then wall-clock unix at completion (for straggler vs live). */
    let eosedAt: number | null = null
    let eventIds = new Set<string>()

    const httpTimelinePollBases = filterViewerBlockedRelaysForFetch(
      httpIndexBasesForRelayQuery(originalDedupedRelays, this.viewerHttpIndexRelayBases)
    ).filter((u) => relayAuthoritativeTimeline || !relaySessionStrikes.isReadHttpSkipped(u))
    let httpPollIntervalId: ReturnType<typeof setInterval> | null = null
    let httpPollCursorUnix = 0
    const clearHttpTimelinePoll = () => {
      if (httpPollIntervalId != null) {
        clearInterval(httpPollIntervalId)
        httpPollIntervalId = null
      }
    }

    let firstResultGraceTimer: ReturnType<typeof setTimeout> | null = null
    const clearFirstResultGraceTimer = () => {
      if (firstResultGraceTimer != null) {
        clearTimeout(firstResultGraceTimer)
        firstResultGraceTimer = null
      }
    }
    const armFirstResultGraceAfterFirstEvent = () => {
      if (eosedAt != null || firstResultGraceTimer != null) return
      if (events.length === 0) return
      if (firstRelayResultGraceMs <= 0) return
      firstResultGraceTimer = setTimeout(() => {
        firstResultGraceTimer = null
        if (eosedAt == null) {
          handleTimelineEose(true)
        }
      }, firstRelayResultGraceMs)
    }

    /**
     * Stream matching events to the UI immediately. Initial completion is either aggregate `oneose` from all
     * relays, or {@link firstRelayResultGraceMs} after the first event (whichever comes first).
     * While still before EOSE, coalesce bursts with a short timeout (not rAF) so feeds still advance when the
     * tab is in the background — browsers throttle rAF heavily there, which looked like a frozen timeline.
     */
    let streamFlushDelayId: ReturnType<typeof setTimeout> | null = null
    const clearStreamFlushDelay = () => {
      if (streamFlushDelayId != null) {
        clearTimeout(streamFlushDelayId)
        streamFlushDelayId = null
      }
    }
    const flushStreamingSnapshot = () => {
      if (eosedAt) return
      const emit = () => {
        streamFlushDelayId = null
        if (eosedAt) return
        if (needSort) {
          const sorted = [...events].sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit)
          onEvents(sorted, false)
        } else {
          onEvents([...events], false)
        }
      }
      if (events.length <= 1) {
        clearStreamFlushDelay()
        emit()
        return
      }
      if (streamFlushDelayId == null) {
        streamFlushDelayId = setTimeout(emit, TIMELINE_STREAMING_COALESCE_MS)
      }
    }

    try {
      if (!relayAuthoritativeTimeline) {
        const st = await indexedDb.getTimelinePersistedState(key)
        if (st?.refs?.length) {
          const hexIds = st.refs.map((r) => r[0])
          const list = await indexedDb.getArchivedEventsByIds(hexIds)
          for (const ev of list) {
            if (shouldDropEventOnIngest(ev)) continue
            if (eventIds.has(ev.id)) continue
            eventIds.add(ev.id)
            events.push(ev)
          }
          for (const refId of hexIds) {
            if (eventIds.has(refId)) continue
            const sess = that.eventService.peekSessionCachedEvent(refId)
            if (sess && !shouldDropEventOnIngest(sess)) {
              eventIds.add(refId)
              events.push(sess)
            }
          }
          flushStreamingSnapshot()
        }
      }
    } catch (err) {
      logger.warn('[ClientService] Timeline disk hydrate failed', err)
    }

    const applySubscribedTimelineEvent = (evt: NEvent) => {
      that.addEventToCache(evt)
      if (!eosedAt) {
        if (eventIds.has(evt.id)) return
        eventIds.add(evt.id)
        events.push(evt)
        flushStreamingSnapshot()
        armFirstResultGraceAfterFirstEvent()
        return
      }

      if (eventIds.has(evt.id)) return

      const wallClockAtEose = eosedAt
      const isBacklogStraggler = evt.created_at + TIMELINE_STRAGGLER_MAX_AGE_SEC < wallClockAtEose

      if (isBacklogStraggler) {
        eventIds.add(evt.id)
        events.push(evt)
        if (needSort) {
          events = events.sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit)
        }
        eventIds = new Set(events.map((e) => e.id))
        onEvents([...events], false)

        const timeline = that.timelines[key]
        if (timeline && !Array.isArray(timeline)) {
          timeline.refs = events
            .map((e) => [e.id, e.created_at] as TTimelineRef)
            .sort((a, b) => b[1] - a[1])
          maybePersistTimeline()
        }
        return
      }

      eventIds.add(evt.id)
      onNew(evt)

      const timeline = that.timelines[key]
      if (!timeline || Array.isArray(timeline)) {
        return
      }

      if (timeline.refs.length === 0) {
        timeline.refs = events.map((e) => [e.id, e.created_at] as TTimelineRef).sort((a, b) => b[1] - a[1])
        maybePersistTimeline()
        return
      }

      let idx = 0
      for (const ref of timeline.refs) {
        if (evt.created_at > ref[1] || (evt.created_at === ref[1] && evt.id < ref[0])) {
          break
        }
        if (evt.created_at === ref[1] && evt.id === ref[0]) {
          return
        }
        idx++
      }
      // idx === refs.length → strictly older than tail; splice appends (previous early-return dropped these).
      timeline.refs.splice(idx, 0, [evt.id, evt.created_at])
      maybePersistTimeline()
    }

    const runHttpTimelinePollQuery = async (pollFilter: Filter) => {
      if (httpTimelinePollBases.length === 0) return
      try {
        await this.query(
          httpTimelinePollBases,
          pollFilter,
          (evt: NEvent) => {
            applySubscribedTimelineEvent(evt)
          },
          {
            firstRelayResultGraceMs: false,
            globalTimeout: 25_000,
            eoseTimeout: 2500
          }
        )
      } catch (err) {
        logger.debug('[ClientService] HTTP index timeline poll failed', err)
      }
    }

    const armHttpTimelinePollingAfterInitial = () => {
      clearHttpTimelinePoll()
      if (httpTimelinePollBases.length === 0) return
      const newestCreated = events.length > 0 ? Math.max(...events.map((e) => e.created_at)) : 0
      httpPollCursorUnix = Math.max(eosedAt ?? 0, newestCreated)
      httpPollIntervalId = setInterval(() => {
        const base = { ...(filter as Filter) } as Filter & { until?: number }
        delete base.until
        const since = Math.max(0, httpPollCursorUnix - HTTP_TIMELINE_POLL_SINCE_OVERLAP_SEC)
        const pollLimit = Math.min(Math.max(filter.limit ?? 200, 1), 500)
        const pollFilter: Filter = { ...base, since, limit: pollLimit }
        void runHttpTimelinePollQuery(pollFilter).then(() => {
          httpPollCursorUnix = dayjs().unix()
        })
      }, HTTP_TIMELINE_POLL_INTERVAL_MS)
    }

    const handleTimelineEose = (eosed: boolean) => {
      if (!eosed) return
      if (eosedAt != null) return

      clearFirstResultGraceTimer()
      clearStreamFlushDelay()

      eosedAt = dayjs().unix()

      if (!needSort) {
        armHttpTimelinePollingAfterInitial()
        return onEvents([...events], true)
      }

      events = events.sort((a, b) => b.created_at - a.created_at).slice(0, filter.limit)
      eventIds = new Set(events.map((e) => e.id))

      const tl = that.timelines[key]
      if (!tl || Array.isArray(tl)) {
        that.timelines[key] = {
          refs: events.map((evt) => [evt.id, evt.created_at]),
          filter,
          urls: timelineUrls,
          ...(relayAuthoritativeTimeline ? { disablePersist: true as const } : {})
        }
      } else if (tl.refs.length === 0) {
        tl.refs = events.map((evt) => [evt.id, evt.created_at] as TTimelineRef)
      } else {
        const firstRefCreatedAt = tl.refs[0]![1]
        const newRefs = events
          .filter((evt) => evt.created_at > firstRefCreatedAt)
          .map((evt) => [evt.id, evt.created_at] as TTimelineRef)
        if (events.length >= filter.limit) {
          tl.refs = newRefs
        } else {
          tl.refs = newRefs.concat(tl.refs)
        }
      }
      armHttpTimelinePollingAfterInitial()
      onEvents([...events], true)
      maybePersistTimeline()
    }

    // HTTP index relays are handled via httpTimelinePollBases above — never pass them to the WS subscribe path.
    const httpPollKeys = new Set(httpTimelinePollBases.map((u) => canonicalRelaySessionKey(u)))
    const wsRelays = wsRelayUrls.filter((u) => !httpPollKeys.has(canonicalRelaySessionKey(u)))

    // When there are HTTP relays but NO WS relays, subscribe([]) would fire oneose + onBatchEnd
    // immediately (via microtask) — before the HTTP initial poll returns any events. That causes:
    //   (a) handleTimelineEose to set eosedAt=now with 0 events, so HTTP poll events arrive
    //       post-eose and land in onNew rather than the initial-load onEvents path.
    //   (b) onBatchEnd([]) (empty row array) → feedSubscribeRelayOutcomes stays length 0 →
    //       the "Looking for more events…" banner never clears.
    // Fix: for HTTP-only shards, skip oneose + relayReqLog on the (no-op) WS subscribe and
    // defer both to after the HTTP initial poll completes.
    const httpOnlyShard = httpTimelinePollBases.length > 0 && wsRelays.length === 0

    const subCloser = this.subscribe(wsRelays, filter, {
      startLogin,
      onevent: (evt: NEvent) => {
        applySubscribedTimelineEvent(evt)
      },
      oneose: httpOnlyShard ? undefined : handleTimelineEose,
      onclose: onClose,
      connectionSlotPriority:
        connectionSlotPriority === true ||
        (relayAuthoritativeTimeline && wsRelays.length === 1 && navigator.onLine),
      singleRelayExplicit: relayAuthoritativeTimeline && originalDedupedRelays.length === 1
    },
    httpOnlyShard ? undefined : relayReqLog)

    if (httpTimelinePollBases.length > 0) {
      const backfillFilter = { ...(filter as Filter) } as Filter & { until?: number }
      delete backfillFilter.until
      const httpInitialPoll = runHttpTimelinePollQuery(backfillFilter)
      if (httpOnlyShard) {
        void httpInitialPoll.then(() => {
          // Report HTTP relay outcomes first so feedSubscribeRelayOutcomes is non-empty
          // before feedTimelineEmptyUiReady flips to true (both land in the same React batch).
          if (relayReqLog?.onBatchEnd) {
            const t0 = performance.now()
            const httpRows: RelayOpTerminalRow[] = httpTimelinePollBases.map((url, i) => ({
              cmdIndex: i,
              relayUrl: url,
              outcome: 'eose' as const,
              msFromBatchStart: Math.round(performance.now() - t0)
            }))
            relayReqLog.onBatchEnd(httpRows)
          }
          handleTimelineEose(true)
        })
      }
    }

    return {
      timelineKey: key,
      closer: () => {
        clearFirstResultGraceTimer()
        clearStreamFlushDelay()
        clearHttpTimelinePoll()
        onEvents = () => {}
        onNew = () => {}
        subCloser.close()
      }
    }
  }

  private async _loadMoreTimeline(key: string, until: number, limit: number) {
    const timeline = this.timelines[key]
    if (!timeline || Array.isArray(timeline)) return []

    const { filter, urls } = timeline

    let events = await this.query(urls, { ...filter, until, limit }, undefined, {
      firstRelayResultGraceMs: false,
      globalTimeout: 25_000,
      eoseTimeout: 2500
    })
    events.forEach((evt) => {
      this.addEventToCache(evt)
    })
    events = events.sort((a, b) => b.created_at - a.created_at).slice(0, limit)

    if (!timeline.refs) {
      timeline.refs = []
    }

    const existingRefIds = new Set(timeline.refs.map(([id]) => id))
    const newRefs: TTimelineRef[] = []
    for (const evt of events) {
      if (!existingRefIds.has(evt.id)) {
        newRefs.push([evt.id, evt.created_at])
        existingRefIds.add(evt.id)
      }
    }
    newRefs.sort((a, b) => b[1] - a[1])

    if (timeline.refs.length > 0) {
      const lastRefCreatedAt = timeline.refs[timeline.refs.length - 1][1]
      const olderRefs = newRefs.filter(([, createdAt]) => createdAt < lastRefCreatedAt)
      timeline.refs.push(...olderRefs)
      timeline.refs.sort((a, b) => b[1] - a[1])
    } else {
      timeline.refs.push(...newRefs)
    }

    if (!timeline.disablePersist) {
      this.scheduleTimelinePersist(key)
    }
    return events
  }

  /** =========== Event =========== */

  getSeenEventRelays(eventId: string) {
    const key = canonicalSeenOnEventId(eventId)
    return Array.from(this.pool.seenOn.get(key)?.values() || [])
  }

  /**
   * Relays that delivered this event: {@link SimplePool.seenOn} (live subs) plus
   * {@link QueryService}’s map for `query()` / `fetchEvents` REQs.
   */
  getSeenEventRelayUrls(eventId: string): string[] {
    const key = canonicalSeenOnEventId(eventId)
    const poolUrls = this.getSeenEventRelays(key).map((r) => normalizeAnyRelayUrl(r.url) || r.url)
    const queryUrls = this.queryService.getSeenEventRelayUrls(key).map((u) => normalizeAnyRelayUrl(u) || u)
    return Array.from(new Set([...poolUrls, ...queryUrls].filter(Boolean)))
  }

  getEventHints(eventId: string) {
    return this.getSeenEventRelayUrls(eventId).filter((url) => !isLocalNetworkUrl(url))
  }

  getEventHint(eventId: string) {
    return this.getSeenEventRelayUrls(eventId).find((url) => !isLocalNetworkUrl(url)) ?? ''
  }

  /** Relay URLs in the pool whose WebSocket is currently connected (`listConnectionStatus`). */
  getConnectedRelayUrls(): string[] {
    const status = this.pool.listConnectionStatus()
    const out: string[] = []
    for (const [url, connected] of status) {
      if (!connected) continue
      const n = normalizeAnyRelayUrl(url) || url
      out.push(n)
    }
    return [...new Set(out)].sort((a, b) => a.localeCompare(b))
  }

  /** Kind 10243 HTTP index bases for the logged-in viewer (read + write). */
  getViewerHttpIndexRelayBases(): readonly string[] {
    return this.viewerHttpIndexRelayBases
  }

  trackEventSeenOn(eventId: string, relay: AbstractRelay) {
    const key = canonicalSeenOnEventId(eventId)
    let set = this.pool.seenOn.get(key)
    if (!set) {
      set = new Set()
      this.pool.seenOn.set(key, set)
    }
    set.add(relay)
  }

  /**
   * Yield capacity to foreground work: abort in-flight {@link QueryService.query} calls that did not pass
   * `foreground: true` (feeds, prefetch, etc.).
   * With {@link options.closePooledRelayConnections}, also closes every pooled relay socket so live timeline REQs
   * release the pool (e.g. NIP-50 search); those subs reconnect when needed.
   */
  interruptBackgroundQueries(options?: { closePooledRelayConnections?: boolean }): void {
    this.queryService.interruptBackgroundQueries()
    if (!options?.closePooledRelayConnections) return
    let urls: string[] = []
    try {
      urls = [...this.pool.listConnectionStatus().keys()]
    } catch {
      /* ignore */
    }
    if (urls.length === 0) return
    try {
      this.pool.close(urls)
    } catch {
      /* ignore */
    }
  }

  // Delegate to QueryService
  private async query(
    urls: string[],
    filter: Filter | Filter[],
    onevent?: (evt: NEvent) => void,
    options?: {
      eoseTimeout?: number
      globalTimeout?: number
      /** For replaceable events: race strategy - wait 2s after first result, then return best */
      replaceableRace?: boolean
      /** For non-replaceable single events: return immediately on first match */
      immediateReturn?: boolean
      firstRelayResultGraceMs?: number | false
    }
  ) {
    return this.queryService.query(sanitizeRelayUrlsForFetch(urls), filter, onevent, {
      ...options,
      httpIndexRelayBases: this.viewerHttpIndexRelayBases
    })
  }

  // Legacy query implementation removed - now delegated to QueryService

  async fetchEvents(
    urls: string[],
    filter: Filter | Filter[],
    {
      onevent,
      cache = false,
      eoseTimeout,
      globalTimeout,
      firstRelayResultGraceMs,
      replaceableRace,
      immediateReturn,
      foreground
    }: {
      onevent?: (evt: NEvent) => void
      cache?: boolean
      eoseTimeout?: number
      globalTimeout?: number
      firstRelayResultGraceMs?: number | false
      replaceableRace?: boolean
      immediateReturn?: boolean
      /** When true, ignore {@link QueryService.interruptBackgroundQueries} (e.g. secondary-panel profile loads). */
      foreground?: boolean
    } = {}
  ) {
    const originalDedupedRelays = Array.from(new Set(urls))
    const httpRelayBases = httpIndexBasesForRelayQuery(
      originalDedupedRelays,
      this.viewerHttpIndexRelayBases
    )
    const httpKeys = new Set(httpRelayBases.map((u) => canonicalRelaySessionKey(u)))
    const preserveExplicitSingleRelay =
      originalDedupedRelays.length === 1 &&
      (isSingleRelayExplicitBrowseActive() || isSingleRelayExplicitFetchScopeActive())
    const wsOriginal = sanitizeRelayUrlsForFetch(
      originalDedupedRelays.filter((url) => !httpKeys.has(canonicalRelaySessionKey(url))),
      undefined,
      { preserveExplicitSingleRelay }
    )
    let relays = [...wsOriginal]
    if (relays.length === 0 && httpRelayBases.length === 0) {
      relays = [...publicReadRelayFallbackUrls()]
    }
    const filters = Array.isArray(filter) ? filter : [filter]
    relays = withDocumentRelayUrlsForFilters(relays, filters, {
      singleRelayFeed: originalDedupedRelays.length === 1
    })
    const stripSocialBlockedRelays =
      SOCIAL_KIND_BLOCKED_RELAY_URLS.length > 0 &&
      filters.some((f) => relayFilterIncludesSocialKindBlockedKind(f))
    if (stripSocialBlockedRelays) {
      const socialKindBlockedSet = new Set(SOCIAL_KIND_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
      const stripped = relays.filter((url) => !socialKindBlockedSet.has(normalizeUrl(url) || url))
      relays = relaysAfterSocialKindBlockedStrip(wsOriginal, stripped)
    }
    relays = Array.from(new Set(relays))
    let queryRelays = dedupeNormalizeRelayUrlsOrdered([...relays, ...httpRelayBases])
    /** If every candidate was filtered away, still hit public read mirrors so REQ does not no-op. */
    if (queryRelays.length === 0) {
      queryRelays = dedupeNormalizeRelayUrlsOrdered([...publicReadRelayFallbackUrls()])
    }
    const events = await this.queryService.query(queryRelays, filter, onevent, {
      eoseTimeout,
      globalTimeout,
      firstRelayResultGraceMs,
      replaceableRace,
      immediateReturn,
      foreground,
      httpIndexRelayBases: this.viewerHttpIndexRelayBases
    })
    if (cache) {
      events.forEach((evt) => {
        this.addEventToCache(evt)
      })
    }
    return events
  }

  /**
   * Query one relay only (e.g. spell COUNT per-relay). Connection failures return `connectionError` instead of throwing.
   */
  async fetchEventsFromSingleRelay(
    url: string,
    filter: Filter | Filter[],
    options?: {
      globalTimeout?: number
      signal?: AbortSignal
      relayOpSource?: string
    }
  ): Promise<{ events: NEvent[]; connectionError?: string }> {
    const normalized = normalizeAnyRelayUrl(url) || url
    if (!normalized) {
      return { events: [], connectionError: 'Invalid relay URL' }
    }
    const queryOpts = {
      globalTimeout: options?.globalTimeout ?? 25_000,
      relayOpSource: options?.relayOpSource ?? ('fetchEventsFromSingleRelay' as const),
      foreground: true as const,
      /** General / picker single-relay queries use explicit grace from caller globalTimeout. */
      firstRelayResultGraceMs: false as const,
      ...(options?.signal ? { signal: options.signal } : {})
    }

    if (import.meta.env.DEV) {
      const f0 = Array.isArray(filter) ? filter[0] : filter
      const search =
        f0 && typeof f0 === 'object' && 'search' in f0 && typeof (f0 as { search?: unknown }).search === 'string'
          ? String((f0 as { search: string }).search).slice(0, 48)
          : undefined
      logger.info('[NIP-50] per-relay query', {
        relay: normalized,
        budgetMs: queryOpts.globalTimeout,
        search
      })
    }

    if (urlMatchesConfiguredHttpIndexRelay(normalized, this.viewerHttpIndexRelayBases)) {
      // Kind 10243 index relay: use HTTP API instead of WebSocket pool
      try {
        const events = await this.queryService.query([normalized], filter, undefined, queryOpts)
        return { events, connectionError: undefined }
      } catch (e) {
        return { events: [], connectionError: e instanceof Error ? e.message : String(e) }
      }
    }
    try {
      const events = await this.queryService.query([normalized], filter, undefined, queryOpts)
      return { events, connectionError: undefined }
    } catch (e) {
      return {
        events: [],
        connectionError: e instanceof Error ? e.message : String(e)
      }
    }
  }

  /**
   * Fetch a single event by id (hex, note1, nevent1, naddr1).
   * Relay order: (1) session/DataLoader cache (2) buildInitialRelayList (user's FAST_READ + favorite + read) or FAST_READ_RELAY_URLS
   * (3) for nevent/naddr: bech32 relay hints + author's read (inbox) + author's write (outbox) from kind 10002
   * (4) if still missing and filter has authors: author's read+write again in tryHarderToFetchEvent
   * (5) SEARCHABLE_RELAY_URLS as final fallback. Author relays are used so embedded notes load from the author's relays.
   */
  async fetchEvent(id: string, opts?: { relayHints?: string[] }): Promise<NEvent | undefined> {
    return this.eventService.fetchEvent(id, opts)
  }

  // Legacy fetchEvent implementation removed - now delegated to EventService

  async fetchEventForceRetry(eventId: string, opts?: { relayHints?: string[] }): Promise<NEvent | undefined> {
    return this.eventService.fetchEventForceRetry(eventId, opts)
  }

  /** Batch-prefetch by hex id into session cache (feed embeds). */
  async prefetchHexEventIds(
    hexIds: readonly string[],
    opts?: { relayHints?: string[]; relayHintsOnly?: boolean }
  ): Promise<void> {
    return this.eventService.prefetchHexEventIds(hexIds, opts)
  }

  /** Prefetch nostr embeds referenced by parent notes (with parent relay hints). */
  prefetchEmbeddedEventsForParents(
    parents: readonly NEvent[],
    opts?: { relayHintsOnly?: boolean }
  ): void {
    this.eventService.prefetchEmbeddedEventsForParents(parents, opts)
  }

  async fetchEventWithExternalRelays(
    eventId: string,
    externalRelays: string[],
    opts?: { eventTagRelayHints?: boolean }
  ): Promise<NEvent | undefined> {
    return this.eventService.fetchEventWithExternalRelays(eventId, externalRelays, opts)
  }

  addEventToCache(event: NEvent, ingestOpts?: ShouldDropEventOnIngestOptions) {
    this.eventService.addEventToCache(event, ingestOpts)
  }

  reapplySessionLruFromSettings(): void {
    this.eventService.reapplySessionLruMax()
  }

  peekSessionCachedEvent(noteId: string): NEvent | undefined {
    return this.eventService.peekSessionCachedEvent(noteId)
  }

  getSessionEventsMatchingSearch(query: string, limit: number, allowedKinds: number[]): NEvent[] {
    return this.eventService.getSessionEventsMatchingSearch(query, limit, allowedKinds)
  }

  /** Session LRU: RSVPs for this calendar event (by `a` coordinate or `e` parent id). */
  getSessionCalendarRsvpsForCalendarEvent(event: NEvent): NEvent[] {
    return this.eventService.getSessionCalendarRsvpsForCalendarEvent(event)
  }

  async fetchFavoriteRelays(pubkey: string): Promise<string[]> {
    try {
      const favoriteRelaysEvent = await this.replaceableEventService.fetchReplaceableEvent(
        pubkey,
        ExtendedKind.FAVORITE_RELAYS
      )
      if (!favoriteRelaysEvent) return []
      return await this.expandFavoriteRelayUrlsFromEvent(pubkey, favoriteRelaysEvent)
    } catch {
      return []
    }
  }

  private async expandFavoriteRelayUrlsFromEvent(
    pubkey: string,
    favoriteRelaysEvent: NEvent
  ): Promise<string[]> {
    const relays: string[] = []
    const relaySetIds: string[] = []
    favoriteRelaysEvent.tags.forEach(([tagName, tagValue]) => {
      if (tagName === 'relay' && tagValue) {
        const normalized = normalizeUrl(tagValue)
        if (normalized) {
          relays.push(normalized)
        }
      } else if (tagName === 'a' && tagValue) {
        const [kindStr, author, d] = tagValue.split(':')
        if (
          kindStr === String(kinds.Relaysets) &&
          author === pubkey &&
          d &&
          !relaySetIds.includes(d)
        ) {
          relaySetIds.push(d)
        }
      }
    })

    for (const id of relaySetIds) {
      try {
        const ev = await indexedDb.getReplaceableEvent(pubkey, kinds.Relaysets, id)
        if (!ev || shouldDropEventOnIngest(ev)) continue
        const set = getRelaySetFromEvent(ev)
        for (const u of set.relayUrls) {
          const n = normalizeUrl(u) || normalizeAnyRelayUrl(u)
          if (n && !relays.includes(n)) relays.push(n)
        }
      } catch {
        /* ignore */
      }
    }

    return Array.from(new Set(relays))
  }


  /** =========== Following favorite relays =========== */
  // Moved to ReplaceableEventService

  /** =========== Followings =========== */
  // Moved to ReplaceableEventService

  /**
   * Best-effort: fetch and persist each author's kind 3 + 10002 (contacts + NIP-65) via the same batched path
   * as profile relay discovery. Call from profile mounts and opportunistically from feed ingest.
   */
  prefetchAuthorCoreReplaceables(
    pubkeys: string | readonly string[],
    options?: { force?: boolean; cooldownMs?: number }
  ): void {
    const raw = typeof pubkeys === 'string' ? [pubkeys] : [...pubkeys]
    const cooldown = options?.cooldownMs ?? ClientService.AUTHOR_CORE_PREFETCH_COOLDOWN_MS
    const now = Date.now()
    const unique: string[] = []
    const seen = new Set<string>()
    for (const p of raw) {
      const pk = typeof p === 'string' ? p.trim().toLowerCase() : ''
      if (!/^[0-9a-f]{64}$/.test(pk) || seen.has(pk)) continue
      seen.add(pk)
      if (!options?.force) {
        const until = this.authorCorePrefetchCooldownUntilMs.get(pk) ?? 0
        if (now < until) continue
        this.authorCorePrefetchCooldownUntilMs.set(pk, now + cooldown)
      }
      unique.push(pk)
    }
    if (unique.length === 0) return

    void (async () => {
      try {
        await Promise.all([
          this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(unique, kinds.RelayList),
          this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(unique, kinds.Contacts),
          this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(unique, kinds.Mutelist),
          this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(unique, ExtendedKind.PAYMENT_INFO)
        ])
      } catch (err) {
        if (!options?.force) {
          for (const pk of unique) {
            this.authorCorePrefetchCooldownUntilMs.delete(pk)
          }
        }
        logger.debug('[client] prefetchAuthorCoreReplaceables failed', {
          count: unique.length,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })()
  }

  /**
   * When opening a user's profile: show cached rows first (hooks), then pull kind 0/3/10002/10000/10133/etc.
   * from a comprehensive relay set, persist to IndexedDB, and notify the app (see
   * `ReplaceableEventService.AUTHOR_REPLACEABLES_REFRESHED_EVENT`).
   */
  async refreshAuthorPublishedReplaceablesOnProfileView(
    pubkey: string,
    options?: { force?: boolean }
  ): Promise<void> {
    const pk = pubkey.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return
    try {
      await this.replaceableEventService.refreshAuthorPublishedReplaceablesFromRelays(pk, options)
    } catch (err) {
      logger.debug('[client] refreshAuthorPublishedReplaceablesOnProfileView failed', {
        pubkeySlice: pk.slice(0, 12),
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  /** Part of {@link runSessionPrewarm}; batches followings to limit relay load. */
  private async initUserIndexFromFollowings(pubkey: string, signal: AbortSignal) {
    const followings = await this.replaceableEventService.fetchFollowings(pubkey)
    if (followings.length === 0) {
      logger.info('[client] Prewarm: following profiles skipped (no followings)', {
        pubkeySlice: pubkey.slice(0, 12)
      })
      return
    }
    logger.info('[client] Prewarm: following profile + contacts + NIP-65 fetch started', {
      pubkeySlice: pubkey.slice(0, 12),
      followingCount: followings.length
    })
    let relayListResolved = 0
    let contactsResolved = 0
    let profileResolved = 0
    const chunkSize = 20
    for (let i = 0; i * chunkSize < followings.length; i++) {
      if (signal.aborted) {
        logger.info('[client] Prewarm: following profiles + relay lists aborted', { pubkeySlice: pubkey.slice(0, 12) })
        return
      }
      const chunk = followings.slice(i * chunkSize, (i + 1) * chunkSize)
      const [relayListEvents, contactsEvents, metadataEvents] = await Promise.all([
        this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(chunk, kinds.RelayList),
        this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(chunk, kinds.Contacts),
        this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(chunk, kinds.Metadata)
      ])
      relayListResolved += relayListEvents.filter(Boolean).length
      contactsResolved += contactsEvents.filter(Boolean).length
      const profiles = metadataEvents.filter((ev): ev is NEvent => Boolean(ev))
      profileResolved += profiles.length
      await Promise.allSettled(profiles.map((ev) => this.addUsernameToIndex(ev)))
      profiles.forEach((ev) => this.updateProfileEventCache(ev))
      if ((i + 1) * chunkSize < followings.length && !signal.aborted) {
        await this.yieldForUiPaint()
      }
    }
    logger.info('[client] Prewarm: following profile + contacts + NIP-65 fetch finished', {
      pubkeySlice: pubkey.slice(0, 12),
      followingCount: followings.length,
      relayListEventsResolved: relayListResolved,
      contactsEventsResolved: contactsResolved,
      profileEventsResolved: profileResolved
    })
  }

  /** =========== Profile =========== */

  async searchProfiles(
    relayUrls: string[],
    filter: Filter,
    options?: {
      relaysOnly?: boolean
      includeTagFilters?: boolean
      signal?: AbortSignal
      /** Override query timeouts (profile-relay step uses shorter budgets). */
      eoseTimeout?: number
      globalTimeout?: number
    }
  ): Promise<TProfile[]> {
    void this.ensureProfileSearchIndexFromIdb()
    const searchStr = typeof filter.search === 'string' ? filter.search.trim() : ''
    const normalizedAll = dedupeNormalizeRelayUrlsOrdered(relayUrls)
    const profileRelayLayer = dedupeNormalizeRelayUrlsOrdered(PROFILE_RELAY_URLS)
    const searchableSet = new Set(
      dedupeNormalizeRelayUrlsOrdered([
        ...SEARCHABLE_RELAY_URLS,
        ...getViewerNostrLandAggrSearchRelayUrls(),
        ...nip66Service.getSearchableRelayUrls(),
        ...PROFILE_RELAY_URLS
      ])
    )
    let urls = normalizedAll
    if (searchStr.length > 0 && !options?.relaysOnly) {
      const searchCapable = normalizedAll.filter(
        (u) => searchableSet.has(u) || nip66Service.isRelaySearchable(u)
      )
      urls = dedupeNormalizeRelayUrlsOrdered([...searchCapable, ...profileRelayLayer])
      if (urls.length === 0) {
        urls = normalizedAll
      }
    }

    const limitCap = Math.max(1, Math.min(filter.limit ?? 100, 500))
    const queryFilter: Filter | Filter[] =
      searchStr.length > 0
        ? (() => {
            const built = buildProfileKind0SearchFilters({
              search: searchStr,
              limit: limitCap,
              until: filter.until,
              includeTagFilters: options?.includeTagFilters
            })
            return built.length > 0 ? built : [{ ...filter, kinds: [...METADATA_CO_FETCH_KINDS] }]
          })()
        : { ...filter, kinds: [...METADATA_CO_FETCH_KINDS] }

    /** NIP-50 text on many index relays: per-relay EOSE can be ~38s; global cap was 9s so subs were torn down early. */
    const filtersArr = Array.isArray(queryFilter) ? queryFilter : [queryFilter]
    const usesNip50TextSearch = filtersArr.some(
      (f) => typeof f.search === 'string' && f.search.trim().length > 0
    )
    const usesAuthorsLookup = filtersArr.some((f) => (f.authors?.length ?? 0) > 0)
    if (options?.signal?.aborted) return []

    const events = await this.queryService.query(urls, queryFilter, undefined, {
      replaceableRace: false,
      eoseTimeout:
        options?.eoseTimeout ?? (usesNip50TextSearch ? 10_000 : 4500),
      globalTimeout:
        options?.globalTimeout ??
        (usesNip50TextSearch ? NIP50_QUERY_GLOBAL_TIMEOUT_FLOOR_MS + 18_000 : 9000),
      relayOpSource: 'ClientService.searchProfiles',
      foreground: usesNip50TextSearch || usesAuthorsLookup || options?.relaysOnly === true,
      signal: options?.signal
    })

    const byPk = new Map<string, NEvent>()
    for (const e of events) {
      if (e.kind === ExtendedKind.PAYMENT_INFO && !shouldDropEventOnIngest(e)) {
        void this.replaceableEventService.updateReplaceableEventCache(e)
        continue
      }
      if (e.kind !== kinds.Metadata) continue
      const prev = byPk.get(e.pubkey)
      if (!prev || e.created_at > prev.created_at) {
        byPk.set(e.pubkey, e)
      }
    }
    const profileEvents = [...byPk.values()].sort((a, b) => b.created_at - a.created_at).slice(0, limitCap)
    await Promise.allSettled(profileEvents.map((profile) => this.addUsernameToIndex(profile)))
    profileEvents.forEach((profile) => this.updateProfileEventCache(profile))
    return profileEvents.map((profileEvent) => getProfileFromEvent(profileEvent))
  }

  private profileRelaySearchUrls(): string[] {
    return dedupeNormalizeRelayUrlsOrdered(PROFILE_RELAY_URLS)
  }

  private nip50ProfileIndexRelayUrls(): string[] {
    return dedupeNormalizeRelayUrlsOrdered([
      ...SEARCHABLE_RELAY_URLS,
      ...nip66Service.getSearchableRelayUrls()
    ])
  }

  private profileSearchStagedGeneration = 0
  private profileSearchStagedAbort: AbortController | null = null

  /**
   * Staged profile discovery: local cache/DB → profile relays only → NIP-50 index relays
   * only when the first two stages returned nothing. Calls `onUpdate` after each stage.
   * Aborts the previous in-flight staged search when a new query starts.
   */
  async searchProfilesStaged(
    query: string,
    limit: number = 50,
    onUpdate?: (profiles: TProfile[]) => void,
    externalSignal?: AbortSignal
  ): Promise<TProfile[]> {
    const q = query.trim()
    if (!q || limit <= 0) return []

    this.profileSearchStagedAbort?.abort()
    const runAbort = new AbortController()
    this.profileSearchStagedAbort = runAbort
    const generation = ++this.profileSearchStagedGeneration

    const isStale = () =>
      generation !== this.profileSearchStagedGeneration ||
      runAbort.signal.aborted ||
      externalSignal?.aborted === true

    const seen = new Set<string>()
    const out: TProfile[] = []

    const merge = (batch: TProfile[]) => {
      for (const p of batch) {
        const pk = p.pubkey.toLowerCase()
        if (seen.has(pk)) continue
        seen.add(pk)
        out.push(p)
        if (out.length >= limit) break
      }
    }

    const emit = () => {
      if (!isStale() && onUpdate) onUpdate(out.slice(0, limit))
    }

    const relaySignal = externalSignal
      ? AbortSignal.any([runAbort.signal, externalSignal])
      : runAbort.signal

    const relayUrls = this.profileRelaySearchUrls()
    const indexUrls = this.nip50ProfileIndexRelayUrls()

    const localPromise = this.searchProfilesFromLocal(q, limit)
    const profileRelayPromise = this.searchProfiles(
      relayUrls,
      { search: q, limit },
      {
        relaysOnly: true,
        includeTagFilters: false,
        signal: relaySignal,
        eoseTimeout: 6_000,
        globalTimeout: 9_000
      }
    ).catch(() => [] as TProfile[])
    const archivesPromise =
      q.length >= 2 && nostrArchivesApi.isAvailable()
        ? nostrArchivesApi.searchSuggest(q, Math.min(limit, 10))
        : Promise.resolve({ ok: false as const, reason: 'disabled' as const })

    const [localProfiles, profileRelayProfiles, archivesRes] = await Promise.all([
      localPromise,
      profileRelayPromise,
      archivesPromise
    ])

    merge(localProfiles)
    if (!isStale() && archivesRes.ok) {
      merge(archivesMetadataListToProfiles(archivesRes.data.suggestions))
    }
    merge(profileRelayProfiles)
    if (isStale()) return out.slice(0, limit)
    emit()
    if (out.length >= limit) return out.slice(0, limit)
    if (out.length > 0) return out.slice(0, limit)

    if (indexUrls.length > 0) {
      merge(
        await this.searchProfiles(
          indexUrls,
          { search: q, limit },
          {
            signal: relaySignal,
            includeTagFilters: true,
            eoseTimeout: 5_000,
            globalTimeout: 12_000
          }
        ).catch(() => [] as TProfile[])
      )
      if (!isStale()) emit()
    }

    return out.slice(0, limit)
  }

  /** Match @-mention query against authors visible in the current session (thread / feed). */
  private async searchNpubsFromSessionAuthors(query: string, limit: number): Promise<string[]> {
    const q = query.trim()
    if (!q || limit <= 0) return []

    const candidatePubkeys = this.eventService.collectSessionMentionCandidatePubkeys()
    const out: string[] = []
    const seen = new Set<string>()

    for (const pk of candidatePubkeys) {
      if (out.length >= limit) break
      let meta = this.eventService.getSessionMetadataForPubkey(pk)
      if (!meta) {
        try {
          meta = (await indexedDb.getReplaceableEvent(pk, kinds.Metadata)) ?? undefined
        } catch {
          meta = undefined
        }
      }
      if (!meta || !profileKind0MatchesSearchQuery(meta, q)) continue
      const npub = pubkeyToNpub(pk)
      if (!npub || seen.has(npub)) continue
      seen.add(npub)
      out.push(npub)
    }
    return out
  }

  /** Reply-thread participants (parent author + `p` tags) for @-mention autocomplete. */
  private async searchNpubsFromReplyParent(query: string, limit: number): Promise<string[]> {
    const parent = postEditorService.replyParentEvent
    if (!parent || limit <= 0) return []

    const q = query.trim()
    const pks = new Set<string>()
    const author = parent.pubkey.trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(author)) pks.add(author)
    for (const t of parent.tags ?? []) {
      if (!Array.isArray(t) || t.length < 2) continue
      if (t[0] !== 'p' && t[0] !== 'P') continue
      const pk = String(t[1] ?? '').trim().toLowerCase()
      if (/^[0-9a-f]{64}$/.test(pk)) pks.add(pk)
    }

    const out: string[] = []
    for (const pk of pks) {
      if (out.length >= limit) break
      let meta = this.eventService.getSessionMetadataForPubkey(pk)
      if (!meta) {
        try {
          meta = (await indexedDb.getReplaceableEvent(pk, kinds.Metadata)) ?? undefined
        } catch {
          meta = undefined
        }
      }
      if (!meta) continue
      if (q && !profileKind0MatchesSearchQuery(meta, q)) continue
      const npub = pubkeyToNpub(pk)
      if (npub) out.push(npub)
    }
    return out
  }

  async searchNpubsFromLocal(query: string, limit: number = 100) {
    await this.ensureProfileSearchIndexFromIdb()
    const seen = new Set<string>()
    const out: string[] = []
    const pushNpub = (npub: string) => {
      if (!npub || seen.has(npub) || out.length >= limit) return
      seen.add(npub)
      out.push(npub)
    }
    for (const pk of this.eventService.searchSessionProfilePubkeys(query, limit)) {
      const npub = pubkeyToNpub(pk)
      if (npub) pushNpub(npub)
    }
    if (out.length >= limit) return out
    const remaining = limit - out.length
    const result = await this.userIndex.searchAsync(query, { limit: remaining * 4 })
    for (const pubkey of result) {
      const npub = pubkeyToNpub(pubkey as string)
      if (npub) pushNpub(npub)
      if (out.length >= limit) break
    }
    return out
  }

  /**
   * Npubs for @-mention dropdown: (1) follow-list profiles matching the query,
   * (2) local index, (3) kind-0 NIP-50 search on {@link PROFILE_RELAY_URLS} (includes search relays + profile mirrors; deduped).
   * Returns cached results immediately, then streams relay results via callback.
   */
  /**
   * Record a kind-5 deletion in the local tombstone store (no network).
   * Call immediately after signing so the UI hides the target before relay ACKs.
   */
  async applyDeletionRequestToLocalCache(deletionEvent: NEvent, targetEvent?: NEvent): Promise<string[]> {
    const keys = this.collectTombstoneKeysFromDeletion(deletionEvent, targetEvent)
    for (const key of keys) {
      await indexedDb.addTombstone(key)
    }
    const removed = await indexedDb.removeTombstonedFromCache()
    if (removed > 0) {
      logger.info('[ClientService] Removed tombstoned events from cache', { count: removed })
    }
    invalidateArchiveFootprintCache()
    dispatchTombstonesUpdated(keys)
    return keys
  }

  private collectTombstoneKeysFromDeletion(deletionEvent: NEvent, targetEvent?: NEvent): string[] {
    const keys = new Set<string>()
    if (targetEvent) {
      keys.add(getKeyForDeletedLookup(targetEvent))
    }
    let hasETagOrATag = false
    for (const tag of deletionEvent.tags) {
      if (tag[0] === 'e' && tag[1]) {
        keys.add(tag[1])
        hasETagOrATag = true
      }
      if (tag[0] === 'a' && tag[1]) {
        keys.add(tag[1])
        hasETagOrATag = true
      }
    }
    if (!hasETagOrATag) {
      const kTag = deletionEvent.tags.find((tag) => tag[0] === 'k')
      if (kTag?.[1] && deletionEvent.pubkey) {
        const kind = parseInt(kTag[1], 10)
        if (!isNaN(kind)) keys.add(`${kind}:${deletionEvent.pubkey}`)
      }
    }
    return [...keys]
  }

  private async addTombstoneEntriesFromDeletionEvent(deletionEvent: NEvent): Promise<void> {
    for (const key of this.collectTombstoneKeysFromDeletion(deletionEvent)) {
      await indexedDb.addTombstone(key)
    }
  }

  /**
   * Fetch kind-5 deletion events for an author, merge tombstones, remove matching rows from IndexedDB,
   * and notify the UI. Intended for **manual** refresh (e.g. cache settings); not run on every login.
   */
  async fetchDeletionEvents(relayUrls: string[] = [], authorPubkey?: string): Promise<void> {
    const pk = authorPubkey?.trim().toLowerCase()
    if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return

    const urls = (relayUrls.length > 0 ? relayUrls : [...PROFILE_RELAY_URLS])
      .map((u) => normalizeUrl(u) || u)
      .filter(Boolean)
    const capped = Array.from(new Set(urls)).slice(0, 16)
    if (capped.length === 0) return

    try {
      const events = await this.queryService.fetchEvents(
        capped,
        {
          kinds: [kinds.EventDeletion],
          authors: [pk],
          limit: 500
        },
        {
          firstRelayResultGraceMs: false,
          globalTimeout: 22_000,
          eoseTimeout: 2500
        }
      )

      let any = false
      for (const e of events) {
        if (e.kind !== kinds.EventDeletion || e.pubkey.toLowerCase() !== pk) continue
        if (!verifyEvent(e)) continue
        if (shouldDropEventOnIngest(e)) continue
        await this.addTombstoneEntriesFromDeletionEvent(e)
        any = true
      }

      if (any) {
        const removed = await indexedDb.removeTombstonedFromCache()
        if (removed > 0) {
          logger.info('[ClientService] Removed tombstoned events from cache after deletion sync', {
            count: removed
          })
        }
        invalidateArchiveFootprintCache()
        dispatchTombstonesUpdated()
      }
    } catch (e) {
      logger.warn('[ClientService] fetchDeletionEvents failed', { error: e })
    }
  }

  /** Fetch deletions for a profile pubkey using that user’s NIP-65 read stack when possible. */
  async fetchDeletionEventsForPubkey(profilePubkey: string): Promise<void> {
    const pk = profilePubkey.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return
    try {
      const rl = await this.fetchRelayList(pk)
      const urls = buildDeletionRelayUrls(rl)
      await this.fetchDeletionEvents(urls, pk)
    } catch {
      await this.fetchDeletionEvents(buildDeletionRelayUrls(null), pk)
    }
  }

  async searchNpubsForMention(
    query: string,
    limit: number = 50,
    onUpdate?: (npubs: string[]) => void
  ): Promise<string[]> {
    const q = query.trim()
    const qLower = q.toLowerCase()
    const addedNpubs = new Set<string>()
    const out: string[] = []

    const addNpub = (npub: string) => {
      if (addedNpubs.has(npub) || out.length >= limit) return false
      addedNpubs.add(npub)
      out.push(npub)
      return true
    }

    const updateIfNeeded = () => {
      if (onUpdate) onUpdate([...out])
    }

    const profileRelayPromise =
      q.length >= 1
        ? this.searchProfiles(
            this.profileRelaySearchUrls(),
            { search: q, limit },
            { relaysOnly: true, includeTagFilters: false, eoseTimeout: 6_000, globalTimeout: 9_000 }
          ).catch(() => [] as TProfile[])
        : Promise.resolve([] as TProfile[])

    const directPk = decodeProfileSearchQueryToPubkeyHex(q)
    if (directPk) {
      const np = pubkeyToNpub(directPk)
      if (np) addNpub(np)
    }

    // 1. Local sources first — IndexedDB substring, session thread authors, FlexSearch.
    //    Cap how many local hits we take so we never fill `limit` here alone; otherwise we returned
    //    early and skipped relay search entirely (bad for handle search beyond the local index).
    const localCap = Math.min(limit, 24)
    const [replyParentNpubs, localNpubs, idbProfiles, sessionAuthorNpubs] = await Promise.all([
      this.searchNpubsFromReplyParent(q, localCap).catch(() => [] as string[]),
      this.searchNpubsFromLocal(q, localCap).catch(() => [] as string[]),
      this.searchProfilesFromIndexedDBCache(q, localCap).catch(() => [] as TProfile[]),
      this.searchNpubsFromSessionAuthors(q, localCap).catch(() => [] as string[])
    ])

    for (const npub of replyParentNpubs) {
      if (addNpub(npub)) updateIfNeeded()
      if (out.length >= limit) break
    }

    for (const p of idbProfiles) {
      const np = pubkeyToNpub(p.pubkey)
      if (np && addNpub(np)) updateIfNeeded()
      if (out.length >= limit) break
    }
    for (const npub of sessionAuthorNpubs) {
      if (addNpub(npub)) updateIfNeeded()
      if (out.length >= limit) break
    }
    for (const npub of localNpubs) {
      if (addNpub(npub)) updateIfNeeded()
      if (out.length >= limit) break
    }

    if (out.length >= limit) {
      out.forEach((npub) => {
        this.replaceableEventService.fetchProfileEvent(npub).catch(() => {})
      })
      return out
    }

    // 2. Follow list — batch IDB read; wait briefly so follows appear before relay fallback.
    let followMergeWork: Promise<void> = Promise.resolve()
    if (this.pubkey && qLower.length >= 1) {
      const pk = this.pubkey.trim().toLowerCase()
      const viewerPubkey = this.pubkey

      const mergeFollowMatches = async (followListEvent: NEvent | undefined | null) => {
        if (!followListEvent || out.length >= limit) return
        try {
          const followPubkeys = getPubkeysFromPTags(followListEvent.tags)
            .map((hex) => hex.trim().toLowerCase())
            .filter((hex) => /^[0-9a-f]{64}$/.test(hex))
            .slice(0, 200)
          if (followPubkeys.length === 0) return

          const events = await indexedDb.getManyReplaceableEvents(followPubkeys, kinds.Metadata)
          for (let i = 0; i < followPubkeys.length; i++) {
            if (out.length >= limit) break
            const ev = events[i]
            if (!ev) continue
            const npub = pubkeyToNpub(followPubkeys[i]!)
            if (!npub) continue
            if (!profileKind0MatchesSearchQuery(ev, q)) continue
            if (addNpub(npub)) {
              updateIfNeeded()
            }
          }
        } catch {
          // ignore
        }
      }

      followMergeWork = (async () => {
        try {
          const cachedFollow = await indexedDb.getReplaceableEvent(pk, kinds.Contacts)
          if (cachedFollow) {
            await mergeFollowMatches(cachedFollow)
          } else {
            const ev = await this.replaceableEventService.fetchFollowListEvent(viewerPubkey)
            await mergeFollowMatches(ev)
          }
        } catch {
          try {
            const ev = await this.replaceableEventService.fetchFollowListEvent(viewerPubkey)
            await mergeFollowMatches(ev)
          } catch {
            // ignore
          }
        }
      })()

      if (out.length < limit) {
        await Promise.race([
          followMergeWork,
          new Promise<void>((resolve) => setTimeout(resolve, 1_500))
        ])
      }
    }

    if (out.length >= limit) {
      out.forEach((npub) => {
        this.replaceableEventService.fetchProfileEvent(npub).catch(() => {})
      })
      return out
    }

    // 3. Profile relays (started in parallel with local + follow merge above).
    if (q.length >= 1 && out.length < limit) {
      try {
        const relayProfiles = await profileRelayPromise
        for (const p of relayProfiles) {
          const npub = pubkeyToNpub(p.pubkey)
          if (!npub) continue
          if (addNpub(npub)) updateIfNeeded()
          if (out.length >= limit) break
        }
      } catch {
        /* best-effort */
      }
    }

    // 4. NIP-50 index relays only when local + profile relays found nothing.
    if (q.length >= 1 && out.length === 0) {
      const indexUrls = this.nip50ProfileIndexRelayUrls()
      if (indexUrls.length > 0) {
        try {
          const indexProfiles = await this.searchProfiles(indexUrls, { search: q, limit }, {
            eoseTimeout: 5_000,
            globalTimeout: 12_000
          })
          for (const p of indexProfiles) {
            const npub = pubkeyToNpub(p.pubkey)
            if (!npub) continue
            if (addNpub(npub)) updateIfNeeded()
            if (out.length >= limit) break
          }
        } catch {
          /* best-effort */
        }
      }
    }

    // Prime profile cache for cached results
    out.forEach((npub) => {
      this.replaceableEventService.fetchProfileEvent(npub).catch(() => {})
    })
    
    return out
  }

  /** Kind-0 profiles whose metadata is already in IndexedDB (substring match on name / nip05 / pubkey hex). */
  async searchProfilesFromIndexedDBCache(query: string, limit: number = 100): Promise<TProfile[]> {
    const q = query.trim()
    if (!q || limit <= 0) return []
    const events = await indexedDb.searchProfileEventsInCache(q, limit)
    return events.map((e) => getProfileFromEvent(e))
  }

  /**
   * Profile search local sources: IndexedDB kind-0 cache first, then FlexSearch/session npubs + fetchProfile.
   */
  async searchProfilesFromLocal(query: string, limit: number = 100): Promise<TProfile[]> {
    await this.ensureProfileSearchIndexFromIdb()
    const q = query.trim()
    if (!q) return []

    const seen = new Set<string>()
    const out: TProfile[] = []

    const directPk = decodeProfileSearchQueryToPubkeyHex(q)
    if (directPk) {
      const p = await this.replaceableEventService.fetchProfile(directPk)
      if (p) {
        seen.add(directPk)
        out.push(p)
        if (out.length >= limit) return out
      }
    }

    const fromIdb = await this.searchProfilesFromIndexedDBCache(q, limit)
    for (const p of fromIdb) {
      const pk = p.pubkey.toLowerCase()
      if (seen.has(pk)) continue
      seen.add(pk)
      out.push(p)
      if (out.length >= limit) return out
    }

    const remaining = limit - out.length
    if (remaining <= 0) return out

    const npubs = await this.searchNpubsFromLocal(q, remaining)
    const pkBatch: string[] = []
    for (const npub of npubs) {
      try {
        const pkHex = userIdToPubkey(npub).toLowerCase()
        if (!seen.has(pkHex)) pkBatch.push(pkHex)
      } catch {
        continue
      }
    }
    if (pkBatch.length === 0) return out

    const profiles = await this.fetchProfilesForPubkeys(pkBatch.slice(0, remaining))
    for (const p of profiles) {
      const pk = p.pubkey.toLowerCase()
      if (seen.has(pk)) continue
      seen.add(pk)
      out.push(p)
      if (out.length >= limit) break
    }
    return out
  }

  private trimIngestProfileIdbMap(): void {
    const MAX = 10_000
    while (this.ingestProfileIdbMaxCreatedAt.size > MAX) {
      const k = this.ingestProfileIdbMaxCreatedAt.keys().next().value
      if (k === undefined) break
      this.ingestProfileIdbMaxCreatedAt.delete(k)
    }
  }

  private async addUsernameToIndex(profileEvent: NEvent) {
    try {
      const profileObj = JSON.parse(profileEvent.content)
      const nip05All = collectNip05ValuesFromKind0(profileEvent).join(' ')
      const text = [profileObj.display_name?.trim() ?? '', profileObj.name?.trim() ?? '', nip05All].join(' ')
      if (!text.trim()) return

      await this.userIndex.addAsync(profileEvent.pubkey, text)
    } catch {
      return
    }
  }

  // Delegate to ReplaceableEventService
  async fetchProfileEvent(
    id: string,
    skipCache: boolean = false,
    options?: import('./client-replaceable-events.service').FetchProfileEventOptions
  ): Promise<NEvent | undefined> {
    return this.replaceableEventService.fetchProfileEvent(id, skipCache, options)
  }

  async fetchProfile(id: string, skipCache: boolean = false): Promise<TProfile | undefined> {
    return this.replaceableEventService.fetchProfile(id, skipCache)
  }

  async fetchProfilesForPubkeys(pubkeys: string[]): Promise<TProfile[]> {
    return this.replaceableEventService.fetchProfilesForPubkeys(pubkeys)
  }

  async getProfileFromIndexedDB(id: string): Promise<TProfile | undefined> {
    return this.replaceableEventService.getProfileFromIndexedDB(id)
  }

  async updateProfileEventCache(event: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(event)
  }

  /** =========== Relay list =========== */

  async fetchRelayListEvent(pubkey: string) {
    const event = await this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.RelayList)
    return event ?? null
  }

  clearRelayListCache(targetPubkey: string) {
    const suffix = `\x1e${targetPubkey}`
    for (const k of this.relayListRequestCache.keys()) {
      if (k.endsWith(suffix)) this.relayListRequestCache.delete(k)
    }
  }

  private relayListRequestCacheKey(targetPubkey: string): string {
    return `${this.pubkey ?? ''}\x1e${targetPubkey}`
  }

  /**
   * Clear all in-memory caches. Call this after IndexedDB/cache clear so that
   * subsequent fetches go to the network instead of serving stale in-memory data.
   * Fixes missing profile pics and broken reactions after "Clear cache" on mobile.
   */
  clearInMemoryCaches(): void {
    this.relayListRequestCache.clear()
    this.eventService.clearCaches()
    this.replaceableEventService.clearCaches()
    logger.info('[ClientService] In-memory caches cleared')
  }

  async fetchRelayList(pubkey: string): Promise<TRelayList> {
    // Deduplicate concurrent requests for the same pubkey's relay list
    const cacheKey = this.relayListRequestCacheKey(pubkey)
    const existingRequest = this.relayListRequestCache.get(cacheKey)
    if (existingRequest) {
      return existingRequest
    }

    const requestPromise = (async () => {
      try {
        const [relayList] = await this.fetchRelayLists([pubkey])
        if (this.pubkey && hexPubkeysEqual(this.pubkey, pubkey)) {
          void this.syncViewerPersonalRelayKeys(pubkey)
        }
        return relayList
      } catch (error) {
        logger.warn('[FetchRelayList] Fetch failed; using IndexedDB / defaults', {
          pubkey,
          error: error instanceof Error ? error.message : String(error)
        })
        try {
          const [fallback] = await this.mergeRelayListsFromStoredOnly([pubkey])
          return fallback!
        } catch {
          const read = PROFILE_RELAY_URLS
          const write = PROFILE_RELAY_URLS
          return {
            write,
            read,
            originalRelays: syntheticOriginalRelaysFromReadWrite(read, write),
            httpRead: [],
            httpWrite: [],
            httpOriginalRelays: []
          }
        }
      } finally {
        this.relayListRequestCache.delete(cacheKey)
      }
    })()
    
    this.relayListRequestCache.set(cacheKey, requestPromise)
    return requestPromise
  }

  /**
   * Merge relay list from IndexedDB only (no network). Same rules as a timed-out {@link fetchRelayLists}:
   * defaults to {@link PROFILE_RELAY_URLS} when kind 10002 is missing.
   */
  async peekRelayListFromStorage(pubkey: string): Promise<TRelayList> {
    const [rl] = await this.mergeRelayListsFromStoredOnly([pubkey])
    return rl!
  }

  /**
   * Write targets for republishing from the cache browser: merged NIP-65 WS outbox + kind 10432 cache relays +
   * kind 10243 HTTP write relays (same merge as {@link peekRelayListFromStorage}). No FAST_WRITE padding.
   */
  async getMailboxStackWriteUrlsForRepublish(pubkey: string): Promise<string[]> {
    const rl = await this.peekRelayListFromStorage(pubkey)
    return collectViewerWriteOutboxUrls(pubkey, rl)
  }

  /** Newest kind 10002 for `pubkey` from IndexedDB and/or session LRU (session may hold a copy not persisted yet). */
  private async getKind10002FromIdbOrSession(pubkey: string): Promise<NEvent | undefined | null> {
    let idb: NEvent | undefined | null
    try {
      idb = await indexedDb.getReplaceableEvent(pubkey, kinds.RelayList)
    } catch {
      idb = undefined
    }
    const idbOk = idb && !shouldDropEventOnIngest(idb) ? idb : undefined
    const sessionHits = this.eventService.listSessionEventsAuthoredBy(pubkey, {
      kinds: [kinds.RelayList],
      limit: 20
    })
    const ses = sessionHits[0]
    const sesOk = ses && !shouldDropEventOnIngest(ses) ? ses : undefined
    if (!idbOk) return sesOk
    if (!sesOk) return idbOk
    return sesOk.created_at >= idbOk.created_at ? sesOk : idbOk
  }

  private async mergeRelayListsFromStoredOnly(pubkeys: string[]): Promise<TRelayList[]> {
    const storedRelayEvents = await Promise.all(pubkeys.map((pk) => this.getKind10002FromIdbOrSession(pk)))
    const storedCacheRelayEvents = await Promise.all(
      pubkeys.map((pk) => indexedDb.getReplaceableEvent(pk, ExtendedKind.CACHE_RELAYS))
    )
    const storedHttpRelayEvents = await Promise.all(
      pubkeys.map((pk) => indexedDb.getReplaceableEvent(pk, ExtendedKind.HTTP_RELAY_LIST))
    )
    return this.mergeRelayListsBundle(
      pubkeys,
      pubkeys.map(() => undefined),
      pubkeys.map(() => undefined),
      storedCacheRelayEvents.map((e) => e ?? undefined),
      storedRelayEvents,
      storedHttpRelayEvents,
      storedCacheRelayEvents
    )
  }

  /**
   * Merge NIP-65 (10002), HTTP relay list (10243), and cache relays (10432) from network and/or IndexedDB.
   * Network arrays may be sparse/undefined per index; stored* always filled from IDB reads.
   */
  private mergeRelayListsBundle(
    pubkeys: string[],
    relayEvents: (NEvent | null | undefined)[],
    httpRelayEvents: (NEvent | null | undefined)[],
    cacheRelayEvents: (NEvent | null | undefined)[],
    storedRelayEvents: (NEvent | null | undefined)[],
    storedHttpRelayEvents: (NEvent | null | undefined)[],
    storedCacheRelayEvents: (NEvent | null | undefined)[]
  ): TRelayList[] {
    const mergedLists = pubkeys.map((targetPubkey, index) => {
      const isOwnRelayList =
        this.pubkey != null && hexPubkeysEqual(this.pubkey, userIdToPubkey(targetPubkey))

      const storedCacheEvent = storedCacheRelayEvents[index]
      const cacheEventRaw = cacheRelayEvents[index] || storedCacheEvent
      const cacheEvent =
        isOwnRelayList && !storage.getCacheRelaysEnabled() ? undefined : cacheEventRaw

      const httpRelayEvent = httpRelayEvents[index] || storedHttpRelayEvents[index]

      const storedRelayEvent = storedRelayEvents[index]
      const relayEvent = relayEvents[index] || storedRelayEvent

      const emptyHttp = { httpRead: [] as string[], httpWrite: [] as string[], httpOriginalRelays: [] as TMailboxRelay[] }

      const mergeKind10243 = (list: TRelayList): TRelayList => {
        if (!httpRelayEvent) {
          return {
            ...list,
            httpRead: list.httpRead ?? [],
            httpWrite: list.httpWrite ?? [],
            httpOriginalRelays: list.httpOriginalRelays ?? []
          }
        }
        const h = getHttpRelayListFromEvent(httpRelayEvent)
        return { ...list, httpRead: h.httpRead, httpWrite: h.httpWrite, httpOriginalRelays: h.httpOriginalRelays }
      }

      const relayListFrom10002 = relayEvent ? getRelayListFromEvent(relayEvent) : {
        write: [],
        read: [],
        originalRelays: [],
        ...emptyHttp
      }
      // LAN / loopback belong on kind 10432 (cache), not NIP-65 10002 — strip 10002 before merging cache.
      const relayList = stripLocalNetworkRelaysFromRelayList(relayListFrom10002)

      if (isOwnRelayList && cacheEvent) {
        const cacheRelayList = getRelayListFromEvent(cacheEvent)

        const mergedRead = [...cacheRelayList.read, ...relayList.read]
        const mergedWrite = [...cacheRelayList.write, ...relayList.write]
        const mergedOriginalRelays = new Map<string, TMailboxRelay>()

        cacheRelayList.originalRelays.forEach((relay) => {
          mergedOriginalRelays.set(relay.url, relay)
        })
        relayList.originalRelays.forEach((relay) => {
          if (!mergedOriginalRelays.has(relay.url)) {
            mergedOriginalRelays.set(relay.url, relay)
          }
        })

        return mergeKind10243({
          write: Array.from(new Set(mergedWrite)),
          read: Array.from(new Set(mergedRead)),
          originalRelays: Array.from(mergedOriginalRelays.values()),
          ...emptyHttp
        })
      }

      if (!relayEvent) {
        if (isOwnRelayList && storedCacheEvent) {
          const cacheRelayList = getRelayListFromEvent(storedCacheEvent)
          return mergeKind10243({
            write: cacheRelayList.write.length > 0 ? cacheRelayList.write : PROFILE_RELAY_URLS,
            read: cacheRelayList.read.length > 0 ? cacheRelayList.read : PROFILE_RELAY_URLS,
            originalRelays: cacheRelayList.originalRelays,
            ...emptyHttp
          })
        }
        let read = PROFILE_RELAY_URLS
        let write = PROFILE_RELAY_URLS
        if (!isOwnRelayList) {
          const stripped = stripMailboxLocalUrlsForRemoteViewers({ read, write })
          read =
            stripped.read.length > 0 ? stripped.read : read.filter(urlIsNonLocalForRemoteViewer)
          write =
            stripped.write.length > 0 ? stripped.write : write.filter(urlIsNonLocalForRemoteViewer)
          if (read.length === 0 && write.length === 0) {
            read = [...publicReadRelayFallbackUrls()]
            write = [...FAST_WRITE_RELAY_URLS]
          }
        }
        return mergeKind10243({
          write,
          read,
          originalRelays: syntheticOriginalRelaysFromReadWrite(read, write),
          ...emptyHttp
        })
      }

      const merged = mergeKind10243(relayList)
      // Kind 10243 can still carry another user's loopback index (e.g. http://localhost:8080). NIP-65 `r` rows
      // were stripped above; strip again after HTTP merge for other users' bundles only (viewer keeps 10432/LAN).
      return isOwnRelayList ? merged : stripLocalNetworkRelaysFromRelayList(merged)
    })
    if (this.pubkey) {
      const i = pubkeys.findIndex((pk) => hexPubkeysEqual(this.pubkey!, userIdToPubkey(pk)))
      if (i >= 0) {
        const storedCacheEvent = storedCacheRelayEvents[i]
        const cacheResolved = cacheRelayEvents[i] || storedCacheEvent
        relaySessionStrikes.setSessionCacheRelayKeysFromKind10432(
          storage.getCacheRelaysEnabled() ? (cacheResolved ?? null) : null
        )
      }
    }
    return mergedLists
  }

  /** Background refresh so UI/publish can use IDB immediately while relays catch up. */
  private refreshRelayListsFromNetwork(
    pubkeys: string[],
    storedKind10002: (NEvent | null | undefined)[]
  ): void {
    const missingPubkeys: string[] = []
    const storedForMissing: (NEvent | null | undefined)[] = []
    for (let i = 0; i < pubkeys.length; i++) {
      if (storedKind10002[i] != null) continue
      missingPubkeys.push(pubkeys[i]!)
      storedForMissing.push(storedKind10002[i])
    }
    if (missingPubkeys.length === 0) return

    const key = missingPubkeys
      .map((pk) => pk.toLowerCase())
      .sort()
      .join('\x1e')
    const now = Date.now()
    if (now - (this.refreshRelayListsBgLastAtMs.get(key) ?? 0) < REFRESH_RELAY_LIST_BG_MIN_INTERVAL_MS) {
      return
    }
    if (this.refreshRelayListsBgInFlight.has(key)) return

    this.refreshRelayListsBgInFlight.add(key)
    this.refreshRelayListsBgLastAtMs.set(key, now)

    void (async () => {
      try {
        const relayEvents = await this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(
          missingPubkeys,
          kinds.RelayList
        )
        await this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(
          missingPubkeys,
          ExtendedKind.HTTP_RELAY_LIST
        )
        await this.fetchCacheRelayEventsFromMultipleSources(
          missingPubkeys,
          relayEvents,
          storedForMissing
        )
      } catch {
        /* best-effort */
      } finally {
        this.refreshRelayListsBgInFlight.delete(key)
      }
    })()
  }

  async fetchRelayLists(pubkeys: string[]): Promise<TRelayList[]> {
    if (pubkeys.length === 0) return []

    try {
    const storedRelayEvents = await Promise.all(pubkeys.map((pk) => this.getKind10002FromIdbOrSession(pk)))
    const storedCacheRelayEvents = await Promise.all(
      pubkeys.map((pubkey) => indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS))
    )
    const storedHttpRelayEvents = await Promise.all(
      pubkeys.map((pubkey) => indexedDb.getReplaceableEvent(pubkey, ExtendedKind.HTTP_RELAY_LIST))
    )

    const budgetMs = FETCH_RELAY_LIST_UI_TIMEOUT_MS
    /** True only when *every* pubkey in this batch already has kind 10002 in IDB (not just you). */
    const allHaveKind10002 = pubkeys.every((_, i) => storedRelayEvents[i] != null)

    /**
     * Fill gaps from the network: start from IDB rows, then fetch kind 10002 + 10243 **only for pubkeys
     * missing 10002** (and 10243-only where 10002 exists but HTTP list does not). Avoids re-downloading
     * your relay list on every reply just because the parent author’s 10002 was never cached.
     */
    const hydrateRelayListsFromNetwork = async (): Promise<{
      relayEvents: (NEvent | null | undefined)[]
      httpRelayEvents: (NEvent | null | undefined)[]
      cacheRelayEvents: (NEvent | null | undefined)[]
    }> => {
      const relayEvents: (NEvent | null | undefined)[] = pubkeys.map((_, i) =>
        storedRelayEvents[i] != null ? (storedRelayEvents[i] as NEvent) : undefined
      )
      const httpRelayEvents: (NEvent | null | undefined)[] = pubkeys.map((_, i) =>
        storedHttpRelayEvents[i] != null ? (storedHttpRelayEvents[i] as NEvent) : undefined
      )

      const missing10002Pubkeys = pubkeys.filter((_pk, i) => storedRelayEvents[i] == null)
      if (missing10002Pubkeys.length > 0) {
        const [relFetched, httpFetched] = await Promise.all([
          this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(
            missing10002Pubkeys,
            kinds.RelayList
          ),
          this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(
            missing10002Pubkeys,
            ExtendedKind.HTTP_RELAY_LIST
          )
        ])
        let j = 0
        for (let i = 0; i < pubkeys.length; i++) {
          if (storedRelayEvents[i] == null) {
            relayEvents[i] = relFetched[j] ?? undefined
            httpRelayEvents[i] = httpFetched[j] ?? undefined
            j++
          }
        }
      }

      const missingHttpOnlyPubkeys = pubkeys.filter(
        (_pk, i) => storedRelayEvents[i] != null && storedHttpRelayEvents[i] == null
      )
      if (missingHttpOnlyPubkeys.length > 0) {
        const httpOnlyFetched =
          await this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(
            missingHttpOnlyPubkeys,
            ExtendedKind.HTTP_RELAY_LIST
          )
        let j = 0
        for (let i = 0; i < pubkeys.length; i++) {
          if (storedRelayEvents[i] != null && storedHttpRelayEvents[i] == null) {
            httpRelayEvents[i] = httpOnlyFetched[j] ?? undefined
            j++
          }
        }
      }

      const cacheRelayEvents = await this.fetchCacheRelayEventsFromMultipleSources(
        pubkeys,
        relayEvents,
        storedRelayEvents
      )
      return { relayEvents, httpRelayEvents, cacheRelayEvents }
    }

    if (allHaveKind10002) {
      this.refreshRelayListsFromNetwork(pubkeys, storedRelayEvents)
      const cacheRelayEvents = await Promise.race([
        this.fetchCacheRelayEventsFromMultipleSources(pubkeys, storedRelayEvents, storedRelayEvents),
        new Promise<(NEvent | null | undefined)[]>((resolve) =>
          setTimeout(() => resolve(storedCacheRelayEvents.map((e) => e ?? undefined)), budgetMs)
        )
      ])
      return this.mergeRelayListsBundle(
        pubkeys,
        storedRelayEvents.map((e) => e ?? undefined),
        storedHttpRelayEvents.map((e) => e ?? undefined),
        cacheRelayEvents,
        storedRelayEvents,
        storedHttpRelayEvents,
        storedCacheRelayEvents
      )
    }

    const raced = await Promise.race([
      hydrateRelayListsFromNetwork().catch((err: unknown) => {
        logger.warn('[FetchRelayLists] hydrateRelayListsFromNetwork failed', {
          pubkeyCount: pubkeys.length,
          error: err instanceof Error ? err.message : String(err)
        })
        return null
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs))
    ])
    if (raced != null) {
      this.refreshRelayListsFromNetwork(pubkeys, storedRelayEvents)
      return this.mergeRelayListsBundle(
        pubkeys,
        raced.relayEvents,
        raced.httpRelayEvents,
        raced.cacheRelayEvents,
        storedRelayEvents,
        storedHttpRelayEvents,
        storedCacheRelayEvents
      )
    }

    this.refreshRelayListsFromNetwork(pubkeys, storedRelayEvents)
    const now = Date.now()
    if (now - fetchRelayListBudgetWarnLastMs >= FETCH_RELAY_LIST_BUDGET_WARN_MIN_INTERVAL_MS) {
      fetchRelayListBudgetWarnLastMs = now
      logger.warn(
        '[FetchRelayLists] Network relay-list fetch exceeded budget; using IndexedDB / empty network layer only',
        { pubkeyCount: pubkeys.length }
      )
    }
    const cacheRelayEvents = storedCacheRelayEvents.map((e) => e ?? undefined)
    return this.mergeRelayListsBundle(
      pubkeys,
      pubkeys.map(() => undefined),
      pubkeys.map(() => undefined),
      cacheRelayEvents,
      storedRelayEvents,
      storedHttpRelayEvents,
      storedCacheRelayEvents
    )
    } catch (err: unknown) {
      logger.warn('[FetchRelayLists] Unexpected failure; using IndexedDB / defaults', {
        pubkeyCount: pubkeys.length,
        error: err instanceof Error ? err.message : String(err)
      })
      try {
        return await this.mergeRelayListsFromStoredOnly(pubkeys)
      } catch {
        const read = PROFILE_RELAY_URLS
        const write = PROFILE_RELAY_URLS
        return pubkeys.map(() => ({
          write,
          read,
          originalRelays: syntheticOriginalRelaysFromReadWrite(read, write),
          httpRead: [] as string[],
          httpWrite: [] as string[],
          httpOriginalRelays: [] as TMailboxRelay[]
        }))
      }
    }
  }

  async forceUpdateRelayListEvent(pubkey: string) {
    await this.replaceableEventService.fetchReplaceableEvent(pubkey, kinds.RelayList)
  }

  /**
   * Fetch cache relay events (kind 10432) from multiple sources:
   * - PROFILE_RELAY_URLS
   * - User's inboxes (read relays from kind 10002)
   * - User's outboxes (write relays from kind 10002)
   */
  private async fetchCacheRelayEventsFromMultipleSources(
    pubkeys: string[],
    _relayEvents: (NEvent | null | undefined)[],
    _storedRelayEvents: (NEvent | null | undefined)[]
  ): Promise<(NEvent | null | undefined)[]> {
    // Start with events from IndexedDB
    const storedCacheRelayEvents = await Promise.all(
      pubkeys.map(pubkey => indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS))
    )
    
    // Check which pubkeys need fetching (don't have stored cache relay events)
    const pubkeysToFetch = pubkeys.filter((_pubkey, index) => !storedCacheRelayEvents[index])
    
    if (pubkeysToFetch.length === 0) {
      return storedCacheRelayEvents
    }

    const cacheRelayEvents = await Promise.race([
      this.replaceableEventService.fetchReplaceableEventsFromProfileFetchRelays(
        pubkeysToFetch,
        ExtendedKind.CACHE_RELAYS
      ),
      new Promise<(NEvent | undefined)[]>((resolve) =>
        setTimeout(
          () => resolve(pubkeysToFetch.map(() => undefined)),
          PUBLISH_RELAY_LIST_RESOLUTION_TIMEOUT_MS
        )
      )
    ])

    // Map results back to original pubkey order
    return pubkeys.map((pubkey, index) => {
      const storedCacheEvent = storedCacheRelayEvents[index]
      if (storedCacheEvent) return storedCacheEvent

      const fetchIndex = pubkeysToFetch.indexOf(pubkey)
      return fetchIndex >= 0 ? cacheRelayEvents[fetchIndex] : null
    })
  }

  async updateRelayListCache(event: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(event)
  }


  /** =========== Replaceable event =========== */

  // Delegate to ReplaceableEventService. Pass relayUrls for fallback (user write + search relays).
  async fetchFollowListEvent(pubkey: string, relayUrls?: string[]) {
    return this.replaceableEventService.fetchFollowListEvent(pubkey, relayUrls)
  }

  async fetchFollowings(pubkey: string): Promise<string[]> {
    return this.replaceableEventService.fetchFollowings(pubkey)
  }

  async updateFollowListCache(evt: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async fetchMuteListEvent(pubkey: string) {
    return this.replaceableEventService.fetchMuteListEvent(pubkey)
  }

  async fetchBookmarkListEvent(pubkey: string) {
    return this.replaceableEventService.fetchBookmarkListEvent(pubkey)
  }

  async fetchBlossomServerListEvent(pubkey: string) {
    return this.replaceableEventService.fetchBlossomServerListEvent(pubkey)
  }

  async fetchBlossomServerList(pubkey: string): Promise<string[]> {
    return this.replaceableEventService.fetchBlossomServerList(pubkey)
  }

  async updateBlossomServerListEventCache(evt: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async fetchInterestListEvent(pubkey: string) {
    return this.replaceableEventService.fetchInterestListEvent(pubkey)
  }

  async fetchPinListEvent(pubkey: string) {
    return this.replaceableEventService.fetchPinListEvent(pubkey)
  }

  async fetchPaymentInfoEvent(pubkey: string) {
    return this.replaceableEventService.fetchPaymentInfoEvent(pubkey)
  }

  /** NIP-38 user status for `d` = `general`, `music`, etc. */
  async fetchUserStatusEvent(pubkey: string, statusType: string) {
    return this.replaceableEventService.fetchReplaceableEvent(
      pubkey,
      ExtendedKind.USER_STATUS,
      statusType.trim()
    )
  }

  getCachedUserStatusEvent(pubkey: string, statusType: string) {
    return this.replaceableEventService.getCachedUserStatusEvent(pubkey, statusType)
  }

  async updateUserStatusCache(evt: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async updatePaymentInfoCache(evt: NEvent) {
    await this.replaceableEventService.updateReplaceableEventCache(evt)
  }

  async forceRefreshProfileAndPaymentInfoCache(pubkey: string): Promise<void> {
    return this.replaceableEventService.forceRefreshProfileAndPaymentInfoCache(pubkey)
  }

  /**
   * Resolve `a` tags (kind:pubkey:d) pointing at kind 30030 emoji packs into events.
   */
  async fetchEmojiSetEvents(pointers: string[]): Promise<NEvent[]> {
    if (!pointers?.length) return []
    const tasks = pointers.map(async (coord) => {
      const parts = coord.split(':')
      if (parts.length < 3) return null
      const kind = parseInt(parts[0]!, 10)
      const authorPk = parts[1]?.trim().toLowerCase()
      if (!authorPk || Number.isNaN(kind)) return null
      const d = parts.slice(2).join(':')
      try {
        return (await this.replaceableEventService.fetchReplaceableEvent(authorPk, kind, d)) ?? null
      } catch {
        return null
      }
    })
    const settled = await Promise.all(tasks)
    return settled.filter((ev): ev is NEvent => Boolean(ev))
  }

  /**
   * Kind 10030 (user emoji list) + 30030 (emoji packs) for an author — used to populate the custom emoji picker.
   */
  async fetchAuthorEmojiInventory(pubkey: string): Promise<NEvent[]> {
    const pk = pubkey.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return []
    const relayList = await this.fetchRelayList(pk)
    const urls = dedupeNormalizeRelayUrlsOrdered([
      ...collectWriteOutboxUrlsFromRelayList(relayList),
      ...collectReadInboxUrlsFromRelayList(relayList),
      ...FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u),
      ...PROFILE_RELAY_URLS.map((u) => normalizeUrl(u) || u)
    ]).filter(Boolean)
    const capped = urls.slice(0, 20)
    if (capped.length === 0) return []
    return this.fetchEvents(
      capped,
      {
        kinds: [kinds.Metadata, kinds.UserEmojiList, kinds.Emojisets],
        authors: [pk],
        limit: 120
      },
      {
        /** Must survive note-panel / search {@link interruptBackgroundQueries} — custom emoji images go blank when aborted. */
        foreground: true
      }
    )
  }

  /** =========== Following favorite relays =========== */


  // Delegate to ReplaceableEventService
  async fetchFollowingFavoriteRelays(pubkey: string): Promise<[string, string[]][]> {
    return this.replaceableEventService.fetchFollowingFavoriteRelays(pubkey)
  }

  // ================= Utils =================

  async generateSubRequestsForPubkeys(pubkeys: string[], myPubkey?: string | null) {
    // If many websocket connections are initiated simultaneously, it will be
    // very slow on Safari (for unknown reason)
    if (isSafari()) {
      let urls = [...publicReadRelayFallbackUrls()]
      if (myPubkey) {
        const relayList = await this.fetchRelayList(myPubkey)
        urls = collectReadInboxUrlsFromRelayList(relayList)
          .concat([...publicReadRelayFallbackUrls()])
          .slice(0, 5)
      }
      return [{ urls, filter: { authors: pubkeys } }]
    }

    const relayLists = await this.fetchRelayLists(pubkeys)
    const group: Record<string, Set<string>> = {}
    relayLists.forEach((relayList, index) => {
      relayList.write.slice(0, 4).forEach((url) => {
        if (!group[url]) {
          group[url] = new Set()
        }
        group[url].add(pubkeys[index])
      })
    })

    const relayCount = Object.keys(group).length
    const coveredCount = new Map<string, number>()
    Object.entries(group)
      .sort(([, a], [, b]) => b.size - a.size)
      .forEach(([url, pubkeys]) => {
        if (
          relayCount > 10 &&
          pubkeys.size < 10 &&
          Array.from(pubkeys).every((pubkey) => (coveredCount.get(pubkey) ?? 0) >= 2)
        ) {
          delete group[url]
        } else {
          pubkeys.forEach((pubkey) => {
            coveredCount.set(pubkey, (coveredCount.get(pubkey) ?? 0) + 1)
          })
        }
      })

    return Object.entries(group).map(([url, authors]) => ({
      urls: [url],
      filter: { authors: Array.from(authors) }
    }))
  }

}
const instance = ClientService.getInstance()
export default instance

// Export sub-services for direct access
export const queryService = instance.queryService
export const eventService = instance.eventService
export const replaceableEventService = instance.replaceableEventService
