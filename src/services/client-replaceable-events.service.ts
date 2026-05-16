import {
  ExtendedKind,
  FAST_READ_RELAY_URLS,
  FEED_PROFILE_BATCH_FETCH_TIMEOUT_MS,
  MAX_CONCURRENT_RELAY_CONNECTIONS,
  METADATA_BATCH_AUTHORS_CHUNK,
  METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
  METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS,
  PROFILE_BATCH_NETWORK_LOAD_TIMEOUT_MS,
  PROFILE_RELAY_URLS,
  RECOMMENDED_BLOSSOM_SERVERS
} from '@/constants'
import { kinds, nip19 } from 'nostr-tools'
import type { Event as NEvent, Filter } from 'nostr-tools'
import DataLoader from 'dataloader'
import { isHttpRelayUrl, isWebsocketUrl, normalizeAnyRelayUrl, normalizeHttpUrl, normalizeUrl } from '@/lib/url'
import { getProfileFromEvent, getRelayListFromEvent } from '@/lib/event-metadata'
import { formatPubkey, pubkeyToNpub, userIdToPubkey } from '@/lib/pubkey'
import { getPubkeysFromPTags, getServersFromServerTags } from '@/lib/tag'
import { TProfile } from '@/types'
import { LRUCache } from 'lru-cache'
import indexedDb from './indexed-db.service'
import type { QueryService } from './client-query.service'
import logger from '@/lib/logger'
import client from './client.service'
import {
  buildComprehensiveRelayList,
  buildExploreProfileAndUserRelayList,
  buildProfileAndUserRelayList
} from '@/lib/relay-list-builder'
import { prependAggrNostrLandIfViewerEligible } from '@/lib/nostr-land-relay-eligibility'
import { stripLocalNetworkRelaysForWssReq } from '@/lib/relay-list-sanitize'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { isPromiseTimeoutError, racePromiseWithTimeout } from '@/lib/async-timeout'

export class ReplaceableEventService {
  /** Limits parallel Step 2/3 profile network work (relay list + wide metadata REQ). */
  private static profileFallbackSlotsInUse = 0
  private static profileFallbackWaitQueue: Array<() => void> = []

  private static async acquireProfileFallbackNetworkSlot(): Promise<void> {
    if (ReplaceableEventService.profileFallbackSlotsInUse < MAX_CONCURRENT_RELAY_CONNECTIONS) {
      ReplaceableEventService.profileFallbackSlotsInUse++
      return
    }
    await new Promise<void>((resolve) => {
      ReplaceableEventService.profileFallbackWaitQueue.push(() => {
        ReplaceableEventService.profileFallbackSlotsInUse++
        resolve()
      })
    })
  }

  private static releaseProfileFallbackNetworkSlot(): void {
    ReplaceableEventService.profileFallbackSlotsInUse = Math.max(
      0,
      ReplaceableEventService.profileFallbackSlotsInUse - 1
    )
    const next = ReplaceableEventService.profileFallbackWaitQueue.shift()
    if (next) next()
  }

  /** True when kind 10002 exists locally — {@link client.fetchRelayList} would mostly merge IDB anyway. */
  private static async hasRelayListInLocalCache(pubkey: string): Promise<boolean> {
    try {
      const idb = await indexedDb.getReplaceableEvent(pubkey, kinds.RelayList)
      if (idb && !shouldDropEventOnIngest(idb)) return true
    } catch {
      /* ignore */
    }
    const hits = client.eventService.listSessionEventsAuthoredBy(pubkey, {
      kinds: [kinds.RelayList],
      limit: 1
    })
    const ses = hits[0]
    return Boolean(ses && !shouldDropEventOnIngest(ses))
  }

  private queryService: QueryService
  private onProfileIndexed?: (profileEvent: NEvent) => void | Promise<void>
  private followingFavoriteRelaysCache = new LRUCache<string, Promise<[string, string[]][]>>({
    max: 50,
    ttl: 1000 * 60 * 60
  })
  private replaceableEventFromBigRelaysDataloader: DataLoader<
    { pubkey: string; kind: number },
    NEvent | null,
    string
  >
  private replaceableEventDataLoader: DataLoader<
    { pubkey: string; kind: number; d?: string },
    NEvent | null,
    string
  >

  constructor(queryService: QueryService, onProfileIndexed?: (profileEvent: NEvent) => void | Promise<void>) {
    this.queryService = queryService
    this.onProfileIndexed = onProfileIndexed
    this.replaceableEventFromBigRelaysDataloader = new DataLoader<
      { pubkey: string; kind: number },
      NEvent | null,
      string
    >(
      this.replaceableEventFromBigRelaysBatchLoadFn.bind(this),
      {
        batchScheduleFn: (callback) => setTimeout(callback, 100), // Increased from 50ms to 100ms to better batch rapid scrolling
        maxBatchSize: 200, // Reduced from 500 to prevent overwhelming the system during rapid scrolling
        cacheKeyFn: ({ pubkey, kind }) => `${pubkey}:${kind}`
      }
    )
    this.replaceableEventDataLoader = new DataLoader<
      { pubkey: string; kind: number; d?: string },
      NEvent | null,
      string
    >(
      this.replaceableEventBatchLoadFn.bind(this),
      {
        cacheKeyFn: ({ pubkey, kind, d }) => `${kind}:${pubkey}:${d ?? ''}`
      }
    )
  }


  /**
   * Build comprehensive relay list: author's outboxes + user's inboxes + relay hints + defaults
   * For profiles/metadata: includes user's own relays (read/write/local) + PROFILE_RELAY_URLS
   */
  private async buildComprehensiveRelayListForAuthor(
    authorPubkey: string,
    kind: number,
    relayHints: string[] = [],
    containingEventRelays: string[] = []
  ): Promise<string[]> {
    const userPubkey = client.pubkey
    if (kind === kinds.Metadata) {
      const profileStack = await buildProfileAndUserRelayList(userPubkey)
      const hintLayer = [...relayHints, ...containingEventRelays]
      if (hintLayer.length === 0) return profileStack
      return Array.from(
        new Set([
          ...profileStack,
          ...hintLayer
            .map((u) => normalizeAnyRelayUrl(u) || normalizeUrl(u) || u.trim())
            .filter((u): u is string => !!u && !isHttpRelayUrl(u))
        ])
      )
    }

    const isProfileOrMetadata = kind === kinds.RelayList
    return buildComprehensiveRelayList({
      authorPubkey,
      userPubkey,
      relayHints,
      containingEventRelays,
      includeUserOwnRelays: isProfileOrMetadata,
      includeProfileFetchRelays: isProfileOrMetadata,
      includeFastReadRelays: true,
      includeLocalRelays: true
    })
  }

  /**
   * Fetch replaceable event (profile, relay list, etc.)
   * Uses DataLoader to batch IndexedDB checks and network fetches
   * ALWAYS uses: author's outboxes + user's inboxes + relay hints + defaults
   * For profiles/metadata: includes user's own relays (read/write/local) + PROFILE_RELAY_URLS
   * 
   * @param pubkey - Author's pubkey
   * @param kind - Event kind
   * @param d - Optional d-tag for parameterized replaceable events
   * @param containingEventRelays - Optional relays where a containing event was found (for profiles, might be on same relay as event)
   */
  async fetchReplaceableEvent(
    pubkey: string, 
    kind: number, 
    d?: string,
    containingEventRelays: string[] = []
  ): Promise<NEvent | undefined> {
    try {
      if (kind === kinds.Metadata && !d) {
        const sessionEv = client.eventService.getSessionMetadataForPubkey(pubkey)
        if (sessionEv && !shouldDropEventOnIngest(sessionEv)) {
          this.replaceableEventFromBigRelaysDataloader.prime(
            { pubkey, kind },
            Promise.resolve(sessionEv)
          )
          return sessionEv
        }
      }

      // Kind 3 / NIP-65: IndexedDB + session LRU before DataLoader (newest wins); then background network refresh.
      if (!d && (kind === kinds.Contacts || kind === kinds.RelayList)) {
        let idbEv: NEvent | undefined | null
        try {
          idbEv = await indexedDb.getReplaceableEvent(pubkey, kind, d)
        } catch {
          idbEv = undefined
        }
        const idbOk = idbEv && !shouldDropEventOnIngest(idbEv) ? idbEv : undefined
        const sessionHits = client.eventService.listSessionEventsAuthoredBy(pubkey, {
          kinds: [kind],
          limit: 20
        })
        const ses = sessionHits[0]
        const sesOk = ses && !shouldDropEventOnIngest(ses) ? ses : undefined
        const pick = !idbOk ? sesOk : !sesOk ? idbOk : sesOk.created_at >= idbOk.created_at ? sesOk : idbOk
        if (pick) {
          this.replaceableEventFromBigRelaysDataloader.prime({ pubkey, kind }, Promise.resolve(pick))
          void indexedDb.putReplaceableEvent(pick).catch(() => {})
          void this.refreshInBackground(pubkey, kind, d).catch(() => {})
          return pick
        }
      }

      // If we have containing event relays and this is a profile, we need to use a custom relay list
      // Otherwise, use DataLoader (which batches IndexedDB checks and network fetches)
      let event: NEvent | undefined
      if (containingEventRelays.length > 0 && kind === kinds.Metadata && !d) {
        // For profiles with containing event relays (author's relay list), check IndexedDB first, then query directly
        try {
          const indexedDbCached = await indexedDb.getReplaceableEvent(pubkey, kind, d)
          if (indexedDbCached) {
            // Refresh in background
            this.refreshInBackground(pubkey, kind, d).catch(() => {})
            return indexedDbCached
          }
        } catch (error) {
          logger.warn('[ReplaceableEventService] IndexedDB error', { 
            pubkey, 
            kind, 
            error: error instanceof Error ? error.message : String(error)
          })
        }

        // Not in IndexedDB, fetch from network with custom relay list
        const relayUrls = stripLocalNetworkRelaysForWssReq(
          await this.buildComprehensiveRelayListForAuthor(pubkey, kind, containingEventRelays, [])
        )
        const events = await this.queryService.query(
          relayUrls,
          {
            authors: [pubkey],
            kinds: [kind]
          },
          undefined,
          {
            replaceableRace: kind !== kinds.Metadata,
            eoseTimeout: METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
            globalTimeout: METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS
          }
        )
        const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
        event = sortedEvents.length > 0 ? sortedEvents[0] : undefined
      } else {
        // Use DataLoader for batching (IndexedDB checks and network fetches are batched)
        const loadedEvent = d
          ? await this.replaceableEventDataLoader.load({ pubkey, kind, d })
          : await this.replaceableEventFromBigRelaysDataloader.load({ pubkey, kind })
        event = loadedEvent || undefined
      }
      
      if (event) {
        return event
      }
    } catch (error) {
      // Log errors but don't throw - return undefined so UI can show fallback
      if (kind === kinds.Metadata) {
        logger.error('[ReplaceableEventService] Error fetching profile', { 
          pubkey,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
      } else {
        logger.warn('[ReplaceableEventService] Error fetching replaceable event', {
          pubkey,
          kind,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return undefined
  }
  
  /**
   * Refresh event in background (non-blocking)
   */
  private async refreshInBackground(pubkey: string, kind: number, d?: string): Promise<void> {
    try {
      if (d) {
        await this.replaceableEventDataLoader.load({ pubkey, kind, d })
      } else {
        await this.replaceableEventFromBigRelaysDataloader.load({ pubkey, kind })
      }
    } catch {
      // Ignore errors in background refresh
    }
  }

  /**
   * Batch fetch replaceable events from profile fetch relays.
   * Order: IndexedDB, then session LRU for kind 3 / 10002 gaps, then network.
   */
  async fetchReplaceableEventsFromProfileFetchRelays(pubkeys: string[], kind: number): Promise<(NEvent | undefined)[]> {
    const results: (NEvent | undefined)[] = new Array(pubkeys.length)
    const needsIndexedDb: { pubkey: string; index: number }[] = []

    for (let index = 0; index < pubkeys.length; index++) {
      const pubkey = pubkeys[index]
      if (kind === kinds.Metadata) {
        const sessionEv = client.eventService.getSessionMetadataForPubkey(pubkey)
        if (sessionEv && !shouldDropEventOnIngest(sessionEv)) {
          results[index] = sessionEv
          this.replaceableEventFromBigRelaysDataloader.prime(
            { pubkey, kind },
            Promise.resolve(sessionEv)
          )
          continue
        }
      }
      needsIndexedDb.push({ pubkey, index })
    }

    if (needsIndexedDb.length > 0) {
      try {
        const orderedPubkeys = needsIndexedDb.map((n) => n.pubkey)
        const fromIdb = await indexedDb.getManyReplaceableEvents(orderedPubkeys, kind)
        fromIdb.forEach((event, i) => {
          if (event && !shouldDropEventOnIngest(event)) {
            const slot = needsIndexedDb[i]
            if (slot) results[slot.index] = event
          }
        })
      } catch {
        await Promise.allSettled(
          needsIndexedDb.map(async ({ pubkey, index }) => {
            try {
              const event = await indexedDb.getReplaceableEvent(pubkey, kind)
              if (event && !shouldDropEventOnIngest(event)) {
                results[index] = event
              }
            } catch {
              /* ignore */
            }
          })
        )
      }
    }

    if (needsIndexedDb.length > 0 && (kind === kinds.Contacts || kind === kinds.RelayList)) {
      for (const { pubkey, index } of needsIndexedDb) {
        if (results[index] !== undefined) continue
        const hits = client.eventService.listSessionEventsAuthoredBy(pubkey, {
          kinds: [kind],
          limit: 20
        })
        const ev = hits[0]
        if (ev && !shouldDropEventOnIngest(ev)) {
          results[index] = ev
          this.replaceableEventFromBigRelaysDataloader.prime({ pubkey, kind }, Promise.resolve(ev))
        }
      }
    }

    const stillMissing = needsIndexedDb.filter(({ index }) => results[index] === undefined)
    if (stillMissing.length > 0) {
      let newEvents: (NEvent | Error | null | undefined)[]
      try {
        newEvents = await racePromiseWithTimeout(
          this.replaceableEventFromBigRelaysDataloader.loadMany(
            stillMissing.map(({ pubkey }) => ({ pubkey, kind }))
          ),
          PROFILE_BATCH_NETWORK_LOAD_TIMEOUT_MS,
          'replaceableEventFromBigRelaysDataloader.loadMany'
        )
      } catch (err) {
        // Never throw: a DataLoader/relay error would abort the whole feed profile batch and skip IDB
        // hydration in {@link fetchProfilesForPubkeysBody}. Degrade like timeout — gaps fill from IDB/session below.
        if (isPromiseTimeoutError(err)) {
          logger.warn('[ReplaceableEventService] Profile batch network load timed out', {
            missingCount: stillMissing.length,
            kind
          })
        } else {
          logger.warn('[ReplaceableEventService] Profile batch network load failed', {
            missingCount: stillMissing.length,
            kind,
            error: err instanceof Error ? err.message : String(err)
          })
        }
        newEvents = stillMissing.map(() => undefined)
      }
      newEvents.forEach((event, idx) => {
        if (event && !(event instanceof Error)) {
          const { index } = stillMissing[idx]!
          if (index !== undefined) {
            results[index] = event ?? undefined
          }
        }
      })
    }

    return results
  }

  /**
   * Update replaceable event cache
   */
  async updateReplaceableEventCache(event: NEvent): Promise<void> {
    // Update DataLoader cache and IndexedDB
    await this.updateReplaceableEventFromBigRelaysCache(event)
  }

  /**
   * Clear replaceable event caches
   */
  clearCaches(): void {
    this.replaceableEventFromBigRelaysDataloader.clearAll()
    this.replaceableEventDataLoader.clearAll()
  }

  /**
   * Private: Batch load function for replaceable events from big relays
   * Batches IndexedDB checks first, then only fetches missing events from network
   */
  private async replaceableEventFromBigRelaysBatchLoadFn(
    params: readonly { pubkey: string; kind: number }[]
  ): Promise<(NEvent | null)[]> {
    const results: (NEvent | null)[] = new Array(params.length).fill(null)
    const eventsMap = new Map<string, NEvent>()

    for (let i = 0; i < params.length; i++) {
      const { pubkey, kind } = params[i]
      if (kind !== kinds.Metadata) continue
      const sessionEv = client.eventService.getSessionMetadataForPubkey(pubkey)
      if (sessionEv && !shouldDropEventOnIngest(sessionEv)) {
        results[i] = sessionEv
        eventsMap.set(`${pubkey}:${kind}`, sessionEv)
        this.replaceableEventFromBigRelaysDataloader.prime(
          { pubkey, kind },
          Promise.resolve(sessionEv)
        )
      }
    }

    const idbByKind = new Map<number, { pubkey: string; index: number }[]>()
    params.forEach(({ pubkey, kind }, index) => {
      if (results[index] != null) return
      if (!idbByKind.has(kind)) {
        idbByKind.set(kind, [])
      }
      idbByKind.get(kind)!.push({ pubkey, index })
    })

    const missingParams: { pubkey: string; kind: number; index: number }[] = []

    await Promise.allSettled(
      Array.from(idbByKind.entries()).map(async ([kind, items]) => {
        const pubkeys = items.map((x) => x.pubkey)
        try {
          const indexedDbEvents = await indexedDb.getManyReplaceableEvents(pubkeys, kind)

          items.forEach(({ pubkey, index }, idx) => {
            const event = indexedDbEvents[idx]
            if (event && event !== null) {
              results[index] = event
              eventsMap.set(`${pubkey}:${kind}`, event)
              this.refreshInBackground(pubkey, kind).catch(() => {})
            } else {
              missingParams.push({ pubkey, kind, index })
            }
          })
        } catch (error) {
          logger.warn('[ReplaceableEventService] IndexedDB batch query error', {
            kind,
            error: error instanceof Error ? error.message : String(error)
          })
          for (const { pubkey, index } of items) {
            missingParams.push({ pubkey, kind, index })
          }
        }
      })
    )

    for (let mi = missingParams.length - 1; mi >= 0; mi--) {
      const m = missingParams[mi]!
      if (m.kind !== kinds.Contacts && m.kind !== kinds.RelayList) continue
      const hits = client.eventService.listSessionEventsAuthoredBy(m.pubkey, {
        kinds: [m.kind],
        limit: 20
      })
      const sessionEv = hits[0]
      if (sessionEv && !shouldDropEventOnIngest(sessionEv)) {
        results[m.index] = sessionEv
        eventsMap.set(`${m.pubkey}:${m.kind}`, sessionEv)
        this.replaceableEventFromBigRelaysDataloader.prime(
          { pubkey: m.pubkey, kind: m.kind },
          Promise.resolve(sessionEv)
        )
        missingParams.splice(mi, 1)
      }
    }
    
    // Step 2: Only fetch missing events from network
    if (missingParams.length === 0) {
      return results
    }

    const networkMissing: { pubkey: string; kind: number; index: number }[] = []
    for (const m of missingParams) {
      if (m.kind === kinds.Metadata) {
        const ev = client.eventService.getSessionMetadataForPubkey(m.pubkey)
        if (ev && !shouldDropEventOnIngest(ev)) {
          results[m.index] = ev
          eventsMap.set(`${m.pubkey}:${m.kind}`, ev)
          continue
        }
      }
      networkMissing.push(m)
    }

    if (networkMissing.length > 0) {
    // Group missing params by kind for network fetch
    const missingGroups = new Map<number, { pubkey: string; index: number }[]>()
    networkMissing.forEach(({ pubkey, kind, index }) => {
      if (!missingGroups.has(kind)) {
        missingGroups.set(kind, [])
      }
      missingGroups.get(kind)!.push({ pubkey, index })
    })
    
    await Promise.allSettled(
      Array.from(missingGroups.entries()).map(async ([kind, missingItems]) => {
        const pubkeys = missingItems.map(item => item.pubkey)
        // ALWAYS use comprehensive relay list: author's outboxes + user's inboxes + defaults
        // For profiles/metadata: includes user's own relays (read/write/local) + PROFILE_RELAY_URLS
        // For each pubkey, build comprehensive relay list
        // CRITICAL FIX: For batch fetches, use default relays instead of fetching relay lists for each author
        // Fetching relay lists for hundreds of authors causes infinite loops and browser crashes
        // Use PROFILE_RELAY_URLS + FAST_READ_RELAY_URLS for profiles, or FAST_READ_RELAY_URLS for other kinds.
        // For metadata with a logged-in user, merge defaults with {@link buildComprehensiveRelayList}: inboxes (read),
        // local/cache relays (10432), favorite relays (10012), plus profile + fast read — same idea as favorites feed
        // / inbox-scoped discovery without per-author relay list fetches.
        // Following's Favorites (Explore): kind 10012 batch uses {@link buildExploreProfileAndUserRelayList}
        // (profile + FAST_READ + viewer read/write/local when logged in).
        let relayUrls: string[]
        if (kind === kinds.Metadata) {
          try {
            relayUrls = await buildProfileAndUserRelayList(client.pubkey)
          } catch {
            relayUrls = [...PROFILE_RELAY_URLS]
          }
        } else if (kind === ExtendedKind.FAVORITE_RELAYS) {
          relayUrls = await buildExploreProfileAndUserRelayList(client.pubkey)
        } else if (kind === 10001) {
          // Pin lists (NIP-51): same pitfall as profile media — FAST_READ alone misses aggr / profile mirrors,
          // and 100ms EOSE loses the race when several relays are down.
          relayUrls = Array.from(
            new Set(
              [...PROFILE_RELAY_URLS, ...FAST_READ_RELAY_URLS].map(
                (u) => normalizeUrl(u) || u
              )
            )
          ).filter(Boolean)
        } else if (kind === kinds.Contacts) {
          // Contacts (kind 3): aggregators + profile mirrors + fast read.
          relayUrls = Array.from(
            new Set(
              [...PROFILE_RELAY_URLS, ...FAST_READ_RELAY_URLS].map(
                (u) => normalizeUrl(u) || u
              )
            )
          ).filter(Boolean)
        } else if (kind === kinds.RelayList) {
          // NIP-65 (10002): aggregators + profile mirrors + fast read.
          relayUrls = Array.from(
            new Set(
              [...PROFILE_RELAY_URLS, ...FAST_READ_RELAY_URLS].map(
                (u) => normalizeUrl(u) || u
              )
            )
          ).filter(Boolean)
        } else if (kind === kinds.Mutelist || kind === kinds.BookmarkList) {
          // Mute / bookmark lists: same distribution as contacts; FAST_READ + mirrors.
          relayUrls = Array.from(
            new Set(
              [...PROFILE_RELAY_URLS, ...FAST_READ_RELAY_URLS].map(
                (u) => normalizeUrl(u) || u
              )
            )
          ).filter(Boolean)
        } else if (kind === ExtendedKind.PAYMENT_INFO) {
          // NIP-A3 kind 10133: aggregators + profile mirrors + fast read.
          relayUrls = Array.from(
            new Set(
              [...PROFILE_RELAY_URLS, ...FAST_READ_RELAY_URLS].map(
                (u) => normalizeUrl(u) || u
              )
            )
          ).filter(Boolean)
        } else {
          relayUrls = [...FAST_READ_RELAY_URLS]
        }
        relayUrls = prependAggrNostrLandIfViewerEligible(
          stripLocalNetworkRelaysForWssReq(relayUrls)
        )
        // Contacts + NIP-65 need the same patience as pins/payment: 100ms EOSE loses the race on slow relays
        // and multi-author batches must not use replaceableRace (first EVENT may not be the latest per author).
        const isSlowReplaceableBatch =
          kind === kinds.Metadata ||
          kind === 10001 ||
          kind === ExtendedKind.PAYMENT_INFO ||
          kind === kinds.Contacts ||
          kind === kinds.RelayList ||
          kind === kinds.Mutelist ||
          kind === kinds.BookmarkList
        const multiAuthorBatch = pubkeys.length > 1
        // replaceableRace + default grace closes the REQ shortly after the first EVENT. For batched kind-0
        // (many `authors` in one filter) that stops the subscription while most profiles are still in flight.
        // Kind 0: never race — first relay may answer without Damus/mirrors; wait for EOSE window so the
        // newest metadata across relays is collected (same as multi-author batches).
        const useReplaceableRace =
          kind === kinds.Metadata ? false : !isSlowReplaceableBatch || !multiAuthorBatch
        const queryOpts = {
          replaceableRace: useReplaceableRace,
          eoseTimeout: isSlowReplaceableBatch ? METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS : 100,
          globalTimeout: isSlowReplaceableBatch ? METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS : 2000
        }

        let events: NEvent[]
        if (kind === kinds.Metadata && pubkeys.length > METADATA_BATCH_AUTHORS_CHUNK) {
          const merged: NEvent[] = []
          for (let off = 0; off < missingItems.length; off += METADATA_BATCH_AUTHORS_CHUNK) {
            const slice = missingItems.slice(off, off + METADATA_BATCH_AUTHORS_CHUNK)
            const chunkPubkeys = slice.map((m) => m.pubkey)
            const chunkMulti = chunkPubkeys.length > 1
            const chunkRace =
              kind === kinds.Metadata ? false : !isSlowReplaceableBatch || !chunkMulti
            const evts = await this.queryService.query(
              relayUrls,
              { authors: chunkPubkeys, kinds: [kind] },
              undefined,
              { ...queryOpts, replaceableRace: chunkRace }
            )
            merged.push(...evts)
          }
          events = merged
        } else {
          events = await this.queryService.query(
            relayUrls,
            {
              authors: pubkeys,
              kinds: [kind]
            },
            undefined,
            queryOpts
          )
        }

        // CRITICAL: Limit the number of events processed to prevent memory issues during rapid scrolling
        // If we have too many events, only process the most recent ones per pubkey
        if (events.length > 1000) {
          logger.warn('[ReplaceableEventService] Large batch detected, limiting processing', {
            kind,
            eventCount: events.length,
            pubkeyCount: pubkeys.length
          })
          // Group by pubkey and keep only the most recent event per pubkey
          const eventsByPubkey = new Map<string, NEvent>()
          for (const event of events) {
            const key = `${event.pubkey}:${event.kind}`
            const existing = eventsByPubkey.get(key)
            if (!existing || existing.created_at < event.created_at) {
              eventsByPubkey.set(key, event)
            }
          }
          // Convert back to array, but limit to reasonable size
          const limitedEvents = Array.from(eventsByPubkey.values()).slice(0, 500)
          // Use limited events for processing
          for (const event of limitedEvents) {
            const key = `${event.pubkey}:${event.kind}`
            const existing = eventsMap.get(key)
            if (!existing || existing.created_at < event.created_at) {
              eventsMap.set(key, event)
              // Update results array for this event
              const itemIndex = missingItems.findIndex(item => item.pubkey === event.pubkey)
              if (itemIndex >= 0) {
                const paramIndex = missingItems[itemIndex]!.index
                results[paramIndex] = event
              }
            }
          }
        } else {
          // Normal processing for smaller batches
          for (const event of events) {
            const key = `${event.pubkey}:${event.kind}`
            const existing = eventsMap.get(key)
            if (!existing || existing.created_at < event.created_at) {
              eventsMap.set(key, event)
              // Update results array for this event
              const itemIndex = missingItems.findIndex(item => item.pubkey === event.pubkey)
              if (itemIndex >= 0) {
                const paramIndex = missingItems[itemIndex]!.index
                results[paramIndex] = event
              }
            }
          }
        }

        const idbFill = missingItems.filter(({ index }) => results[index] == null)
        if (idbFill.length > 0) {
          try {
            const order = idbFill.map((m) => m.pubkey)
            const late = await indexedDb.getManyReplaceableEvents(order, kind)
            late.forEach((ev, j) => {
              if (!ev || shouldDropEventOnIngest(ev)) return
              const slot = idbFill[j]
              if (!slot) return
              results[slot.index] = ev
              eventsMap.set(`${slot.pubkey}:${kind}`, ev)
            })
          } catch {
            /* ignore */
          }
        }

      })
    )
    }
    
    // Step 3: Persist hits only. Do not write negative cache rows (`value: null`) — optional kinds
    // (e.g. 10432 cache relays, 10001 pins) are missing for most pubkeys and would flood IndexedDB.
    await Promise.allSettled(
      missingParams.map(async ({ pubkey, kind }) => {
        const key = `${pubkey}:${kind}`
        const event = eventsMap.get(key)
        if (event) {
          await indexedDb.putReplaceableEvent(event)
        }
      })
    )

    return results
  }

  /**
   * Private: Batch load function for replaceable events with d-tag
   */
  private async replaceableEventBatchLoadFn(
    params: readonly { pubkey: string; kind: number; d?: string }[]
  ): Promise<(NEvent | null)[]> {
    const groups = new Map<string, { pubkey: string; kind: number; d?: string }[]>()
    params.forEach(({ pubkey, kind, d }) => {
      const key = `${kind}:${d ?? ''}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push({ pubkey, kind, d })
    })

    const eventsMap = new Map<string, NEvent>()
    await Promise.allSettled(
      Array.from(groups.entries()).map(async ([, items]) => {
        const { kind, d } = items[0]!
        const pubkeys = items.map(item => item.pubkey)
        const relayUrls = FAST_READ_RELAY_URLS

        const filter: Filter = {
          authors: pubkeys,
          kinds: [kind]
        }
        if (d) {
          filter['#d'] = [d]
        }

        const events = await this.queryService.query(relayUrls, filter, undefined, {
          replaceableRace: true,
          eoseTimeout: 100, // Reduced from 200ms for faster early returns
          globalTimeout: 2000 // Reduced from 3000ms to prevent long waits when many relays are slow
        })

        for (const event of events) {
          const eventKey = `${event.pubkey}:${event.kind}:${d ?? ''}`
          const existing = eventsMap.get(eventKey)
          if (!existing || existing.created_at < event.created_at) {
            eventsMap.set(eventKey, event)
          }
        }
      })
    )

    return params.map(({ pubkey, kind, d }) => {
      const eventKey = `${pubkey}:${kind}:${d ?? ''}`
      const event = eventsMap.get(eventKey)
      if (event) {
        void indexedDb.putReplaceableEvent(event)
        return event
      }
      return null
    })
  }

  /**
   * Private: Update cache for replaceable event from big relays
   */
  private async updateReplaceableEventFromBigRelaysCache(event: NEvent): Promise<void> {
    if (!indexedDb.hasReplaceableEventStoreForKind(event.kind)) {
      return
    }
    const d = event.tags.find((t) => t[0] === 'd')?.[1]
    this.replaceableEventFromBigRelaysDataloader.clear({ pubkey: event.pubkey, kind: event.kind })
    this.replaceableEventFromBigRelaysDataloader.prime(
      { pubkey: event.pubkey, kind: event.kind },
      Promise.resolve(event)
    )
    this.replaceableEventDataLoader.clear({ pubkey: event.pubkey, kind: event.kind, d })
    this.replaceableEventDataLoader.prime(
      { pubkey: event.pubkey, kind: event.kind, d },
      Promise.resolve(event)
    )
    try {
      await indexedDb.putReplaceableEvent(event)
    } catch {
      // Tombstone or validation — in-memory loaders still primed for this session
    }
  }

  /**
   * =========== Profile Methods ===========
   */

  /** Direct kind-0 REQ on {@link PROFILE_RELAY_URLS} by `authors` (npub / hex lookup — not NIP-50 text). */
  private async fetchKind0FromProfileRelays(pubkey: string): Promise<NEvent | undefined> {
    const pk = pubkey.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return undefined

    const relays = prependAggrNostrLandIfViewerEligible(
      stripLocalNetworkRelaysForWssReq(
        Array.from(
          new Set(PROFILE_RELAY_URLS.map((u) => normalizeUrl(u) || u.trim()).filter(Boolean))
        )
      )
    )
    if (relays.length === 0) return undefined

    try {
      const events = await this.queryService.query(
        relays,
        { authors: [pk], kinds: [kinds.Metadata], limit: 1 },
        undefined,
        {
          replaceableRace: false,
          eoseTimeout: METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
          globalTimeout: METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS,
          foreground: true,
          relayOpSource: 'ReplaceableEventService.fetchKind0FromProfileRelays'
        }
      )
      if (events.length === 0) return undefined
      const sorted = events.sort((a, b) => b.created_at - a.created_at)
      return sorted[0]
    } catch (error) {
      logger.warn('[ReplaceableEventService] fetchKind0FromProfileRelays failed', {
        pubkey: pk.slice(0, 8),
        error: error instanceof Error ? error.message : String(error)
      })
      return undefined
    }
  }

  /**
   * Fetch profile event by id (hex, npub, nprofile)
   */
  async fetchProfileEvent(id: string, _skipCache: boolean = false): Promise<NEvent | undefined> {
    let pubkey: string | undefined
    let relays: string[] = []
    if (/^[0-9a-f]{64}$/.test(id)) {
      pubkey = id
    } else {
      try {
        const { data, type } = nip19.decode(id)
        switch (type) {
          case 'npub':
            pubkey = data
            break
          case 'nprofile':
            pubkey = data.pubkey
            if (data.relays) relays = data.relays
            break
        }
      } catch (error) {
        logger.error('[ReplaceableEventService] Failed to decode bech32 ID', {
          id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (!pubkey) {
      logger.error('[ReplaceableEventService] Invalid id - no pubkey extracted', { id })
      throw new Error('Invalid id')
    }

    /** Used only when relay steps miss — UI should already show this from {@link useFetchProfile} IDB/session first. */
    let sessionFallback: NEvent | undefined
    if (!_skipCache) {
      const sessionEv = client.eventService.getSessionMetadataForPubkey(pubkey)
      if (sessionEv && !shouldDropEventOnIngest(sessionEv)) {
        this.replaceableEventFromBigRelaysDataloader.prime(
          { pubkey, kind: kinds.Metadata },
          Promise.resolve(sessionEv)
        )
        await this.indexProfile(sessionEv)
        void indexedDb.putReplaceableEvent(sessionEv).catch(() => {})
        sessionFallback = sessionEv
      }
    }

    // Relay hints from bech32 (nprofile, etc.) — highest priority in later steps
    const relayHints = relays.length > 0 ? [...relays] : []

    // Step 0: {@link PROFILE_RELAY_URLS} by `authors` — reliable for npub/hex; avoids batched DataLoader + abort races.
    const fromProfileRelays = await this.fetchKind0FromProfileRelays(pubkey)
    if (fromProfileRelays) {
      this.replaceableEventFromBigRelaysDataloader.prime(
        { pubkey, kind: kinds.Metadata },
        Promise.resolve(fromProfileRelays)
      )
      await this.indexProfile(fromProfileRelays)
      void indexedDb.putReplaceableEvent(fromProfileRelays).catch(() => {})
      return fromProfileRelays
    }

    // Step 1: DataLoader (IndexedDB + batched profile relay stack)
    // CRITICAL: Do NOT pass relay hints here - passing any relays bypasses DataLoader and creates individual subscriptions
    // DataLoader already uses default relays internally and batches all profile fetches
    // We'll use relay hints in Step 2/3 only if Step 1 fails
    // fetchReplaceableEvent uses DataLoader which checks IndexedDB first, then queries default relays
    // Passing empty array ensures DataLoader is used (batched) - this prevents individual subscriptions
    const profileEvent = await this.fetchReplaceableEvent(pubkey, kinds.Metadata, undefined, [])
    
    if (profileEvent) {
      await this.indexProfile(profileEvent)
      return profileEvent
    }

    await ReplaceableEventService.acquireProfileFallbackNetworkSlot()
    try {
    // Step 2: Only after cache + default relays miss — NIP-65 relay list (timeout-capped), then hints + outbox/inbox + defaults.
    let authorRelayList: { read?: string[]; write?: string[] } | null = null
    try {
      const hasLocal10002 = await ReplaceableEventService.hasRelayListInLocalCache(pubkey)
      if (hasLocal10002) {
        authorRelayList = await client.peekRelayListFromStorage(pubkey)
      } else {
        const relayListPromise = client.fetchRelayList(pubkey)
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => {
            resolve(null)
          }, 2800)
        })
        authorRelayList = await Promise.race([relayListPromise, timeoutPromise])
        if (authorRelayList == null) {
          authorRelayList = await client.peekRelayListFromStorage(pubkey)
        }
      }
    } catch (error) {
      logger.error('[ReplaceableEventService] Failed to fetch author relay list', {
        pubkey,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    const authorRelays = authorRelayList
      ? [
          ...(authorRelayList.write || []).slice(0, 10),
          ...(authorRelayList.read || []).slice(0, 10)
        ]
      : []

    const expandedRelays = prependAggrNostrLandIfViewerEligible(
      stripLocalNetworkRelaysForWssReq(
        Array.from(
          new Set([
            ...relayHints,
            ...authorRelays,
            ...PROFILE_RELAY_URLS,
            ...FAST_READ_RELAY_URLS
          ])
        )
      )
    )

    const profileFromExpanded = await this.fetchReplaceableEvent(
      pubkey,
      kinds.Metadata,
      undefined,
      expandedRelays
    )
    if (profileFromExpanded) {
      await this.indexProfile(profileFromExpanded)
      return profileFromExpanded
    }

    // Step 3: Last resort — broad relay query (timeout-bounded in query layer)
    try {
      const userPubkey = client.pubkey
      const comprehensiveRelays = await buildComprehensiveRelayList({
        authorPubkey: pubkey,
        userPubkey: userPubkey || undefined,
        relayHints: relayHints.length > 0 ? relayHints : undefined,
        includeUserOwnRelays: true,
        includeFavoriteRelays: true,
        includeProfileFetchRelays: true,
        includeFastReadRelays: true,
        includeFastWriteRelays: false,
        includeSearchableRelays: true,
        includeLocalRelays: true
      })

      if (comprehensiveRelays.length > 0) {
        const relaysForQuery = prependAggrNostrLandIfViewerEligible(
          stripLocalNetworkRelaysForWssReq(comprehensiveRelays)
        )
        const events = await this.queryService.query(
          relaysForQuery,
          {
            authors: [pubkey],
            kinds: [kinds.Metadata]
          },
          undefined,
          {
            replaceableRace: false,
            eoseTimeout: METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
            globalTimeout: METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS,
            foreground: true
          }
        )

        if (events.length > 0) {
          const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
          const found = sortedEvents[0]!
          await this.indexProfile(found)
          return found
        }
      }
    } catch (error) {
      logger.error('[ReplaceableEventService] Comprehensive search failed', {
        pubkey,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    } finally {
      ReplaceableEventService.releaseProfileFallbackNetworkSlot()
    }

    return sessionFallback
  }

  /**
   * Fetch profile by id (hex, npub, nprofile)
   */
  async fetchProfile(id: string, skipCache: boolean = false): Promise<TProfile | undefined> {
    const profileEvent = await this.fetchProfileEvent(id, skipCache)
    if (profileEvent) {
      return getProfileFromEvent(profileEvent)
    }

    try {
      const pubkey = userIdToPubkey(id)
      return { pubkey, npub: pubkeyToNpub(pubkey) ?? '', username: formatPubkey(pubkey) }
    } catch {
      return undefined
    }
  }

  /**
   * Get profile from IndexedDB only
   */
  async getProfileFromIndexedDB(id: string): Promise<TProfile | undefined> {
    let pubkey: string | undefined
    try {
      if (/^[0-9a-f]{64}$/.test(id)) {
        pubkey = id
      } else {
        const { data, type } = nip19.decode(id)
        if (type === 'npub') pubkey = data
        else if (type === 'nprofile') pubkey = data.pubkey
      }
    } catch {
      return undefined
    }
    if (!pubkey) return undefined
    const event = await indexedDb.getReplaceableEvent(pubkey, kinds.Metadata)
    if (!event || event === null) return undefined
    return getProfileFromEvent(event)
  }

  /** Fetch profiles for multiple pubkeys (profile mirrors + viewer's own relays only). */
  async fetchProfilesForPubkeys(pubkeys: string[]): Promise<TProfile[]> {
    const deduped = Array.from(new Set(pubkeys.filter((p) => p && p.length === 64)))
    if (deduped.length === 0) return []
    try {
      return await racePromiseWithTimeout(
        this.fetchProfilesForPubkeysBody(deduped),
        FEED_PROFILE_BATCH_FETCH_TIMEOUT_MS,
        'fetchProfilesForPubkeys'
      )
    } catch (err) {
      if (isPromiseTimeoutError(err)) {
        logger.warn('[ReplaceableEventService] fetchProfilesForPubkeys exceeded wall timeout', {
          pubkeyCount: deduped.length
        })
      } else {
        logger.warn('[ReplaceableEventService] fetchProfilesForPubkeys failed; using session / IndexedDB only', {
          pubkeyCount: deduped.length,
          error: err instanceof Error ? err.message : String(err)
        })
      }
      return this.fetchProfilesForPubkeysLocalFallback(deduped)
    }
  }

  private async fetchProfilesForPubkeysLocalFallback(pubkeys: string[]): Promise<TProfile[]> {
    const events: (NEvent | undefined)[] = []
    for (const pubkey of pubkeys) {
      const pkLower = pubkey.toLowerCase()
      let ev: NEvent | undefined = client.eventService.getSessionMetadataForPubkey(pkLower)
      if (ev && shouldDropEventOnIngest(ev)) ev = undefined
      if (!ev) {
        try {
          const row = await indexedDb.getReplaceableEvent(pkLower, kinds.Metadata)
          if (row && !shouldDropEventOnIngest(row)) ev = row as NEvent
        } catch {
          /* ignore */
        }
      }
      events.push(ev)
    }
    return this.profilesFromMetadataEvents(pubkeys, events)
  }

  private async profilesFromMetadataEvents(
    pubkeys: string[],
    events: (NEvent | undefined)[]
  ): Promise<TProfile[]> {
    const profiles: TProfile[] = []
    for (let i = 0; i < pubkeys.length; i++) {
      const ev = events[i]
      if (ev) {
        await this.indexProfile(ev)
        profiles.push(getProfileFromEvent(ev))
      } else {
        const pubkey = pubkeys[i]!
        profiles.push({
          pubkey,
          npub: pubkeyToNpub(pubkey) ?? '',
          username: formatPubkey(pubkey),
          batchPlaceholder: true
        })
      }
    }
    return profiles
  }

  private async fetchProfilesForPubkeysBody(deduped: string[]): Promise<TProfile[]> {
    let events = await this.fetchReplaceableEventsFromProfileFetchRelays(deduped, kinds.Metadata)
    const gapIdx: number[] = []
    for (let i = 0; i < deduped.length; i++) {
      if (!events[i]) gapIdx.push(i)
    }
    if (gapIdx.length > 0) {
      try {
        const order = gapIdx.map((i) => deduped[i]!)
        const late = await indexedDb.getManyReplaceableEvents(order, kinds.Metadata)
        const patched = [...events]
        gapIdx.forEach((origIdx, j) => {
          const ev = late[j]
          if (ev && !shouldDropEventOnIngest(ev)) {
            patched[origIdx] = ev
          }
        })
        events = patched
      } catch {
        /* ignore */
      }
    }

    /**
     * Batched kind-0 REQ / DataLoader can miss rows that already exist in session or IndexedDB (ordering,
     * timing, or chunk boundaries). Hydrate gaps from local caches first; only then hit the network.
     */
    const gapIndices: number[] = []
    for (let i = 0; i < deduped.length; i++) {
      if (!events[i]) gapIndices.push(i)
    }
    const LOCAL_GAP_CHUNK = 16
    for (let off = 0; off < gapIndices.length; off += LOCAL_GAP_CHUNK) {
      const slice = gapIndices.slice(off, off + LOCAL_GAP_CHUNK)
      await Promise.allSettled(
        slice.map(async (idx) => {
          const pubkey = deduped[idx]!
          const pkLower = pubkey.toLowerCase()
          let ev: NEvent | undefined = client.eventService.getSessionMetadataForPubkey(pkLower)
          if (ev && shouldDropEventOnIngest(ev)) ev = undefined
          if (!ev) {
            try {
              const row = await indexedDb.getReplaceableEvent(pkLower, kinds.Metadata)
              if (row && !shouldDropEventOnIngest(row)) ev = row as NEvent
            } catch {
              /* ignore */
            }
          }
          if (ev) events[idx] = ev
        })
      )
    }

    return this.profilesFromMetadataEvents(deduped, events)
  }

  /**
   * Index profile for search (calls callback if provided)
   */
  private async indexProfile(profileEvent: NEvent): Promise<void> {
    if (this.onProfileIndexed) {
      await this.onProfileIndexed(profileEvent)
    }
  }

  /**
   * =========== Follow Methods ===========
   */

  /**
   * Fetch follow list event.
   * When relayUrls are provided (e.g. user write + search relays), queries those directly.
   * Otherwise uses the default relay set (PROFILE_RELAY_URLS + FAST_READ).
   */
  /** Hard cap: {@link fetchReplaceableEvent} can otherwise wedge the DataLoader chain when relays never answer. */
  private static readonly FETCH_FOLLOW_LIST_REPLACEABLE_TIMEOUT_MS = 14_000

  async fetchFollowListEvent(pubkey: string, relayUrls?: string[]): Promise<NEvent | undefined> {
    if (relayUrls && relayUrls.length > 0) {
      const normalized = Array.from(
        new Set(relayUrls.map((u) => normalizeUrl(u) || u).filter(Boolean))
      )
      const events = await this.queryService.query(
        normalized,
        { authors: [pubkey], kinds: [kinds.Contacts], limit: 1 },
        undefined,
        { replaceableRace: true, eoseTimeout: 1500, globalTimeout: 8000 }
      )
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
      return latest
    }
    const fromNetwork = await Promise.race([
      this.fetchReplaceableEvent(pubkey, kinds.Contacts),
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), ReplaceableEventService.FETCH_FOLLOW_LIST_REPLACEABLE_TIMEOUT_MS)
      )
    ])
    if (fromNetwork) return fromNetwork
    try {
      const fromIdb = await indexedDb.getReplaceableEvent(pubkey, kinds.Contacts)
      return fromIdb ?? undefined
    } catch {
      return undefined
    }
  }

  /**
   * Fetch followings (pubkeys from follow list)
   */
  async fetchFollowings(pubkey: string): Promise<string[]> {
    const followListEvent = await this.fetchFollowListEvent(pubkey)
    return followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
  }

  /**
   * =========== Specialized Replaceable Event Methods ===========
   */

  /**
   * Fetch mute list event
   */
  async fetchMuteListEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, kinds.Mutelist)
  }

  /**
   * Fetch bookmark list event
   */
  async fetchBookmarkListEvent(pubkey: string): Promise<NEvent | undefined> {
    return this.fetchReplaceableEvent(pubkey, kinds.BookmarkList)
  }

  /**
   * Fetch blossom server list event
   */
  async fetchBlossomServerListEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, ExtendedKind.BLOSSOM_SERVER_LIST)
  }

  /**
   * Fetch blossom server list (URLs)
   */
  async fetchBlossomServerList(pubkey: string): Promise<string[]> {
    const evt = await this.fetchBlossomServerListEvent(pubkey)
    const fromEvent = evt ? getServersFromServerTags(evt.tags) : []
    const seen = new Set<string>()
    const out: string[] = []
    const add = (raw: string) => {
      const n = normalizeHttpUrl(raw)
      if (!n || seen.has(n)) return
      seen.add(n)
      out.push(n)
    }
    fromEvent.forEach(add)
    RECOMMENDED_BLOSSOM_SERVERS.forEach(add)
    return out
  }

  /**
   * Fetch interest list event
   */
  async fetchInterestListEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, 10015)
  }

  /**
   * Fetch pin list event
   */
  async fetchPinListEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, 10001)
  }

  /**
   * Fetch payment info event
   */
  async fetchPaymentInfoEvent(pubkey: string): Promise<NEvent | undefined> {
    return await this.fetchReplaceableEvent(pubkey, ExtendedKind.PAYMENT_INFO)
  }

  /**
   * Force refresh profile and payment info cache
   */
  async forceRefreshProfileAndPaymentInfoCache(pubkey: string): Promise<void> {
    await Promise.all([
      this.fetchReplaceableEvent(pubkey, kinds.Metadata),
      this.fetchReplaceableEvent(pubkey, ExtendedKind.PAYMENT_INFO)
    ])
  }

  /**
   * Profile view: query a wide relay set for the author's published replaceables (kind 0, contacts,
   * NIP-65, mute list, bookmarks, pay, etc.), persist winners to IndexedDB, refresh in-memory loaders,
   * then dispatch `ReplaceableEventService.AUTHOR_REPLACEABLES_REFRESHED_EVENT` so the session can re-sync UI.
   */
  static readonly AUTHOR_REPLACEABLES_REFRESHED_EVENT = 'jumble:author-replaceables-refreshed' as const

  private static readonly PROFILE_VIEW_AUTHOR_REPLACEABLE_KINDS: readonly number[] = [
    kinds.Metadata,
    kinds.Contacts,
    kinds.RelayList,
    kinds.Mutelist,
    kinds.BookmarkList,
    10001, // pins (NIP-51)
    10015, // interests
    ExtendedKind.FAVORITE_RELAYS,
    ExtendedKind.BLOCKED_RELAYS,
    ExtendedKind.BLOSSOM_SERVER_LIST,
    ExtendedKind.PAYMENT_INFO,
    kinds.UserEmojiList,
    ExtendedKind.CACHE_RELAYS,
    ExtendedKind.HTTP_RELAY_LIST,
    ExtendedKind.RSS_FEED_LIST
  ]

  async refreshAuthorPublishedReplaceablesFromRelays(pubkey: string): Promise<void> {
    const pk = pubkey.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return

    await ReplaceableEventService.acquireProfileFallbackNetworkSlot()
    try {
      let relayUrls: string[]
      try {
        relayUrls = await buildComprehensiveRelayList({
          authorPubkey: pk,
          userPubkey: client.pubkey || undefined,
          includeUserOwnRelays: true,
          includeFavoriteRelays: true,
          includeProfileFetchRelays: true,
          includeFastReadRelays: true,
          includeFastWriteRelays: false,
          includeSearchableRelays: true,
          includeLocalRelays: true
        })
      } catch {
        relayUrls = []
      }
      if (relayUrls.length === 0) return

      const events = await this.queryService.query(
        relayUrls,
        { authors: [pk], kinds: [...ReplaceableEventService.PROFILE_VIEW_AUTHOR_REPLACEABLE_KINDS] },
        undefined,
        {
          replaceableRace: false,
          eoseTimeout: 2500,
          globalTimeout: 14_000
        }
      )

      const bestByKind = new Map<number, NEvent>()
      for (const e of events) {
        if (shouldDropEventOnIngest(e)) continue
        const prev = bestByKind.get(e.kind)
        if (!prev || e.created_at > prev.created_at) {
          bestByKind.set(e.kind, e)
        }
      }

      await Promise.allSettled(
        Array.from(bestByKind.values()).map(async (ev) => {
          try {
            await indexedDb.putReplaceableEvent(ev)
          } catch {
            /* tombstone / validation */
          }
          try {
            await this.updateReplaceableEventCache(ev)
          } catch {
            /* ignore */
          }
          if (ev.kind === kinds.Metadata) {
            await this.indexProfile(ev)
          }
        })
      )

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(ReplaceableEventService.AUTHOR_REPLACEABLES_REFRESHED_EVENT, { detail: { pubkey: pk } })
        )
      }
    } finally {
      ReplaceableEventService.releaseProfileFallbackNetworkSlot()
    }
  }

  /**
   * =========== Following Favorite Relays ===========
   */

  /**
   * Fetch following favorite relays
   */
  async fetchFollowingFavoriteRelays(pubkey: string, skipCache = false): Promise<[string, string[]][]> {
    if (!skipCache) {
      const cached = this.followingFavoriteRelaysCache.get(pubkey)
      if (cached) {
        return cached.catch((err: unknown) => {
          this.followingFavoriteRelaysCache.delete(pubkey)
          throw err
        })
      }
    }
    const promise = this._fetchFollowingFavoriteRelays(pubkey).catch((err: unknown) => {
      this.followingFavoriteRelaysCache.delete(pubkey)
      throw err
    })
    this.followingFavoriteRelaysCache.set(pubkey, promise)
    return promise
  }

  private async _fetchFollowingFavoriteRelays(pubkey: string): Promise<[string, string[]][]> {
    const followings = await this.fetchFollowings(pubkey)
    const followingsToProcess = followings.slice(0, 100)
    const [favoriteRelaysEvents, relayListEvents] = await Promise.all([
      this.fetchReplaceableEventsFromProfileFetchRelays(
        followingsToProcess,
        ExtendedKind.FAVORITE_RELAYS
      ),
      this.fetchReplaceableEventsFromProfileFetchRelays(followingsToProcess, kinds.RelayList)
    ])
    // Group by relay URL: Map<relayUrl, Set<pubkey>>
    const relayToUsers = new Map<string, Set<string>>()

    const addFollowingRelay = (followingPk: string, rawUrl: string) => {
      const normalizedUrl =
        (normalizeUrl(rawUrl) || normalizeAnyRelayUrl(rawUrl) || '').trim() || null
      if (!normalizedUrl || !isWebsocketUrl(normalizedUrl)) return
      if (!relayToUsers.has(normalizedUrl)) relayToUsers.set(normalizedUrl, new Set())
      relayToUsers.get(normalizedUrl)!.add(followingPk)
    }

    for (let i = 0; i < followingsToProcess.length; i++) {
      const followingPubkey = followingsToProcess[i]
      if (!followingPubkey) continue

      const favEv = favoriteRelaysEvents[i]
      if (favEv) {
        favEv.tags.forEach(([tagName, tagValue]) => {
          if (!tagValue) return
          if (tagName === 'relay' || tagName === 'r') {
            addFollowingRelay(followingPubkey, tagValue)
          }
        })
      }

      /** NIP-65 kind 10002 — most clients only publish this, not kind 10012 “favorite relays”. */
      const nip65 = relayListEvents[i]
      if (nip65) {
        const rl = getRelayListFromEvent(nip65)
        for (const { url } of rl.originalRelays) {
          addFollowingRelay(followingPubkey, url)
        }
      }
    }

    // Convert to array format: [relayUrl, pubkeys[]]
    const result: [string, string[]][] = []
    for (const [relayUrl, pubkeys] of relayToUsers.entries()) {
      result.push([relayUrl, Array.from(pubkeys)])
    }

    return result
  }
}
