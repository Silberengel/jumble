import { CALENDAR_EVENT_KINDS, ExtendedKind } from '@/constants'

/** Legacy object store names removed in DB migrations (do not re-add to {@link StoreNames}). */
const LEGACY_DELETED_OBJECT_STORES = ['relayInfoEvents', 'spellListSourceEvents'] as const
import {
  publicationCoordinateLookupKeys,
  splitPublicationCoordinate
} from '@/lib/publication-coordinate'
import { tagNameEquals } from '@/lib/tag'
import { TNip66RelayDiscovery, TRelayInfo } from '@/types'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import {
  calendarOccurrenceOverlapsRange,
  getCalendarOccurrenceWindowMs,
  isCalendarEventKind
} from '@/lib/calendar-event'
import { calendarEventHexId, calendarRsvpParentKeyFromEventId } from '@/lib/calendar-rsvp-match'
import {
  getReplaceableCoordinate,
  getReplaceableCoordinateFromEvent,
  isReplaceableEvent,
  normalizeReplaceableCoordinateString,
  replaceableEventDedupeKey
} from '@/lib/event'
import { citationPickerMatchesQuery } from '@/lib/citation-picker-search'
import logger from '@/lib/logger'
import { profileKind0MatchesSearchQuery } from '@/lib/profile-metadata-search'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { isVerifiedPublicationIndex } from '@/lib/publication-index'
import { eventMatchesGeneralSearchQuery } from '@/lib/general-search-text-match'
import { eventMatchesAnyLocalFeedFilter } from '@/lib/feed-local-event-match'
import {
  paymentAttestationIdbRowFromEvent,
  paymentNotificationIdbRowFromEvent,
  type PaymentAttestationIdbRow,
  type PaymentNotificationIdbRow
} from '@/lib/payment-superchat-idb'
import type { Filter } from 'nostr-tools'

/** Hot archive row in {@link StoreNames.EVENT_ARCHIVE}. */
export type TArchivedEventRow = {
  key: string
  value: Event
  addedAt: number
  lastAccessAt: number
  approxBytes: number
  archiveTier: number
}

/** Persisted feed state for cold-start (filter JSON must round-trip). */
export type TTimelinePersistedPayload = {
  refs: [string, number][]
  filter: Record<string, unknown>
  urls: string[]
}

export type TPiperTtsCacheValue = {
  blob: Blob
  mimeType: string
}

type TValue<T = any> = {
  key: string
  value: T | null
  addedAt: number
  masterPublicationKey?: string // For nested publication events, link to master publication
}

/** One matching row from {@link IndexedDbService.searchAllCachedEventsFullText}. */
export type TCachedEventSearchHit = {
  storeName: string
  key: string
  value: Event
  addedAt: number
}

/** Shape check for persisted rows that look like Nostr events (used by cache search and cache browser). */
export function isLikelyCachedNostrEvent(v: unknown): v is Event {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.pubkey === 'string' &&
    o.pubkey.length > 0 &&
    typeof o.kind === 'number' &&
    typeof o.content === 'string' &&
    Array.isArray(o.tags)
  )
}

export const StoreNames = {
  PROFILE_EVENTS: 'profileEvents',
  RELAY_LIST_EVENTS: 'relayListEvents',
  FOLLOW_LIST_EVENTS: 'followListEvents',
  /** NIP-51 follow sets (kind 30000). Key: pubkey:d */
  FOLLOW_SET_EVENTS: 'followSetEvents',
  MUTE_LIST_EVENTS: 'muteListEvents',
  BOOKMARK_LIST_EVENTS: 'bookmarkListEvents',
  /** Imwald kind 19130: thread roots to mirror in notifications. */
  NOTIFICATION_THREAD_FOLLOW_EVENTS: 'notificationThreadFollowEvents',
  /** Imwald kind 19132: thread roots to hide interaction notifications for. */
  NOTIFICATION_THREAD_MUTE_EVENTS: 'notificationThreadMuteEvents',
  PIN_LIST_EVENTS: 'pinListEvents',
  /** NIP-58 profile badges display list (kind 10008). */
  PROFILE_BADGES_LIST_EVENTS: 'profileBadgesListEvents',
  BLOSSOM_SERVER_LIST_EVENTS: 'blossomServerListEvents',
  INTEREST_LIST_EVENTS: 'interestListEvents',
  MUTE_DECRYPTED_TAGS: 'muteDecryptedTags',
  USER_EMOJI_LIST_EVENTS: 'userEmojiListEvents',
  EMOJI_SET_EVENTS: 'emojiSetEvents',
  FAVORITE_RELAYS: 'favoriteRelays',
  BLOCKED_RELAYS_EVENTS: 'blockedRelaysEvents',
  CACHE_RELAYS_EVENTS: 'cacheRelaysEvents',
  /** Kind 10243 HTTPS index relay list (replaceable by pubkey). */
  HTTP_RELAY_LIST_EVENTS: 'httpRelayListEvents',
  RSS_FEED_LIST_EVENTS: 'rssFeedListEvents',
  RSS_FEED_ITEMS: 'rssFeedItems',
  RELAY_SETS: 'relaySets',
  FOLLOWING_FAVORITE_RELAYS: 'followingFavoriteRelays',
  RELAY_INFOS: 'relayInfos',
  PUBLICATION_EVENTS: 'publicationEvents',
  /** NIP-66: cached list of public lively relay URLs (from 30166 discovery). */
  PUBLIC_LIVELY_RELAYS: 'publicLivelyRelays',
  /** NIP-66: per-relay discovery cache (key = relay URL, value = { discovery, cachedAt }). */
  NIP66_DISCOVERY: 'nip66Discovery',
  /** NIP-A3 payment targets (kind 10133). */
  PAYMENT_INFO_EVENTS: 'paymentInfoEvents',
  /** Cached GIF list (parsed from kind 1063 + 1/1111). Key: 'gifList', value: { gifs, cachedAt }. */
  GIF_CACHE: 'gifCache',
  /** App settings (replaces in-memory/localStorage for persisted settings). Key: setting key, value: string. */
  SETTINGS: 'settings',
  /** NIP-A7 spell events (kind 777). Key: event id. */
  SPELL_EVENTS: 'spellEvents',
  /** Tombstone list for deleted events (kind 5). Key: event id or replaceable coordinate. */
  TOMBSTONE_LIST: 'tombstoneList',
  /** NIP-58 badge definitions (kind 30009). Key: pubkey:d */
  BADGE_DEFINITION_EVENTS: 'badgeDefinitionEvents',
  /** Hot timeline / REQ events (non-replaceable kinds not stored elsewhere). Key: event id hex. */
  EVENT_ARCHIVE: 'eventArchive',
  /** Persisted timeline refs + filter for cold-start hydration. Key: {@link ClientService.generateTimelineKey} hash. */
  TIMELINE_STATE: 'timelineState',
  /** Piper / read-aloud WAV blobs keyed by SHA-256 of endpoint + text + speed. */
  PIPER_TTS_CACHE: 'piperTtsCache',
  /** Library kind-30040 index LRU (rotating cache; separate byte/entry budget from EVENT_ARCHIVE). */
  LIBRARY_PUBLICATION_INDEX: 'libraryPublicationIndex',
  /** NIP-52 calendar notes (31922/31923). Key: {@link replaceableEventDedupeKey}. Index: `occurrenceStartMs`. */
  CALENDAR_EVENTS: 'calendarEvents',
  /** NIP-52 calendar RSVPs (31925). Key: event id. Index: `parentCoordinate` (`a` tag). */
  CALENDAR_RSVP_EVENTS: 'calendarRsvpEvents',
  /** Kind 9740 payment notifications. Key: event id. Indexes: recipient, referenced event/coordinate. */
  PAYMENT_NOTIFICATION_EVENTS: 'paymentNotificationEvents',
  /** Kind 9741 payment attestations. Key: event id. Indexes: author (attester), target payment id. */
  PAYMENT_ATTESTATION_EVENTS: 'paymentAttestationEvents'
}

/** Row shape for {@link StoreNames.CALENDAR_EVENTS}. */
export type TCalendarEventCacheRow = {
  key: string
  value: Event
  addedAt: number
  occurrenceStartMs: number
  occurrenceEndExclusiveMs: number
}

/** Row shape for {@link StoreNames.CALENDAR_RSVP_EVENTS}. */
export type TCalendarRsvpCacheRow = {
  key: string
  value: Event
  addedAt: number
  parentCoordinate: string
}

/** Object stores skipped by full-text cache search (blobs, settings, relay metadata, etc.). */
const CACHE_BROWSER_EVENT_SEARCH_EXCLUDED_STORES: ReadonlySet<string> = new Set([
  StoreNames.SETTINGS,
  StoreNames.PIPER_TTS_CACHE,
  StoreNames.LIBRARY_PUBLICATION_INDEX,
  StoreNames.RELAY_INFOS,
  StoreNames.NIP66_DISCOVERY,
  StoreNames.GIF_CACHE,
  StoreNames.TIMELINE_STATE,
  StoreNames.PUBLIC_LIVELY_RELAYS,
  StoreNames.RSS_FEED_ITEMS,
  StoreNames.FOLLOWING_FAVORITE_RELAYS,
  StoreNames.RELAY_SETS,
  StoreNames.MUTE_DECRYPTED_TAGS,
  StoreNames.FAVORITE_RELAYS,
  StoreNames.CALENDAR_EVENTS,
  StoreNames.CALENDAR_RSVP_EVENTS,
  StoreNames.PAYMENT_NOTIFICATION_EVENTS,
  StoreNames.PAYMENT_ATTESTATION_EVENTS
])

/**
 * Replaceable list / profile / spell rows — still persisted for offline boot, but not timeline notes.
 * {@link IndexedDbService.searchAllCachedEventsFullText} only scans {@link FULL_TEXT_NOTE_SEARCH_STORES}.
 */
const REPLACEABLE_METADATA_EVENT_STORES: ReadonlySet<string> = new Set([
  StoreNames.PROFILE_EVENTS,
  StoreNames.RELAY_LIST_EVENTS,
  StoreNames.FOLLOW_LIST_EVENTS,
  StoreNames.FOLLOW_SET_EVENTS,
  StoreNames.MUTE_LIST_EVENTS,
  StoreNames.BOOKMARK_LIST_EVENTS,
  StoreNames.NOTIFICATION_THREAD_FOLLOW_EVENTS,
  StoreNames.NOTIFICATION_THREAD_MUTE_EVENTS,
  StoreNames.PIN_LIST_EVENTS,
  StoreNames.PROFILE_BADGES_LIST_EVENTS,
  StoreNames.INTEREST_LIST_EVENTS,
  StoreNames.BLOSSOM_SERVER_LIST_EVENTS,
  StoreNames.USER_EMOJI_LIST_EVENTS,
  StoreNames.EMOJI_SET_EVENTS,
  StoreNames.FAVORITE_RELAYS,
  StoreNames.BLOCKED_RELAYS_EVENTS,
  StoreNames.CACHE_RELAYS_EVENTS,
  StoreNames.HTTP_RELAY_LIST_EVENTS,
  StoreNames.RSS_FEED_LIST_EVENTS,
  StoreNames.PAYMENT_INFO_EVENTS,
  StoreNames.BADGE_DEFINITION_EVENTS,
  StoreNames.SPELL_EVENTS
])

/** Stores that hold note-like bodies for local full-text search (not NIP-65 / kind-0 list rows). */
const FULL_TEXT_NOTE_SEARCH_STORES: ReadonlySet<string> = new Set([
  StoreNames.EVENT_ARCHIVE,
  StoreNames.PUBLICATION_EVENTS
])

const ARCHIVE_CALENDAR_PURGE_SETTING_KEY = 'archiveCalendarPurgedV37'

/** Schema version we expect. When adding stores or migrations, bump this. */
const DB_VERSION = 40

/** Hint age for profile/payment reads (stale rows still returned; background refresh). */
const PROFILE_AND_PAYMENT_STALE_READ_MS = 5 * 60 * 1000

/** IndexedDB TTL for kind 10133 payment info (matches profile replaceable cache). */
const PAYMENT_INFO_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24

/** Convert IDB request.onerror Event to a proper Error for logging and UI */
function idbEventToError(ev: Parameters<NonNullable<IDBRequest['onerror']>>[0]): Error {
  const request = ev.target as IDBRequest
  const domError = request?.error
  const message = domError?.message ?? 'IndexedDB operation failed'
  return new Error(message)
}

type TLibraryPublicationIndexCacheRow = {
  key: string
  value: Event
  addedAt: number
  lastAccessAt: number
  approxBytes: number
}

/** Create any object stores from {@link StoreNames} that are missing (e.g. after partial upgrades). */
function ensureMissingObjectStores(db: IDBDatabase): void {
  for (const storeName of Object.values(StoreNames)) {
    if (db.objectStoreNames.contains(storeName)) continue
    if (storeName === StoreNames.RSS_FEED_ITEMS) {
      const store = db.createObjectStore(storeName, { keyPath: 'key' })
      store.createIndex('feedUrl', 'feedUrl', { unique: false })
      store.createIndex('pubDate', 'pubDate', { unique: false })
    } else if (storeName === StoreNames.EVENT_ARCHIVE) {
      const store = db.createObjectStore(storeName, { keyPath: 'key' })
      store.createIndex('eviction', ['archiveTier', 'lastAccessAt'], { unique: false })
    } else if (storeName === StoreNames.CALENDAR_EVENTS) {
      const cal = db.createObjectStore(storeName, { keyPath: 'key' })
      cal.createIndex('occurrenceStartMs', 'occurrenceStartMs', { unique: false })
    } else if (storeName === StoreNames.CALENDAR_RSVP_EVENTS) {
      const rsvp = db.createObjectStore(storeName, { keyPath: 'key' })
      rsvp.createIndex('parentCoordinate', 'parentCoordinate', { unique: false })
    } else if (storeName === StoreNames.PAYMENT_NOTIFICATION_EVENTS) {
      const pn = db.createObjectStore(storeName, { keyPath: 'key' })
      pn.createIndex('recipientPubkey', 'recipientPubkey', { unique: false })
      pn.createIndex('referencedEventId', 'referencedEventId', { unique: false })
      pn.createIndex('referencedCoordinate', 'referencedCoordinate', { unique: false })
    } else if (storeName === StoreNames.PAYMENT_ATTESTATION_EVENTS) {
      const pa = db.createObjectStore(storeName, { keyPath: 'key' })
      pa.createIndex('authorPubkey', 'authorPubkey', { unique: false })
      pa.createIndex('targetEventId', 'targetEventId', { unique: false })
    } else if (storeName === StoreNames.LIBRARY_PUBLICATION_INDEX) {
      const lib = db.createObjectStore(storeName, { keyPath: 'key' })
      lib.createIndex('lastAccessAt', 'lastAccessAt', { unique: false })
    } else {
      db.createObjectStore(storeName, { keyPath: 'key' })
    }
  }
}

class IndexedDbService {
  static instance: IndexedDbService
  static getInstance(): IndexedDbService {
    if (!IndexedDbService.instance) {
      IndexedDbService.instance = new IndexedDbService()
      IndexedDbService.instance.init()
    }
    return IndexedDbService.instance
  }

  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null
  /** Browser timer id (DOM `setTimeout` returns a number). */
  private cleanupTimer: number | null = null
  /**
   * Short-lived negative cache for {@link isTombstoned}: most keys are not tombstoned; ingest can probe
   * the same coordinate many times. TTL avoids stale reads if another tab tombstones (eventually).
   */
  private tombstoneNotUntilMs = new Map<string, number>()
  private static readonly TOMBSTONE_NOT_CACHE_TTL_MS = 45_000
  private static readonly TOMBSTONE_NOT_CACHE_MAX = 4096

  private static readonly CLEANUP_INITIAL_DELAY_MS = 60 * 1000
  /** Repeat TTL sweeps on this interval so pruning is not a one-shot. */
  private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.openDb()
    }
    return this.initPromise
  }

  private openDb(): Promise<void> {
    return new Promise<void>((resolve) => {
      const request = window.indexedDB.open('jumble', DB_VERSION)

      request.onerror = (event) => {
        const err = idbEventToError(event)
        const isHigherVersion =
          err.message.includes('higher version') || err.message.includes('version requested')
        if (isHigherVersion) {
          // Stored DB is newer than our DB_VERSION (e.g. other tab or previous deploy). We cannot
          // open with a lower version. Use the existing DB at its version so the app keeps working.
          // When we later bump DB_VERSION and ship new code, users at lower stored version will
          // open with our new version and run onupgradeneeded as usual.
          const probe = window.indexedDB.open('jumble')
          probe.onerror = () => {
            logger.warn('IndexedDB unavailable, running without local cache', err)
            this.db = null
            resolve()
          }
          probe.onsuccess = () => {
            const probeDb = probe.result
            const storedVersion = probeDb.version
            probeDb.close()
            const openWithStored = window.indexedDB.open('jumble', storedVersion)
            openWithStored.onerror = (e) => {
              logger.warn('IndexedDB unavailable, running without local cache', idbEventToError(e))
              this.db = null
              resolve()
            }
            openWithStored.onsuccess = () => {
              this.db = openWithStored.result
              this.scheduleNextCleanUp(IndexedDbService.CLEANUP_INITIAL_DELAY_MS)
              void this.purgeLegacyArchivedCalendarEventsOnce().catch((e) =>
                logger.warn('[IndexedDB] Legacy calendar archive purge failed', { e })
              )
              resolve()
            }
            openWithStored.onupgradeneeded = () => {
              // Should not fire when opening with existing version
            }
          }
          return
        }
        logger.warn('IndexedDB unavailable, running without local cache', err)
        this.db = null
        resolve()
      }

      request.onsuccess = () => {
        this.db = request.result
        this.scheduleNextCleanUp(IndexedDbService.CLEANUP_INITIAL_DELAY_MS)
        void this.purgeLegacyArchivedCalendarEventsOnce().catch((e) =>
          logger.warn('[IndexedDB] Legacy calendar archive purge failed', { e })
        )
        resolve()
      }

      request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result
          for (const legacyName of LEGACY_DELETED_OBJECT_STORES) {
            if (db.objectStoreNames.contains(legacyName)) {
              db.deleteObjectStore(legacyName)
            }
          }
          if (!db.objectStoreNames.contains(StoreNames.PROFILE_EVENTS)) {
            db.createObjectStore(StoreNames.PROFILE_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELAY_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.RELAY_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FOLLOW_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.FOLLOW_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FOLLOW_SET_EVENTS)) {
            db.createObjectStore(StoreNames.FOLLOW_SET_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.MUTE_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.MUTE_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BOOKMARK_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.BOOKMARK_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.NOTIFICATION_THREAD_FOLLOW_EVENTS)) {
            db.createObjectStore(StoreNames.NOTIFICATION_THREAD_FOLLOW_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.NOTIFICATION_THREAD_MUTE_EVENTS)) {
            db.createObjectStore(StoreNames.NOTIFICATION_THREAD_MUTE_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.PIN_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.PIN_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.PROFILE_BADGES_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.PROFILE_BADGES_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.INTEREST_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.INTEREST_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.MUTE_DECRYPTED_TAGS)) {
            db.createObjectStore(StoreNames.MUTE_DECRYPTED_TAGS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FAVORITE_RELAYS)) {
            db.createObjectStore(StoreNames.FAVORITE_RELAYS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BLOCKED_RELAYS_EVENTS)) {
            db.createObjectStore(StoreNames.BLOCKED_RELAYS_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELAY_SETS)) {
            db.createObjectStore(StoreNames.RELAY_SETS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FOLLOWING_FAVORITE_RELAYS)) {
            db.createObjectStore(StoreNames.FOLLOWING_FAVORITE_RELAYS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BLOSSOM_SERVER_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.BLOSSOM_SERVER_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.USER_EMOJI_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.USER_EMOJI_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.EMOJI_SET_EVENTS)) {
            db.createObjectStore(StoreNames.EMOJI_SET_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELAY_INFOS)) {
            db.createObjectStore(StoreNames.RELAY_INFOS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS)) {
            db.createObjectStore(StoreNames.PUBLICATION_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.PUBLIC_LIVELY_RELAYS)) {
            db.createObjectStore(StoreNames.PUBLIC_LIVELY_RELAYS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.NIP66_DISCOVERY)) {
            db.createObjectStore(StoreNames.NIP66_DISCOVERY, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.CACHE_RELAYS_EVENTS)) {
            db.createObjectStore(StoreNames.CACHE_RELAYS_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RSS_FEED_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.RSS_FEED_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RSS_FEED_ITEMS)) {
            const store = db.createObjectStore(StoreNames.RSS_FEED_ITEMS, { keyPath: 'key' })
            store.createIndex('feedUrl', 'feedUrl', { unique: false })
            store.createIndex('pubDate', 'pubDate', { unique: false })
          }
          if (!db.objectStoreNames.contains(StoreNames.PAYMENT_INFO_EVENTS)) {
            db.createObjectStore(StoreNames.PAYMENT_INFO_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.GIF_CACHE)) {
            db.createObjectStore(StoreNames.GIF_CACHE, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.SETTINGS)) {
            db.createObjectStore(StoreNames.SETTINGS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.SPELL_EVENTS)) {
            db.createObjectStore(StoreNames.SPELL_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.TOMBSTONE_LIST)) {
            db.createObjectStore(StoreNames.TOMBSTONE_LIST, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BADGE_DEFINITION_EVENTS)) {
            db.createObjectStore(StoreNames.BADGE_DEFINITION_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) {
            const arc = db.createObjectStore(StoreNames.EVENT_ARCHIVE, { keyPath: 'key' })
            arc.createIndex('eviction', ['archiveTier', 'lastAccessAt'], { unique: false })
          }
          if (!db.objectStoreNames.contains(StoreNames.TIMELINE_STATE)) {
            db.createObjectStore(StoreNames.TIMELINE_STATE, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.PIPER_TTS_CACHE)) {
            db.createObjectStore(StoreNames.PIPER_TTS_CACHE, { keyPath: 'key' })
          }
          if (event.oldVersion < 34) {
            // v34: app-side changes (fetch timeouts, timeline hydrate order, discussion list cap)
          }
          if (event.oldVersion < 35) {
            if (!db.objectStoreNames.contains(StoreNames.CALENDAR_EVENTS)) {
              const cal = db.createObjectStore(StoreNames.CALENDAR_EVENTS, { keyPath: 'key' })
              cal.createIndex('occurrenceStartMs', 'occurrenceStartMs', { unique: false })
            }
            if (!db.objectStoreNames.contains(StoreNames.CALENDAR_RSVP_EVENTS)) {
              const rsvp = db.createObjectStore(StoreNames.CALENDAR_RSVP_EVENTS, { keyPath: 'key' })
              rsvp.createIndex('parentCoordinate', 'parentCoordinate', { unique: false })
            }
          }
          if (event.oldVersion < 37) {
            // v37: drop legacy object stores; calendar notes purged from EVENT_ARCHIVE post-open
          }
          if (event.oldVersion < 39) {
            if (!db.objectStoreNames.contains(StoreNames.PAYMENT_NOTIFICATION_EVENTS)) {
              const pn = db.createObjectStore(StoreNames.PAYMENT_NOTIFICATION_EVENTS, { keyPath: 'key' })
              pn.createIndex('recipientPubkey', 'recipientPubkey', { unique: false })
              pn.createIndex('referencedEventId', 'referencedEventId', { unique: false })
              pn.createIndex('referencedCoordinate', 'referencedCoordinate', { unique: false })
            }
            if (!db.objectStoreNames.contains(StoreNames.PAYMENT_ATTESTATION_EVENTS)) {
              const pa = db.createObjectStore(StoreNames.PAYMENT_ATTESTATION_EVENTS, { keyPath: 'key' })
              pa.createIndex('authorPubkey', 'authorPubkey', { unique: false })
              pa.createIndex('targetEventId', 'targetEventId', { unique: false })
            }
          }
          if (event.oldVersion < 40) {
            if (!db.objectStoreNames.contains(StoreNames.LIBRARY_PUBLICATION_INDEX)) {
              const lib = db.createObjectStore(StoreNames.LIBRARY_PUBLICATION_INDEX, { keyPath: 'key' })
              lib.createIndex('lastAccessAt', 'lastAccessAt', { unique: false })
            }
          }
          ensureMissingObjectStores(db)
        }
      }
    );
  }

  /** Whether {@link putReplaceableEvent} persists this kind (profile, lists, publications, …). */
  hasReplaceableEventStoreForKind(kind: number): boolean {
    return this.getStoreNameByKind(kind) !== undefined
  }

  async putReplaceableEvent(event: Event): Promise<Event> {
    // Check if tombstoned before caching
    const tombstoneKey = isReplaceableEvent(event.kind)
      ? getReplaceableCoordinateFromEvent(event)
      : event.id
    const isTombstoned = await this.isTombstoned(tombstoneKey)
    if (isTombstoned) {
      logger.debug('[IndexedDB] Skipping tombstoned replaceable (not persisted)', {
        tombstoneKey,
        eventId: event.id
      })
      // Optional cache: absence is expected — do not reject (callers would log false-positive failures).
      return event
    }
    
    // Remove relayStatuses before storing (it's metadata for logging, not part of the event)
    const cleanEvent = { ...event }
    delete (cleanEvent as any).relayStatuses
    
    const storeName = this.getStoreNameByKind(cleanEvent.kind)
    if (!storeName) {
      logger.error('[IndexedDB] Store name not found for kind', { kind: cleanEvent.kind })
      return Promise.reject('store name not found')
    }

    await this.initPromise
    
    // Wait a bit for database upgrade to complete if store doesn't exist
    if (this.db && !this.db.objectStoreNames.contains(storeName)) {
      logger.warn('[IndexedDB] Store not found, waiting for database upgrade', { storeName })
      // Wait up to 2 seconds for store to be created (database upgrade)
      let retries = 20
      while (retries > 0 && this.db && !this.db.objectStoreNames.contains(storeName)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        retries--
      }
    }
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(cleanEvent)
      }
      
      // Check if the store exists before trying to access it
      if (!this.db.objectStoreNames.contains(storeName)) {
        logger.error('[IndexedDB] Store not found in database after waiting', {
          storeName,
          kind: cleanEvent.kind,
          availableStores: Array.from(this.db.objectStoreNames),
          dbVersion: this.db.version
        })
        // Return the event anyway (don't reject) - caching is optional
        return resolve(cleanEvent)
      }

      const transaction = this.db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)

      const key = this.getReplaceableEventKeyFromEvent(cleanEvent)

      const getRequest = store.get(key)
      getRequest.onsuccess = () => {
        const oldValue = getRequest.result as TValue<Event> | undefined

        if (oldValue?.value && oldValue.value.created_at > cleanEvent.created_at) {
          logger.debug('[IndexedDB] putReplaceableEvent', {
            storeName,
            key,
            eventId: cleanEvent.id,
            kind: cleanEvent.kind,
            outcome: 'kept_existing_newer_row',
            existingEventId: oldValue.value.id
          })
          transaction.commit()
          return resolve(oldValue.value)
        }

        const putRequest = store.put(this.formatValue(key, cleanEvent))
        putRequest.onsuccess = () => {
          transaction.commit()
          resolve(cleanEvent)
        }

        putRequest.onerror = (ev) => {
          const err = idbEventToError(ev)
          logger.error('[IndexedDB] Error putting event!', {
            storeName,
            key,
            errorMessage: err.message,
            errorName: err.name
          })
          transaction.commit()
          reject(err)
        }
      }

      getRequest.onerror = (ev) => {
        const err = idbEventToError(ev)
        logger.error('[IndexedDB] Error getting existing event', {
          storeName,
          key,
          errorMessage: err.message,
          errorName: err.name
        })
        transaction.commit()
        reject(err)
      }
    })
  }

  async getReplaceableEvent(
    pubkey: string,
    kind: number,
    d?: string
  ): Promise<Event | undefined | null> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) {
      return Promise.reject('store name not found')
    }
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(undefined)
      }
      // Check if the store exists before trying to access it
      if (!this.db.objectStoreNames.contains(storeName)) {
        logger.warn(`Store ${storeName} not found in database. Returning null.`)
        return resolve(null)
      }
      const transaction = this.db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const key = this.getReplaceableEventKey(pubkey, d)
      const request = store.get(key)

      request.onsuccess = () => {
        const row = request.result as TValue<Event> | undefined
        if (!row) {
          transaction.commit()
          return resolve(undefined)
        }
        // Invalidate profile and payment info cache when stale so they refetch regularly
        // BUT: Always return cached profiles even if stale - we'll refresh in background
        // This ensures profiles are always visible, even if slightly outdated
        const isProfileOrPayment = kind === kinds.Metadata || kind === ExtendedKind.PAYMENT_INFO
        if (isProfileOrPayment && row.addedAt && Date.now() - row.addedAt > PROFILE_AND_PAYMENT_STALE_READ_MS) {
          // Profile is stale, but return it anyway - refresh will happen in background
          // This prevents the "no profile" state when cache exists but is just old
        }
        transaction.commit()
        if (!row.value) {
          return resolve(undefined)
        }
        if (row.value.kind !== kind) {
          return resolve(undefined)
        }
        resolve(row.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Get the timestamp when a replaceable event was cached in IndexedDB
   */
  async getReplaceableEventCachedAt(
    pubkey: string,
    kind: number,
    d?: string
  ): Promise<number | undefined> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) {
      return Promise.resolve(undefined)
    }
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(undefined)
      }
      if (!this.db.objectStoreNames.contains(storeName)) {
        return resolve(undefined)
      }
      const transaction = this.db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const key = this.getReplaceableEventKey(pubkey, d)
      const request = store.get(key)

      request.onsuccess = () => {
        const row = request.result as TValue<Event> | undefined
        transaction.commit()
        resolve(row?.addedAt)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getManyReplaceableEvents(
    pubkeys: readonly string[],
    kind: number
  ): Promise<(Event | undefined | null)[]> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) {
      return Promise.reject('store name not found')
    }
    await this.initPromise
    return new Promise<(Event | undefined | null)[]>((resolve) => {
      if (!this.db) {
        return resolve(new Array(pubkeys.length).fill(undefined))
      }
      const transaction = this.db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const events: (Event | null)[] = new Array(pubkeys.length).fill(undefined)
      let count = 0
      pubkeys.forEach((pubkey, i) => {
        const request = store.get(this.getReplaceableEventKey(pubkey))

        request.onsuccess = () => {
          const event = (request.result as TValue<Event | null>)?.value
          if (event || event === null) {
            events[i] = event
          }

          if (++count === pubkeys.length) {
            transaction.commit()
            resolve(events)
          }
        }

        request.onerror = () => {
          if (++count === pubkeys.length) {
            transaction.commit()
            resolve(events)
          }
        }
      })
    })
  }

  /** All cached kind 30030 rows for a pubkey (keys are `pubkey:d`). */
  async getEmojiSetEventsForPubkey(pubkeyHex: string): Promise<Event[]> {
    const pk = pubkeyHex.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return []
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EMOJI_SET_EVENTS)) return []
    const prefix = `${pk}:`
    const range = IDBKeyRange.lowerBound(prefix)
    return new Promise((resolve, reject) => {
      const out: Event[] = []
      const tx = this.db!.transaction(StoreNames.EMOJI_SET_EVENTS, 'readonly')
      const store = tx.objectStore(StoreNames.EMOJI_SET_EVENTS)
      const req = store.openCursor(range)
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor) {
          tx.commit()
          resolve(out)
          return
        }
        const rowKey = String(cursor.key ?? '')
        if (!rowKey.startsWith(prefix)) {
          tx.commit()
          resolve(out)
          return
        }
        const ev = (cursor.value as TValue<Event>)?.value
        if (
          ev &&
          ev.kind === kinds.Emojisets &&
          ev.pubkey.trim().toLowerCase() === pk
        ) {
          out.push(ev)
        }
        cursor.continue()
      }
      req.onerror = () => {
        tx.commit()
        reject(req.error)
      }
    })
  }

  async getMuteDecryptedTags(id: string): Promise<string[][] | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.MUTE_DECRYPTED_TAGS, 'readonly')
      const store = transaction.objectStore(StoreNames.MUTE_DECRYPTED_TAGS)
      const request = store.get(id)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<string[][]>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putMuteDecryptedTags(id: string, tags: string[][]): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.MUTE_DECRYPTED_TAGS, 'readwrite')
      const store = transaction.objectStore(StoreNames.MUTE_DECRYPTED_TAGS)

      const putRequest = store.put(this.formatValue(id, tags))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async deleteMuteDecryptedTags(id: string): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.MUTE_DECRYPTED_TAGS, 'readwrite')
      const store = transaction.objectStore(StoreNames.MUTE_DECRYPTED_TAGS)
      const req = store.delete(id)
      req.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      req.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Scan cached kind-0 rows for pubkey / npub / name / about / NIP-05 in JSON `content`, JSON `nip05`,
   * and every `nip05` tag (see {@link profileKind0MatchesSearchQuery}). Newest replaceable wins per pubkey.
   */
  async searchProfileEventsInCache(query: string, limit: number): Promise<Event[]> {
    const qLower = query.trim().toLowerCase()
    if (!qLower || limit <= 0) return []
    await this.initPromise
    if (!this.db) return []

    return new Promise((resolve, reject) => {
      const byPubkey = new Map<string, Event>()
      const transaction = this.db!.transaction(StoreNames.PROFILE_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.PROFILE_EVENTS)
      const request = store.openCursor()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
        if (!cursor) {
          transaction.commit()
          const list = [...byPubkey.values()].sort((a, b) => b.created_at - a.created_at).slice(0, limit)
          resolve(list)
          return
        }
        const row = cursor.value as TValue<Event>
        const value = row?.value
        if (value && profileKind0MatchesSearchQuery(value, query.trim())) {
          const pk = value.pubkey.toLowerCase()
          const prev = byPubkey.get(pk)
          if (!prev || value.created_at > prev.created_at) {
            byPubkey.set(pk, value)
          }
        }
        cursor.continue()
      }

      request.onerror = () => {
        transaction.commit()
        reject(request.error ?? new Error('searchProfileEventsInCache failed'))
      }
    })
  }

  /**
   * Loads cached kind-0 rows in one synchronous cursor pass (no `await` inside `onsuccess`, which
   * would risk inactive transactions), then invokes `callback` in chunks with `requestAnimationFrame`
   * yields so FlexSearch indexing does not monopolize the main thread.
   */
  async iterateProfileEvents(callback: (event: Event) => void | Promise<void>): Promise<void> {
    await this.initPromise
    if (!this.db) {
      return
    }

    const MAX_PROFILE_EVENTS_ITERATE = 8_000
    let truncated = false

    const events = await new Promise<Event[]>((resolve, reject) => {
      const out: Event[] = []
      const transaction = this.db!.transaction(StoreNames.PROFILE_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.PROFILE_EVENTS)
      const request = store.openCursor()
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
        if (!cursor) {
          resolve(out)
          return
        }
        if (out.length < MAX_PROFILE_EVENTS_ITERATE) {
          const value = (cursor.value as TValue<Event>).value
          if (value) out.push(value)
        } else {
          truncated = true
        }
        cursor.continue()
      }
      request.onerror = () => {
        reject(request.error ?? new Error('iterateProfileEvents: cursor failed'))
      }
    })

    if (truncated) {
      logger.warn('[indexedDb] iterateProfileEvents capped profile row scan', {
        cap: MAX_PROFILE_EVENTS_ITERATE,
        loaded: events.length
      })
    }

    const yieldToMain = () =>
      new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => resolve())
        } else {
          setTimeout(resolve, 0)
        }
      })

    const chunkYieldEvery = 150
    for (let i = 0; i < events.length; i++) {
      await Promise.resolve(callback(events[i]!))
      if (i > 0 && (i + 1) % chunkYieldEvery === 0) {
        await yieldToMain()
      }
    }
  }

  async putFollowingFavoriteRelays(pubkey: string, relays: [string, string[]][]): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.FOLLOWING_FAVORITE_RELAYS, 'readwrite')
      const store = transaction.objectStore(StoreNames.FOLLOWING_FAVORITE_RELAYS)

      const putRequest = store.put(this.formatValue(pubkey, relays))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getFollowingFavoriteRelays(pubkey: string): Promise<[string, string[]][] | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.FOLLOWING_FAVORITE_RELAYS, 'readonly')
      const store = transaction.objectStore(StoreNames.FOLLOWING_FAVORITE_RELAYS)
      const request = store.get(pubkey)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<[string, string[]][]>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putRelayInfo(relayInfo: TRelayInfo): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.RELAY_INFOS, 'readwrite')
      const store = transaction.objectStore(StoreNames.RELAY_INFOS)

      const putRequest = store.put(this.formatValue(relayInfo.url, relayInfo))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getRelayInfo(url: string): Promise<TRelayInfo | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.RELAY_INFOS, 'readonly')
      const store = transaction.objectStore(StoreNames.RELAY_INFOS)
      const request = store.get(url)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<TRelayInfo>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /** NIP-66: cache key for the single public lively relay list entry. */
  private static PUBLIC_LIVELY_CACHE_KEY = 'list'

  async getPublicLivelyRelayUrlsCache(): Promise<{ urls: string[]; cachedAt: number } | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.PUBLIC_LIVELY_RELAYS, 'readonly')
      const store = transaction.objectStore(StoreNames.PUBLIC_LIVELY_RELAYS)
      const request = store.get(IndexedDbService.PUBLIC_LIVELY_CACHE_KEY)
      request.onsuccess = () => {
        transaction.commit()
        const row = request.result as TValue<{ urls: string[]; cachedAt: number }> | undefined
        resolve(row?.value ?? null)
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async setPublicLivelyRelayUrlsCache(urls: string[]): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.PUBLIC_LIVELY_RELAYS, 'readwrite')
      const store = transaction.objectStore(StoreNames.PUBLIC_LIVELY_RELAYS)
      const value = this.formatValue(IndexedDbService.PUBLIC_LIVELY_CACHE_KEY, {
        urls,
        cachedAt: Date.now()
      })
      const putRequest = store.put(value)
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getNip66Discovery(relayUrl: string): Promise<{ discovery: TNip66RelayDiscovery; cachedAt: number } | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null)
      }
      const transaction = this.db.transaction(StoreNames.NIP66_DISCOVERY, 'readonly')
      const store = transaction.objectStore(StoreNames.NIP66_DISCOVERY)
      const request = store.get(relayUrl)
      request.onsuccess = () => {
        transaction.commit()
        const row = request.result as TValue<{ discovery: TNip66RelayDiscovery; cachedAt: number }> | undefined
        resolve(row?.value ?? null)
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async setNip66Discovery(relayUrl: string, discovery: TNip66RelayDiscovery): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve()
      }
      const transaction = this.db.transaction(StoreNames.NIP66_DISCOVERY, 'readwrite')
      const store = transaction.objectStore(StoreNames.NIP66_DISCOVERY)
      const value = this.formatValue(relayUrl, { discovery, cachedAt: Date.now() })
      const putRequest = store.put(value)
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  private getReplaceableEventKeyFromEvent(event: Event): string {
    // Events that are replaceable by pubkey only (no d-tag)
    // PAYMENT_INFO (10133), RSS_FEED_LIST (10895), etc. are in the 10000-20000 range
    if (
      [kinds.Metadata, kinds.Contacts, ExtendedKind.PAYMENT_INFO].includes(event.kind) ||
      (event.kind >= 10000 && event.kind < 20000 && event.kind !== ExtendedKind.PUBLICATION && event.kind !== ExtendedKind.PUBLICATION_CONTENT && event.kind !== ExtendedKind.WIKI_ARTICLE && event.kind !== ExtendedKind.NOSTR_SPECIFICATION && event.kind !== kinds.LongFormArticle)
    ) {
      return this.getReplaceableEventKey(event.pubkey)
    }

    // Publications and their nested content are replaceable by pubkey + d-tag
    const [, d] = event.tags.find(tagNameEquals('d')) ?? []
    return this.getReplaceableEventKey(event.pubkey, d)
  }

  private getReplaceableEventKey(pubkey: string, d?: string): string {
    const trimmed = pubkey.trim()
    const canonPk = /^[0-9a-f]{64}$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed
    return d === undefined ? canonPk : `${canonPk}:${d}`
  }

  private getStoreNameByKind(kind: number): string | undefined {
    switch (kind) {
      case kinds.Metadata:
        return StoreNames.PROFILE_EVENTS
      case kinds.RelayList:
        return StoreNames.RELAY_LIST_EVENTS
      case kinds.Contacts:
        return StoreNames.FOLLOW_LIST_EVENTS
      case ExtendedKind.FOLLOW_SET:
        return StoreNames.FOLLOW_SET_EVENTS
      case kinds.Mutelist:
        return StoreNames.MUTE_LIST_EVENTS
      case kinds.BookmarkList:
        return StoreNames.BOOKMARK_LIST_EVENTS
      case ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST:
        return StoreNames.NOTIFICATION_THREAD_FOLLOW_EVENTS
      case ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST:
        return StoreNames.NOTIFICATION_THREAD_MUTE_EVENTS
      case 10001: // Pin list
        return StoreNames.PIN_LIST_EVENTS
      case ExtendedKind.PROFILE_BADGES_LIST:
      case ExtendedKind.PROFILE_BADGES: // deprecated NIP-58 list (d=profile_badges); same store as 10008
        return StoreNames.PROFILE_BADGES_LIST_EVENTS
      case 10015: // Interest list
        return StoreNames.INTEREST_LIST_EVENTS
      case ExtendedKind.BLOSSOM_SERVER_LIST:
        return StoreNames.BLOSSOM_SERVER_LIST_EVENTS
      case kinds.Relaysets:
        return StoreNames.RELAY_SETS
      case ExtendedKind.FAVORITE_RELAYS:
        return StoreNames.FAVORITE_RELAYS
      case ExtendedKind.BLOCKED_RELAYS:
        return StoreNames.BLOCKED_RELAYS_EVENTS
      case ExtendedKind.CACHE_RELAYS:
        return StoreNames.CACHE_RELAYS_EVENTS
      case ExtendedKind.HTTP_RELAY_LIST:
        return StoreNames.HTTP_RELAY_LIST_EVENTS
      case ExtendedKind.RSS_FEED_LIST:
        return StoreNames.RSS_FEED_LIST_EVENTS
      case kinds.UserEmojiList:
        return StoreNames.USER_EMOJI_LIST_EVENTS
      case kinds.Emojisets:
        return StoreNames.EMOJI_SET_EVENTS
      case ExtendedKind.PAYMENT_INFO:
        return StoreNames.PAYMENT_INFO_EVENTS
      case ExtendedKind.PUBLICATION:
      case ExtendedKind.PUBLICATION_CONTENT:
      case ExtendedKind.WIKI_ARTICLE:
      case ExtendedKind.NOSTR_SPECIFICATION:
      case kinds.LongFormArticle:
        return StoreNames.PUBLICATION_EVENTS
      case ExtendedKind.BADGE_DEFINITION:
        return StoreNames.BADGE_DEFINITION_EVENTS
      default:
        return undefined
    }
  }

  async putPublicationWithNestedEvents(masterEvent: Event, nestedEvents: Event[]): Promise<Event> {
    // Store master publication as replaceable event
    const masterKey = this.getReplaceableEventKeyFromEvent(masterEvent)
    await this.putReplaceableEvent(masterEvent)
    
    // Store nested events, linking them to the master
    for (const nestedEvent of nestedEvents) {
      // Check if this is a replaceable event kind
      if (isReplaceableEvent(nestedEvent.kind)) {
        await this.putReplaceableEventWithMaster(nestedEvent, masterKey)
      } else {
        // For non-replaceable events, store by event ID with master link
        await this.putNonReplaceableEventWithMaster(nestedEvent, masterKey)
      }
    }
    
    return masterEvent
  }

  private async putReplaceableEventWithMaster(event: Event, masterKey: string): Promise<Event> {
    // Remove relayStatuses before storing (it's metadata for logging, not part of the event)
    const cleanEvent = { ...event }
    delete (cleanEvent as any).relayStatuses
    
    const storeName = this.getStoreNameByKind(cleanEvent.kind)
    if (!storeName) {
      return Promise.reject('store name not found')
    }
    await this.initPromise
    
    // Wait a bit for database upgrade to complete if store doesn't exist
    if (this.db && !this.db.objectStoreNames.contains(storeName)) {
      let retries = 20
      while (retries > 0 && this.db && !this.db.objectStoreNames.contains(storeName)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        retries--
      }
    }
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(cleanEvent)
      }
      if (!this.db.objectStoreNames.contains(storeName)) {
        logger.warn(`Store ${storeName} not found in database. Cannot save event.`)
        return resolve(cleanEvent)
      }
      const transaction = this.db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)

      const key = this.getReplaceableEventKeyFromEvent(cleanEvent)
      const getRequest = store.get(key)
      getRequest.onsuccess = () => {
        const oldValue = getRequest.result as TValue<Event> | undefined
        if (oldValue?.value && oldValue.value.created_at > cleanEvent.created_at) {
          // Update master key link even if event is not newer
          if (oldValue.masterPublicationKey !== masterKey) {
            const value = this.formatValue(key, oldValue.value)
            value.masterPublicationKey = masterKey
            store.put(value)
          }
          transaction.commit()
          return resolve(oldValue.value)
        }
        // Store with master key link
        const value = this.formatValue(key, cleanEvent)
        value.masterPublicationKey = masterKey
        const putRequest = store.put(value)
        putRequest.onsuccess = () => {
          transaction.commit()
          resolve(cleanEvent)
        }

        putRequest.onerror = (ev) => {
          transaction.commit()
          reject(idbEventToError(ev))
        }
      }

      getRequest.onerror = (ev) => {
        transaction.commit()
        reject(idbEventToError(ev))
      }
    })
  }

  async putNonReplaceableEventWithMaster(event: Event, masterKey: string): Promise<Event> {
    // For non-replaceable events, store by event ID in publication events store
    const storeName = StoreNames.PUBLICATION_EVENTS
    await this.initPromise
    
    // Wait a bit for database upgrade to complete if store doesn't exist
    if (this.db && !this.db.objectStoreNames.contains(storeName)) {
      let retries = 20
      while (retries > 0 && this.db && !this.db.objectStoreNames.contains(storeName)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        retries--
      }
    }
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(event)
      }
      if (!this.db.objectStoreNames.contains(storeName)) {
        logger.warn(`Store ${storeName} not found in database. Cannot save event.`)
        return resolve(event)
      }
      const transaction = this.db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)

      // For non-replaceable events, use event ID as key
      const key = event.id
      // For non-replaceable events, always update with master key link
      const value = this.formatValue(key, event)
      value.masterPublicationKey = masterKey
      const putRequest = store.put(value)
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve(event)
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getPublicationEvent(coordinate: string): Promise<Event | undefined> {
    // kind:64-hex-pubkey:d (d may contain ':'); try NFC/NFD d variants for cache hits.
    for (const fullCoord of publicationCoordinateLookupKeys(coordinate.trim())) {
      const p = splitPublicationCoordinate(fullCoord)
      if (!p) continue
      const event = await this.getReplaceableEvent(p.pubkey, p.kind, p.d)
      if (event) return event
    }
    return undefined
  }

  async getEventFromPublicationStore(eventId: string): Promise<Event | undefined> {
    // Get event from PUBLICATION_EVENTS store by event ID
    // This is used for non-replaceable events stored as part of publications
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(undefined)
      }
      if (!this.db.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS)) {
        return resolve(undefined)
      }
      const transaction = this.db.transaction(StoreNames.PUBLICATION_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.PUBLICATION_EVENTS)
      const request = store.get(eventId)

      request.onsuccess = () => {
        transaction.commit()
        const result = request.result as TValue<Event> | undefined
        resolve(result?.value || undefined)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Cached long-form / wiki / publication rows for a profile author (same store as {@link putReplaceableEvent} for
   * those kinds). Used to hydrate the profile “Articles and publications” tab before relay SUB results arrive.
   */
  async getCachedPublicationStoreEventsForProfileAuthor(
    pubkeyHex: string,
    allowedKinds: number[],
    limit: number
  ): Promise<Event[]> {
    const pk = pubkeyHex.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk) || allowedKinds.length === 0 || limit <= 0) {
      return []
    }
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS)) {
      return []
    }
    const kindSet = new Set(allowedKinds)
    const max = Math.min(Math.max(limit, 1), 500)
    /** Cursor order is not chronological; scan enough rows then sort newest-first for the tab. */
    const scanBudget = Math.min(12_000, Math.max(800, max * 40))
    const collectCap = Math.min(2000, Math.max(max * 4, max + 50))

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.PUBLICATION_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.PUBLICATION_EVENTS)
      const request = store.openCursor()
      const results: Event[] = []
      let scanned = 0

      request.onsuccess = () => {
        const cursor = (request as IDBRequest<IDBCursorWithValue>).result
        if (!cursor || scanned >= scanBudget) {
          transaction.commit()
          results.sort((a, b) => b.created_at - a.created_at)
          resolve(results.slice(0, max))
          return
        }
        scanned += 1
        const item = cursor.value as TValue<Event> | undefined
        if (item?.value) {
          const event = item.value as Event
          if (kindSet.has(event.kind) && event.pubkey?.toLowerCase() === pk && results.length < collectCap) {
            results.push(event)
          }
        }
        cursor.continue()
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Iterate PUBLICATION_EVENTS and return events whose kind is in allowedKinds and that match the query via
   * {@link eventMatchesGeneralSearchQuery} (id, pubkey, kind, content, tags, kind-0 profile fields). Scans up
   * to `scanBudget` rows and keeps up to `collectCap` matches, then returns the newest `limit` by {@link Event.created_at}.
   */
  async getCachedEventsForSearch(
    query: string,
    limit: number,
    allowedKinds: number[],
    options?: { scanBudget?: number; collectCap?: number }
  ): Promise<Event[]> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS)) {
      return []
    }
    const q = query.trim().toLowerCase()
    if (!q || allowedKinds.length === 0 || limit <= 0) return []

    const kindSet = new Set(allowedKinds)
    const scanBudget = Math.min(Math.max(options?.scanBudget ?? 28_000, 400), 120_000)
    const collectCap = Math.min(
      Math.max(options?.collectCap ?? Math.max(limit * 8, limit + 200, 200), limit),
      12_000
    )

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.PUBLICATION_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.PUBLICATION_EVENTS)
      const request = store.openCursor()
      const results: Event[] = []
      let scanned = 0

      request.onsuccess = () => {
        const cursor = (request as IDBRequest<IDBCursorWithValue>).result
        if (!cursor || scanned >= scanBudget || results.length >= collectCap) {
          transaction.commit()
          results.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
          resolve(results.slice(0, limit))
          return
        }
        scanned += 1
        const item = cursor.value as TValue<Event> | undefined
        if (item?.value) {
          const event = item.value as Event
          if (kindSet.has(event.kind) && eventMatchesGeneralSearchQuery(event, query)) {
            results.push(event)
          }
        }
        cursor.continue()
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Iterate {@link StoreNames.PUBLICATION_EVENTS} and return up to `limit` events whose kind is in `allowedKinds`,
   * newest {@link Event.created_at} first. Used for spell feeds and similar: show cached rows before relay REQ.
   */
  async getCachedPublicationEventsByKinds(
    limit: number,
    allowedKinds: number[],
    options?: { scanBudget?: number }
  ): Promise<Event[]> {
    await this.initPromise
    if (
      !this.db ||
      !this.db.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS) ||
      allowedKinds.length === 0 ||
      limit <= 0
    ) {
      return []
    }
    const kindSet = new Set(allowedKinds)
    const scanBudget = Math.min(Math.max(options?.scanBudget ?? 12_000, 200), 50_000)
    const collectCap = Math.min(4000, Math.max(limit * 4, limit + 80))

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.PUBLICATION_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.PUBLICATION_EVENTS)
      const request = store.openCursor()
      const results: Event[] = []
      let scanned = 0

      request.onsuccess = () => {
        const cursor = (request as IDBRequest<IDBCursorWithValue>).result
        if (!cursor || scanned >= scanBudget || results.length >= collectCap) {
          transaction.commit()
          results.sort((a, b) => b.created_at - a.created_at)
          resolve(results.slice(0, limit))
          return
        }
        scanned += 1
        const item = cursor.value as TValue<Event> | undefined
        if (item?.value) {
          const event = item.value as Event
          if (kindSet.has(event.kind)) {
            results.push(event)
          }
        }
        cursor.continue()
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async scanPublicationEventsByFilters(
    filters: readonly Filter[],
    options: { maxRowsScanned: number; maxMatches: number }
  ): Promise<Event[]> {
    await this.initPromise
    if (
      !this.db ||
      !this.db.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS) ||
      filters.length === 0 ||
      options.maxMatches <= 0
    ) {
      return []
    }
    const maxRows = Math.min(Math.max(options.maxRowsScanned, 1), 50_000)
    const maxMatches = Math.min(Math.max(options.maxMatches, 1), 3000)
    const workingCap = Math.min(4000, Math.max(maxMatches * 8, maxMatches + 80))

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.PUBLICATION_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.PUBLICATION_EVENTS)
      const request = store.openCursor()
      const results: Event[] = []
      let scanned = 0

      request.onsuccess = () => {
        const cursor = (request as IDBRequest<IDBCursorWithValue>).result
        if (!cursor || scanned >= maxRows) {
          transaction.commit()
          results.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
          resolve(results.slice(0, maxMatches))
          return
        }
        scanned += 1
        const item = cursor.value as TValue<Event> | undefined
        const event = item?.value
        if (event && !shouldDropEventOnIngest(event) && eventMatchesAnyLocalFeedFilter(event, filters)) {
          results.push(event)
          if (results.length > workingCap) {
            results.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
            results.length = Math.min(results.length, Math.max(maxMatches * 3, maxMatches + 40))
          }
        }
        cursor.continue()
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Publication store + hot {@link StoreNames.EVENT_ARCHIVE}: events whose kind is allowed and that match the
   * query via {@link eventMatchesGeneralSearchQuery}. Used for local NIP-50-style hits alongside relay search.
   */
  async getCachedAndArchivedEventsMatchingLocalSearch(
    query: string,
    limit: number,
    allowedKinds: number[],
    options?: { archiveScanMaxMs?: number }
  ): Promise<Event[]> {
    const pubCap = Math.min(900, Math.max(limit * 6, limit + 280, 220))
    const fromPub = await this.getCachedEventsForSearch(query, pubCap, allowedKinds, {
      scanBudget: 70_000,
      collectCap: Math.min(10_000, pubCap * 12)
    })
    if (fromPub.length >= pubCap) {
      return fromPub.slice(0, limit)
    }

    const q = query.trim().toLowerCase()
    if (!q || allowedKinds.length === 0) return fromPub.slice(0, limit)

    const kindSet = new Set(allowedKinds)
    const seen = new Set(fromPub.map((e) => e.id))
    const rest: Event[] = []
    const scanStart = Date.now()
    const archiveScanMaxMs = options?.archiveScanMaxMs

    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) {
      return fromPub.slice(0, limit)
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readonly')
      const store = transaction.objectStore(StoreNames.EVENT_ARCHIVE)
      const request = store.openCursor()

      request.onsuccess = () => {
        if (
          archiveScanMaxMs !== undefined &&
          Date.now() - scanStart >= archiveScanMaxMs
        ) {
          transaction.commit()
          resolve()
          return
        }
        const cursor = (request as IDBRequest<IDBCursorWithValue>).result
        if (!cursor || fromPub.length + rest.length >= pubCap) {
          transaction.commit()
          resolve()
          return
        }
        const row = cursor.value as TArchivedEventRow
        const ev = row?.value
        if (ev && kindSet.has(ev.kind) && !seen.has(ev.id) && eventMatchesGeneralSearchQuery(ev, query)) {
          seen.add(ev.id)
          rest.push(ev)
        }
        cursor.continue()
      }

      request.onerror = (e) => {
        transaction.commit()
        reject(idbEventToError(e))
      }
    }).catch((e: unknown) => {
      logger.warn('[indexedDb] getCachedAndArchivedEventsMatchingLocalSearch archive scan failed', { e })
    })

    const merged = [...fromPub, ...rest]
    merged.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
    return merged.slice(0, limit)
  }

  /**
   * Publication store + {@link StoreNames.EVENT_ARCHIVE}: citation kinds (30–33) where the query matches
   * body/title/summary/author and other citation tags via {@link citationPickerMatchesQuery} (not relay NIP-50).
   */
  async getCachedAndArchivedCitationFieldSearch(
    query: string,
    limit: number,
    allowedKinds: number[],
    options?: { archiveScanMaxMs?: number }
  ): Promise<Event[]> {
    await this.initPromise
    const qRaw = query.trim()
    if (!qRaw || allowedKinds.length === 0 || limit <= 0) return []

    const kindSet = new Set(allowedKinds)
    const fromPub: Event[] = []

    if (this.db?.objectStoreNames.contains(StoreNames.PUBLICATION_EVENTS)) {
      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction(StoreNames.PUBLICATION_EVENTS, 'readonly')
        const store = transaction.objectStore(StoreNames.PUBLICATION_EVENTS)
        const request = store.openCursor()

        request.onsuccess = () => {
          const cursor = (request as IDBRequest<IDBCursorWithValue>).result
          if (!cursor || fromPub.length >= limit) {
            transaction.commit()
            resolve()
            return
          }
          const item = cursor.value as TValue<Event> | undefined
          if (item?.value) {
            const event = item.value as Event
            if (kindSet.has(event.kind) && citationPickerMatchesQuery(event, qRaw)) {
              fromPub.push(event)
            }
          }
          cursor.continue()
        }

        request.onerror = (event) => {
          transaction.commit()
          reject(event)
        }
      }).catch((e: unknown) => {
        logger.warn('[indexedDb] getCachedAndArchivedCitationFieldSearch publication scan failed', { e })
      })
    }

    if (fromPub.length >= limit) return fromPub.slice(0, limit)

    const seen = new Set(fromPub.map((e) => e.id))
    const rest: Event[] = []
    const scanStart = Date.now()
    const archiveScanMaxMs = options?.archiveScanMaxMs

    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) {
      return fromPub
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readonly')
      const store = transaction.objectStore(StoreNames.EVENT_ARCHIVE)
      const request = store.openCursor()

      request.onsuccess = () => {
        if (archiveScanMaxMs !== undefined && Date.now() - scanStart >= archiveScanMaxMs) {
          transaction.commit()
          resolve()
          return
        }
        const cursor = (request as IDBRequest<IDBCursorWithValue>).result
        if (!cursor || fromPub.length + rest.length >= limit) {
          transaction.commit()
          resolve()
          return
        }
        const row = cursor.value as TArchivedEventRow
        const ev = row?.value
        if (ev && kindSet.has(ev.kind) && !seen.has(ev.id) && citationPickerMatchesQuery(ev, qRaw)) {
          seen.add(ev.id)
          rest.push(ev)
        }
        cursor.continue()
      }

      request.onerror = (e) => {
        transaction.commit()
        reject(idbEventToError(e))
      }
    }).catch((e: unknown) => {
      logger.warn('[indexedDb] getCachedAndArchivedCitationFieldSearch archive scan failed', { e })
    })

    return [...fromPub, ...rest].slice(0, limit)
  }

  async getPublicationStoreItems(storeName: string): Promise<Array<{ key: string; value: any; addedAt: number; nestedCount?: number }>> {
    // For publication stores, only return master events with nested counts
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return []
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.openCursor()
      
      const masterEvents = new Map<string, { key: string; value: any; addedAt: number; nestedCount: number }>()
      const nestedEvents: Array<{ key: string; masterKey?: string }> = []

      request.onsuccess = () => {
        const cursor = (request as any).result
        if (cursor) {
          const item = cursor.value as TValue<Event>
          const key = cursor.key as string
          
          if (item?.value) {
            const event = item.value as Event
            // Check if this is a master publication (kind 30040) or a nested event
            if (event.kind === ExtendedKind.PUBLICATION && !item.masterPublicationKey) {
              // This is a master publication
              masterEvents.set(key, {
                key,
                value: event,
                addedAt: item.addedAt,
                nestedCount: 0
              })
            } else if (item.masterPublicationKey) {
              // This is a nested event - track it for counting
              nestedEvents.push({
                key,
                masterKey: item.masterPublicationKey
              })
            }
          }
          cursor.continue()
        } else {
          // Count nested events for each master
          nestedEvents.forEach(nested => {
            if (nested.masterKey && masterEvents.has(nested.masterKey)) {
              const master = masterEvents.get(nested.masterKey)!
              master.nestedCount++
            }
          })
          
          transaction.commit()
          resolve(Array.from(masterEvents.values()))
        }
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async deletePublicationAndNestedEvents(pubkey: string, d?: string): Promise<{ deleted: number }> {
    const masterKey = this.getReplaceableEventKey(pubkey, d)
    const storeName = StoreNames.PUBLICATION_EVENTS
    
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return Promise.resolve({ deleted: 0 })
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.openCursor()
      
      const keysToDelete: string[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const value = cursor.value as TValue<Event>
          const key = cursor.key as string
          
          // Delete if it's the master (matches masterKey) or linked to the master (has masterPublicationKey)
          if (key === masterKey || value?.masterPublicationKey === masterKey) {
            keysToDelete.push(key)
          }
          cursor.continue()
        } else {
          // Delete all identified keys
          let deletedCount = 0
          let completedCount = 0

          if (keysToDelete.length === 0) {
            transaction.commit()
            return resolve({ deleted: 0 })
          }

          keysToDelete.forEach(key => {
            const deleteRequest = store.delete(key)
            deleteRequest.onsuccess = () => {
              deletedCount++
              completedCount++
              if (completedCount === keysToDelete.length) {
                transaction.commit()
                resolve({ deleted: deletedCount })
              }
            }
            deleteRequest.onerror = () => {
              completedCount++
              if (completedCount === keysToDelete.length) {
                transaction.commit()
                resolve({ deleted: deletedCount })
              }
            }
          })
        }
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  private formatValue<T>(key: string, value: T): TValue<T> {
    return {
      key,
      value,
      addedAt: Date.now()
    }
  }

  /**
   * Clears every object store in the `jumble` database, including
   * {@link StoreNames.PIPER_TTS_CACHE} (read-aloud / Piper WAV blobs).
   */
  async clearAllCache(): Promise<void> {
    await this.initPromise
    if (!this.db) {
      return
    }

    const allStoreNames = Array.from(this.db.objectStoreNames)
    const transaction = this.db.transaction(allStoreNames, 'readwrite')
    
    const clearResults = await Promise.allSettled(
      allStoreNames.map(storeName => {
        return new Promise<void>((resolve, reject) => {
          const store = transaction.objectStore(storeName)
          const request = store.clear()
          request.onsuccess = () => resolve()
          request.onerror = (event) => reject(event)
        })
      })
    )
    for (let i = 0; i < clearResults.length; i++) {
      const r = clearResults[i]
      if (r?.status === 'rejected') {
        logger.warn('[IndexedDB] clearAllCache failed for store', {
          store: allStoreNames[i],
          error: r.reason
        })
      }
    }
  }

  async getStoreInfo(): Promise<Record<string, number>> {
    await this.initPromise
    if (!this.db) {
      return {}
    }

    const allStoreNames = Array.from(this.db.objectStoreNames)
    if (allStoreNames.length === 0) {
      return {}
    }

    return new Promise((resolve, reject) => {
      const storeInfo: Record<string, number> = {}
      const tx = this.db!.transaction(allStoreNames, 'readonly')
      let pending = allStoreNames.length

      for (const storeName of allStoreNames) {
        const req = tx.objectStore(storeName).count()
        req.onsuccess = () => {
          storeInfo[storeName] = req.result
          pending--
          if (pending === 0) {
            resolve(storeInfo)
          }
        }
        req.onerror = (ev) => {
          reject(idbEventToError(ev))
        }
      }
    })
  }

  async getStoreItems(storeName: string): Promise<TValue<any>[]> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return []
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.getAll()
      
      request.onsuccess = () => {
        transaction.commit()
        resolve(request.result as TValue<any>[])
      }
      
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Full-text scan of note-like IndexedDB rows: {@link StoreNames.EVENT_ARCHIVE} and
   * {@link StoreNames.PUBLICATION_EVENTS} only (not replaceable list / profile / spell stores).
   */
  async searchAllCachedEventsFullText(
    query: string,
    options?: { limit?: number }
  ): Promise<TCachedEventSearchHit[]> {
    await this.initPromise
    const qLower = query.trim().toLowerCase()
    const limit = Math.min(Math.max(options?.limit ?? 400, 1), 2000)
    if (!qLower || !this.db) {
      return []
    }

    const storeNames = Array.from(this.db.objectStoreNames).filter(
      (name) =>
        FULL_TEXT_NOTE_SEARCH_STORES.has(name) &&
        !CACHE_BROWSER_EVENT_SEARCH_EXCLUDED_STORES.has(name) &&
        !REPLACEABLE_METADATA_EVENT_STORES.has(name)
    )
    const results: TCachedEventSearchHit[] = []
    const seen = new Set<string>()

    for (const storeName of storeNames) {
      if (results.length >= limit) break

      try {
        await new Promise<void>((resolve, reject) => {
          if (!this.db!.objectStoreNames.contains(storeName)) {
            resolve()
            return
          }
          const transaction = this.db!.transaction(storeName, 'readonly')
          const store = transaction.objectStore(storeName)
          const cursorReq = store.openCursor()

          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result as IDBCursorWithValue | null
            if (!cursor) {
              transaction.commit()
              resolve()
              return
            }
            if (results.length >= limit) {
              transaction.commit()
              resolve()
              return
            }

            const raw = cursor.value

            if (storeName === StoreNames.EVENT_ARCHIVE) {
              const row = raw as TArchivedEventRow
              if (row?.value && isLikelyCachedNostrEvent(row.value)) {
                const ev = row.value
                if (eventMatchesGeneralSearchQuery(ev, query)) {
                  const dedupeKey = `${storeName}:${row.key}`
                  if (!seen.has(dedupeKey)) {
                    seen.add(dedupeKey)
                    results.push({
                      storeName,
                      key: row.key,
                      value: ev,
                      addedAt: row.addedAt
                    })
                  }
                }
              }
            } else {
              const item = raw as TValue
              if (
                item?.value != null &&
                typeof item.key === 'string' &&
                isLikelyCachedNostrEvent(item.value)
              ) {
                const ev = item.value
                if (eventMatchesGeneralSearchQuery(ev, query)) {
                  const dedupeKey = `${storeName}:${item.key}`
                  if (!seen.has(dedupeKey)) {
                    seen.add(dedupeKey)
                    results.push({
                      storeName,
                      key: item.key,
                      value: ev,
                      addedAt: item.addedAt ?? 0
                    })
                  }
                }
              }
            }

            cursor.continue()
          }

          cursorReq.onerror = (ev) => {
            transaction.commit()
            reject(idbEventToError(ev))
          }
        })
      } catch (e) {
        logger.warn('[IndexedDB] searchAllCachedEventsFullText store failed', { storeName, e })
      }
    }

    results.sort((a, b) => b.addedAt - a.addedAt)
    return results
  }

  /** Remove a replaceable event from cache so the next fetch will load from relays. */
  async invalidateReplaceableEvent(pubkey: string, kind: number, d?: string): Promise<void> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) return
    const key = this.getReplaceableEventKey(pubkey, d)
    await this.deleteStoreItem(storeName, key)
  }

  async deleteStoreItem(storeName: string, key: string): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.delete(key)
      
      request.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /** Clear cached Piper / read-aloud audio blobs. No-op if the store is absent. */
  async clearPiperTtsCache(): Promise<void> {
    await this.clearStore(StoreNames.PIPER_TTS_CACHE)
  }

  async clearStore(storeName: string): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.clear()
      
      request.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async cleanupDuplicateReplaceableEvents(storeName: string): Promise<{ deleted: number; kept: number }> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return { deleted: 0, kept: 0 }
    }

    // Get the kind for this store - only clean up replaceable event stores
    const kind = this.getKindByStoreName(storeName)
    if (!kind || !this.isReplaceableEventKind(kind)) {
      return Promise.reject('Not a replaceable event store')
    }

    // First pass: identify duplicates
    const allItems = await this.getStoreItems(storeName)
    const eventMap = new Map<string, { key: string; event: Event; addedAt: number }>()
    const keysToDelete: string[] = []
    let invalidItemsCount = 0

    for (const item of allItems) {
      if (!item || !item.value) {
        invalidItemsCount++
        continue
      }
      
      // Skip if event doesn't have required fields
      if (!item.value.pubkey || !item.value.kind || !item.value.created_at) {
        invalidItemsCount++
        continue
      }
      
      try {
        const replaceableKey = this.getReplaceableEventKeyFromEvent(item.value)
        const existing = eventMap.get(replaceableKey)
        
        if (!existing || 
            item.value.created_at > existing.event.created_at ||
            (item.value.created_at === existing.event.created_at && 
             item.addedAt > existing.addedAt)) {
          // This event is newer, mark the old one for deletion if it exists
          if (existing) {
            keysToDelete.push(existing.key)
          }
          eventMap.set(replaceableKey, {
            key: item.key,
            event: item.value,
            addedAt: item.addedAt
          })
        } else {
          // This event is older or same, mark it for deletion
          keysToDelete.push(item.key)
        }
      } catch (error) {
        // If we can't generate a replaceable key, skip this item
        logger.warn('Failed to get replaceable key for item', { key: item.key, error })
        invalidItemsCount++
        continue
      }
    }

    // Second pass: delete duplicates
    const totalProcessed = eventMap.size + keysToDelete.length
    const actualKept = eventMap.size
    
    if (keysToDelete.length === 0) {
      // No duplicates found, but verify counts match
      if (totalProcessed + invalidItemsCount !== allItems.length) {
        logger.warn('Count mismatch while cleaning up replaceable events', {
          totalItems: allItems.length,
          processed: totalProcessed,
          invalid: invalidItemsCount
        })
      }
      return Promise.resolve({ deleted: 0, kept: actualKept })
    }

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      
      let deletedCount = 0
      let completedCount = 0

      keysToDelete.forEach(key => {
        const deleteRequest = store.delete(key)
        deleteRequest.onsuccess = () => {
          deletedCount++
          completedCount++
          if (completedCount === keysToDelete.length) {
            transaction.commit()
            const actualKept = eventMap.size
            const totalProcessed = actualKept + deletedCount
            if (totalProcessed + invalidItemsCount !== allItems.length) {
              logger.warn('Count mismatch after deletion', {
                totalItems: allItems.length,
                kept: actualKept,
                deleted: deletedCount,
                invalid: invalidItemsCount
              })
            }
            resolve({ deleted: deletedCount, kept: actualKept })
          }
        }
        deleteRequest.onerror = () => {
          completedCount++
          if (completedCount === keysToDelete.length) {
            transaction.commit()
            const actualKept = eventMap.size
            resolve({ deleted: deletedCount, kept: actualKept })
          }
        }
      })
    })
  }

  private getKindByStoreName(storeName: string): number | undefined {
    // Reverse lookup of getStoreNameByKind
    if (storeName === StoreNames.PROFILE_EVENTS) return kinds.Metadata
    if (storeName === StoreNames.RELAY_LIST_EVENTS) return kinds.RelayList
    if (storeName === StoreNames.FOLLOW_LIST_EVENTS) return kinds.Contacts
    if (storeName === StoreNames.FOLLOW_SET_EVENTS) return ExtendedKind.FOLLOW_SET
    if (storeName === StoreNames.MUTE_LIST_EVENTS) return kinds.Mutelist
    if (storeName === StoreNames.BOOKMARK_LIST_EVENTS) return kinds.BookmarkList
    if (storeName === StoreNames.NOTIFICATION_THREAD_FOLLOW_EVENTS)
      return ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST
    if (storeName === StoreNames.NOTIFICATION_THREAD_MUTE_EVENTS)
      return ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST
    if (storeName === StoreNames.PIN_LIST_EVENTS) return 10001
    if (storeName === StoreNames.PROFILE_BADGES_LIST_EVENTS) return ExtendedKind.PROFILE_BADGES_LIST
    if (storeName === StoreNames.INTEREST_LIST_EVENTS) return 10015
    if (storeName === StoreNames.BLOSSOM_SERVER_LIST_EVENTS) return ExtendedKind.BLOSSOM_SERVER_LIST
    if (storeName === StoreNames.RELAY_SETS) return kinds.Relaysets
    if (storeName === StoreNames.FAVORITE_RELAYS) return ExtendedKind.FAVORITE_RELAYS
    if (storeName === StoreNames.BLOCKED_RELAYS_EVENTS) return ExtendedKind.BLOCKED_RELAYS
      if (storeName === StoreNames.CACHE_RELAYS_EVENTS) return ExtendedKind.CACHE_RELAYS
      if (storeName === StoreNames.HTTP_RELAY_LIST_EVENTS) return ExtendedKind.HTTP_RELAY_LIST
      if (storeName === StoreNames.RSS_FEED_LIST_EVENTS) return ExtendedKind.RSS_FEED_LIST
      if (storeName === StoreNames.USER_EMOJI_LIST_EVENTS) return kinds.UserEmojiList
      if (storeName === StoreNames.EMOJI_SET_EVENTS) return kinds.Emojisets
      if (storeName === StoreNames.PAYMENT_INFO_EVENTS) return ExtendedKind.PAYMENT_INFO
      if (storeName === StoreNames.BADGE_DEFINITION_EVENTS) return ExtendedKind.BADGE_DEFINITION
      // PUBLICATION_EVENTS is not replaceable, so we don't handle it here
      return undefined
  }

  private isReplaceableEventKind(kind: number): boolean {
    // Check if this is a replaceable event kind
    return (
      kind === kinds.Metadata ||
      kind === kinds.Contacts ||
      kind === kinds.RelayList ||
      kind === kinds.Mutelist ||
      kind === kinds.BookmarkList ||
      kind === ExtendedKind.FOLLOW_SET ||
      (kind >= 10000 && kind < 20000) ||
      kind === ExtendedKind.FAVORITE_RELAYS ||
      kind === ExtendedKind.BLOCKED_RELAYS ||
      kind === ExtendedKind.CACHE_RELAYS ||
      kind === ExtendedKind.HTTP_RELAY_LIST ||
      kind === ExtendedKind.BLOSSOM_SERVER_LIST ||
      kind === ExtendedKind.RSS_FEED_LIST
    )
  }

  async forceDatabaseUpgrade(): Promise<void> {
    // Close the database first
    if (this.db) {
      this.db.close()
      this.db = null
      this.initPromise = null
    }
    
    // Check current version
    const checkRequest = window.indexedDB.open('jumble')
    let currentVersion = DB_VERSION
    checkRequest.onsuccess = () => {
      const db = checkRequest.result
      currentVersion = db.version
      db.close()
    }
    checkRequest.onerror = () => {
      // If we can't check, start fresh
      currentVersion = 14
    }
    await new Promise(resolve => setTimeout(resolve, 100)) // Wait for version check
    
    const newVersion = currentVersion + 1
    
    // Open with new version to trigger upgrade
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open('jumble', newVersion)
      
      request.onerror = (event) => {
        reject(event)
      }
      
      request.onsuccess = () => {
        const db = request.result
        // Don't close - keep it open for the service to use
        this.db = db
        this.initPromise = Promise.resolve()
        resolve()
      }
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        ensureMissingObjectStores(db)
      }
    })
  }

  /**
   * NIP-52 rows were once written to {@link StoreNames.EVENT_ARCHIVE}; ingest now uses dedicated calendar stores only.
   * One-time purge so disk scans and cache search do not surface stale calendar bodies.
   */
  private async purgeLegacyArchivedCalendarEventsOnce(): Promise<void> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return
    const done = await this.getSetting(ARCHIVE_CALENDAR_PURGE_SETTING_KEY)
    if (done === '1') return

    const calendarKinds = new Set<number>([
      ...CALENDAR_EVENT_KINDS,
      ExtendedKind.CALENDAR_EVENT_RSVP
    ])
    let removed = 0
    const maxScanned = 80_000

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readwrite')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const req = store.openCursor()
      let scanned = 0
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor || scanned >= maxScanned) {
          tx.commit()
          resolve()
          return
        }
        scanned += 1
        const row = cursor.value as TArchivedEventRow
        const ev = row?.value
        if (ev && calendarKinds.has(ev.kind)) {
          cursor.delete()
          removed += 1
        }
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })

    await this.setSetting(ARCHIVE_CALENDAR_PURGE_SETTING_KEY, '1')
    if (removed > 0) {
      logger.info('[IndexedDB] Purged legacy calendar rows from event archive', { removed })
    }
  }

  private scheduleNextCleanUp(delayMs: number): void {
    if (typeof window === 'undefined') return
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer)
      this.cleanupTimer = null
    }
    if (!this.db) return
    this.cleanupTimer = window.setTimeout(() => {
      this.cleanupTimer = null
      void this.cleanUp()
    }, delayMs)
  }

  private async cleanUp() {
    await this.initPromise
    if (!this.db) {
      return
    }

    try {
    const stores = [
      { name: StoreNames.PROFILE_EVENTS, expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 }, // 1 day
      { name: StoreNames.PAYMENT_INFO_EVENTS, expirationTimestamp: Date.now() - PAYMENT_INFO_CACHE_MAX_AGE_MS }, // 1 day
      { name: StoreNames.RELAY_LIST_EVENTS, expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 }, // 1 day
      {
        name: StoreNames.FOLLOW_LIST_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 // 1 day
      },
      {
        name: StoreNames.FOLLOW_SET_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 // 1 day
      },
      {
        name: StoreNames.BLOSSOM_SERVER_LIST_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 // 1 days
      },
      {
        name: StoreNames.RELAY_INFOS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 // 1 days
      }
    ]
    const names = this.db.objectStoreNames
    const existingStores = stores.filter((s) => names.contains(s.name))
    if (existingStores.length === 0) {
      return
    }
    const transaction = this.db!.transaction(
      existingStores.map((store) => store.name),
      'readwrite'
    )
    const sweepResults = await Promise.allSettled(
      existingStores.map(({ name, expirationTimestamp }) => {
        if (expirationTimestamp < 0) {
          return Promise.resolve()
        }
        return new Promise<void>((resolve, reject) => {
          const store = transaction.objectStore(name)
          const request = store.openCursor()
          request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result
            if (cursor) {
              const value: TValue = cursor.value
              if (value.addedAt < expirationTimestamp) {
                cursor.delete()
              }
              cursor.continue()
            } else {
              resolve()
            }
          }

          request.onerror = (event) => {
            reject(event)
          }
        })
      })
    )
    for (let i = 0; i < sweepResults.length; i++) {
      const r = sweepResults[i]
      if (r?.status === 'rejected') {
        logger.warn('[IndexedDB] cleanUp store sweep failed', {
          store: existingStores[i]?.name,
          error: r.reason
        })
      }
    }
    } catch (error) {
      logger.warn('[IndexedDB] cleanUp failed', { error })
    } finally {
      if (this.db) {
        this.scheduleNextCleanUp(IndexedDbService.CLEANUP_INTERVAL_MS)
      }
    }
  }

  /**
   * Store RSS feed items in IndexedDB
   */
  async putRssFeedItems(items: import('./rss-feed.service').RssFeedItem[]): Promise<void> {
    await this.initPromise
    const storeName = StoreNames.RSS_FEED_ITEMS
    
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      logger.warn('[IndexedDB] RSS feed items store not found', { storeName })
      return
    }

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      
      let completed = 0
      let errors = 0
      
      items.forEach((item) => {
        // Create a unique key from feedUrl and guid
        const key = `${item.feedUrl}:${item.guid}`
        // Store in TValue format for consistency with other stores
        const value: TValue<import('./rss-feed.service').RssFeedItem> = {
          key,
          value: item,
          addedAt: Date.now()
        }
        
        const request = store.put(value)
        request.onsuccess = () => {
          completed++
          if (completed + errors === items.length) {
            resolve()
          }
        }
        request.onerror = () => {
          errors++
          if (completed + errors === items.length) {
            resolve() // Don't reject, just log
          }
        }
      })
      
      if (items.length === 0) {
        resolve()
      }
    })
  }

  /**
   * Get all RSS feed items from IndexedDB
   */
  async getRssFeedItems(): Promise<import('./rss-feed.service').RssFeedItem[]> {
    await this.initPromise
    const storeName = StoreNames.RSS_FEED_ITEMS
    
    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      logger.warn('[IndexedDB] RSS feed items store not found', { storeName })
      return []
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.getAll()
      
      request.onsuccess = () => {
        const items = request.result.map((entry: TValue<import('./rss-feed.service').RssFeedItem> | any) => {
          let item: import('./rss-feed.service').RssFeedItem | null = null
          
          // Handle new format (with value property)
          if (entry.value) {
            item = entry.value
          }
          // Fallback for old format (with item property)
          else if ((entry as any).item) {
            item = (entry as any).item as import('./rss-feed.service').RssFeedItem
          }
          
          if (!item) {
            return null
          }
          
          // Ensure pubDate is properly handled (IndexedDB may serialize Date as string)
          if (item.pubDate && typeof item.pubDate === 'string') {
            item.pubDate = new Date(item.pubDate)
          } else if (item.pubDate && typeof item.pubDate === 'number') {
            item.pubDate = new Date(item.pubDate)
          }
          
          return item
        }).filter((item): item is import('./rss-feed.service').RssFeedItem => item !== null)
        
        logger.debug('[IndexedDB] Retrieved RSS feed items', { 
          totalRetrieved: request.result.length,
          validItems: items.length 
        })
        resolve(items)
      }
      
      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  /**
   * Clear RSS feed items from IndexedDB
   */
  async clearRssFeedItems(): Promise<void> {
    await this.initPromise
    const storeName = StoreNames.RSS_FEED_ITEMS

    if (!this.db || !this.db.objectStoreNames.contains(storeName)) {
      return
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.clear()

      request.onsuccess = () => {
        resolve()
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  private static readonly GIF_CACHE_KEY = 'gifList'
  private static readonly MEME_CACHE_KEY = 'memeList'

  /**
   * Get cached GIF list from IndexedDB. Returns null if missing or store unavailable.
   */
  async getGifCache(): Promise<{
    gifs: {
      url: string
      fallbackUrl?: string
      sourceKind?: number
      description?: string
      eventId: string
      pubkey: string
      createdAt: number
    }[]
    cachedAt: number
  } | null> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.GIF_CACHE)) {
      return null
    }
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(StoreNames.GIF_CACHE, 'readonly')
      const store = transaction.objectStore(StoreNames.GIF_CACHE)
      const request = store.get(IndexedDbService.GIF_CACHE_KEY)
      request.onsuccess = () => {
        const row = request.result as { key: string; value: { gifs: unknown[]; cachedAt: number } } | undefined
        if (row?.value?.gifs && typeof row.value.cachedAt === 'number') {
          resolve({
            gifs: row.value.gifs as {
              url: string
              fallbackUrl?: string
              sourceKind?: number
              description?: string
              eventId: string
              pubkey: string
              createdAt: number
            }[],
            cachedAt: row.value.cachedAt
          })
        } else {
          resolve(null)
        }
      }
      request.onerror = () => resolve(null)
    })
  }

  /**
   * Write GIF list cache to IndexedDB.
   */
  async setGifCache(
    gifs: {
      url: string
      fallbackUrl?: string
      sourceKind?: number
      description?: string
      eventId: string
      pubkey: string
      createdAt: number
    }[],
    cachedAt: number
  ): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.GIF_CACHE)) {
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.GIF_CACHE, 'readwrite')
      const store = transaction.objectStore(StoreNames.GIF_CACHE)
      store.put({ key: IndexedDbService.GIF_CACHE_KEY, value: { gifs, cachedAt } })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  /**
   * Cached memes (kind 1063 `memeamigo` only). Same store as GIF cache, different key.
   */
  async getMemeCache(): Promise<{
    memes: { url: string; fallbackUrl?: string; eventId: string; pubkey: string; createdAt: number }[]
    cachedAt: number
  } | null> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.GIF_CACHE)) {
      return null
    }
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(StoreNames.GIF_CACHE, 'readonly')
      const store = transaction.objectStore(StoreNames.GIF_CACHE)
      const request = store.get(IndexedDbService.MEME_CACHE_KEY)
      request.onsuccess = () => {
        const row = request.result as
          | { key: string; value: { memes: unknown[]; cachedAt: number } }
          | undefined
        if (row?.value?.memes && typeof row.value.cachedAt === 'number') {
          resolve({
            memes: row.value.memes as {
              url: string
              fallbackUrl?: string
              eventId: string
              pubkey: string
              createdAt: number
            }[],
            cachedAt: row.value.cachedAt
          })
        } else {
          resolve(null)
        }
      }
      request.onerror = () => resolve(null)
    })
  }

  async setMemeCache(
    memes: { url: string; fallbackUrl?: string; eventId: string; pubkey: string; createdAt: number }[],
    cachedAt: number
  ): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.GIF_CACHE)) {
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.GIF_CACHE, 'readwrite')
      const store = transaction.objectStore(StoreNames.GIF_CACHE)
      store.put({ key: IndexedDbService.MEME_CACHE_KEY, value: { memes, cachedAt } })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  /**
   * Get a single setting value from IndexedDB. Returns null if missing.
   */
  async getSetting(key: string): Promise<string | null> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SETTINGS)) {
      return null
    }
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(StoreNames.SETTINGS, 'readonly')
      const store = transaction.objectStore(StoreNames.SETTINGS)
      const request = store.get(key)
      request.onsuccess = () => {
        const row = request.result as { key: string; value: string } | undefined
        resolve(row?.value ?? null)
      }
      request.onerror = () => resolve(null)
    })
  }

  /**
   * Get all settings from IndexedDB as a key -> value map.
   */
  async getAllSettings(): Promise<Record<string, string>> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SETTINGS)) {
      return {}
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SETTINGS, 'readonly')
      const store = transaction.objectStore(StoreNames.SETTINGS)
      const request = store.getAll()
      request.onsuccess = () => {
        const rows = (request.result || []) as { key: string; value: string }[]
        const out: Record<string, string> = {}
        rows.forEach((r) => {
          if (r.key != null && r.value != null) out[r.key] = r.value
        })
        resolve(out)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Set a setting in IndexedDB.
   */
  async setSetting(key: string, value: string): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SETTINGS)) {
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SETTINGS, 'readwrite')
      const store = transaction.objectStore(StoreNames.SETTINGS)
      store.put({ key, value })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  /** Settings key for favorite spell event ids (JSON array of strings). */
  static readonly SPELL_FAVORITE_IDS_KEY = 'spellFavoriteIds'
  /** Settings key: JSON array of NIP-33 addresses `kind:pubkey:d` hidden from the live-activities carousel. */
  static readonly HIDDEN_LIVE_ACTIVITY_ADDRESSES_KEY = 'hiddenLiveActivityAddresses'

  /**
   * Store a NIP-A7 spell event (kind 777) in IndexedDB by event id.
   */
  async putSpellEvent(event: Event): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SPELL_EVENTS)) {
      logger.warn('[IndexedDB] Spell events store not found')
      return
    }
    const cleanEvent = { ...event }
    delete (cleanEvent as any).relayStatuses
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SPELL_EVENTS, 'readwrite')
      const store = transaction.objectStore(StoreNames.SPELL_EVENTS)
      const key = cleanEvent.id
      const value: TValue<Event> = {
        key,
        value: cleanEvent,
        addedAt: Date.now()
      }
      store.put(value)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  /**
   * Delete a spell event from IndexedDB by event id.
   */
  async deleteSpellEvent(eventId: string): Promise<void> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SPELL_EVENTS)) {
      logger.warn('[IndexedDB] Spell events store not found')
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SPELL_EVENTS, 'readwrite')
      const store = transaction.objectStore(StoreNames.SPELL_EVENTS)
      store.delete(eventId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  /**
   * Get all spell events from IndexedDB.
   */
  async getSpellEvents(): Promise<Event[]> {
    await this.initPromise
    if (!this.db || !this.db.objectStoreNames.contains(StoreNames.SPELL_EVENTS)) {
      return []
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.SPELL_EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.SPELL_EVENTS)
      const request = store.getAll()
      request.onsuccess = () => {
        const rows = (request.result || []) as TValue<Event>[]
        const events = rows
          .filter((r) => r?.value != null)
          .map((r) => r.value as Event)
        resolve(events)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get favorite spell ids from settings (JSON array of event ids).
   */
  async getSpellFavoriteIds(): Promise<string[]> {
    const raw = await this.getSetting(IndexedDbService.SPELL_FAVORITE_IDS_KEY)
    if (!raw) return []
    try {
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  /**
   * Set favorite spell ids in settings.
   */
  async setSpellFavoriteIds(ids: string[]): Promise<void> {
    await this.setSetting(IndexedDbService.SPELL_FAVORITE_IDS_KEY, JSON.stringify(ids))
  }

  /**
   * NIP-33 addresses (`kind:pubkey:d`) the user chose to hide from the live-activities carousel (IndexedDB settings).
   */
  async getHiddenLiveActivityAddresses(): Promise<Set<string>> {
    const raw = await this.getSetting(IndexedDbService.HIDDEN_LIVE_ACTIVITY_ADDRESSES_KEY)
    if (!raw?.trim()) return new Set()
    try {
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) return new Set()
      return new Set(arr.filter((x): x is string => typeof x === 'string' && x.length > 0))
    } catch {
      return new Set()
    }
  }

  async setHiddenLiveActivityAddresses(addresses: readonly string[]): Promise<void> {
    await this.setSetting(
      IndexedDbService.HIDDEN_LIVE_ACTIVITY_ADDRESSES_KEY,
      JSON.stringify([...new Set(addresses)])
    )
  }

  private rememberTombstoneNot(key: string): void {
    const until = Date.now() + IndexedDbService.TOMBSTONE_NOT_CACHE_TTL_MS
    this.tombstoneNotUntilMs.set(key, until)
    while (this.tombstoneNotUntilMs.size > IndexedDbService.TOMBSTONE_NOT_CACHE_MAX) {
      const first = this.tombstoneNotUntilMs.keys().next().value
      if (first === undefined) break
      this.tombstoneNotUntilMs.delete(first)
    }
  }

  private invalidateTombstoneNotCache(key: string): void {
    this.tombstoneNotUntilMs.delete(key)
  }

  /**
   * Check if an event is tombstoned (deleted)
   */
  async isTombstoned(key: string): Promise<boolean> {
    await this.initPromise
    const now = Date.now()
    const until = this.tombstoneNotUntilMs.get(key)
    if (until !== undefined && now < until) {
      return false
    }
    if (until !== undefined && now >= until) {
      this.tombstoneNotUntilMs.delete(key)
    }
    return new Promise((resolve) => {
      if (!this.db) {
        return resolve(false)
      }
      if (!this.db.objectStoreNames.contains(StoreNames.TOMBSTONE_LIST)) {
        return resolve(false)
      }
      const transaction = this.db.transaction(StoreNames.TOMBSTONE_LIST, 'readonly')
      const store = transaction.objectStore(StoreNames.TOMBSTONE_LIST)
      const request = store.get(key)

      request.onsuccess = () => {
        const row = request.result as TValue | undefined
        transaction.commit()
        const tombstoned = row !== undefined && row.value !== null
        if (!tombstoned) {
          this.rememberTombstoneNot(key)
        } else {
          this.invalidateTombstoneNotCache(key)
        }
        resolve(tombstoned)
      }

      request.onerror = () => {
        transaction.commit()
        resolve(false)
      }
    })
  }

  /**
   * Add event to tombstone list (mark as deleted)
   * Key format: event ID for non-replaceable events, or "kind:pubkey" or "kind:pubkey:d" for replaceable events
   */
  async addTombstone(key: string, deletedAt: number = Date.now()): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject(new Error('Database not initialized'))
      }
      if (!this.db.objectStoreNames.contains(StoreNames.TOMBSTONE_LIST)) {
        return reject(new Error('Tombstone store not found'))
      }
      const transaction = this.db.transaction(StoreNames.TOMBSTONE_LIST, 'readwrite')
      const store = transaction.objectStore(StoreNames.TOMBSTONE_LIST)
      const value = this.formatValue(key, { deletedAt })
      const request = store.put(value)

      request.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(idbEventToError(event))
      }
    })
  }

  /** Hot archive row (kinds already persisted in replaceable stores should not use this). */
  async putArchivedEventRow(
    event: Event,
    archiveTier: number,
    approxBytes: number
  ): Promise<void> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return
    const id = /^[0-9a-f]{64}$/i.test(event.id) ? event.id.toLowerCase() : event.id
    const clean = { ...event }
    delete (clean as any).relayStatuses
    const now = Date.now()
    const row: TArchivedEventRow = {
      key: id,
      value: clean as Event,
      addedAt: now,
      lastAccessAt: now,
      approxBytes: Math.max(80, approxBytes),
      archiveTier
    }
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readwrite')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const put = store.put(row)
      put.onsuccess = () => {
        tx.commit()
        resolve()
      }
      put.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async touchArchivedEventAccess(eventId: string): Promise<void> {
    const id = eventId.toLowerCase()
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readwrite')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const get = store.get(id)
      get.onsuccess = () => {
        const row = get.result as TArchivedEventRow | undefined
        if (!row?.value) {
          tx.commit()
          resolve()
          return
        }
        row.lastAccessAt = Date.now()
        const put = store.put(row)
        put.onsuccess = () => {
          tx.commit()
          resolve()
        }
        put.onerror = (e) => {
          tx.commit()
          reject(idbEventToError(e))
        }
      }
      get.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async getArchivedEventById(eventId: string, touchAccess: boolean): Promise<Event | undefined> {
    const id = eventId.toLowerCase()
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return undefined
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, touchAccess ? 'readwrite' : 'readonly')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const get = store.get(id)
      get.onsuccess = () => {
        const row = get.result as TArchivedEventRow | undefined
        const ev = row?.value
        if (touchAccess && row && ev) {
          row.lastAccessAt = Date.now()
          const put = store.put(row)
          put.onsuccess = () => {
            tx.commit()
            resolve(ev)
          }
          put.onerror = (e) => {
            tx.commit()
            reject(idbEventToError(e))
          }
          return
        }
        tx.commit()
        resolve(ev)
      }
      get.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  /**
   * Batch-read archive rows by event id. Best-effort: never rejects (avoids hung timelines when one `get`
   * fails or the transaction aborts mid-batch); logs the first error only.
   */
  async getArchivedEventsByIds(ids: string[]): Promise<Event[]> {
    const uniq = [...new Set(ids.map((x) => x.toLowerCase()))].filter((x) => /^[0-9a-f]{64}$/.test(x))
    if (uniq.length === 0) return []
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return []
    return new Promise((resolve) => {
      const byId = new Map<string, Event>()
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readonly')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      let remaining = uniq.length
      let loggedErr = false

      const finishOne = () => {
        remaining -= 1
        if (remaining !== 0) return
        try {
          tx.commit()
        } catch {
          /* commit() unsupported or invalid state — transaction may auto-finish */
        }
        const ordered: Event[] = []
        for (const id of uniq) {
          const ev = byId.get(id)
          if (ev) ordered.push(ev)
        }
        resolve(ordered)
      }

      for (const id of uniq) {
        const req = store.get(id)
        req.onsuccess = () => {
          try {
            const row = req.result as TArchivedEventRow | undefined
            if (row?.value) byId.set(id, row.value)
          } catch (e) {
            if (!loggedErr) {
              loggedErr = true
              logger.warn('[IndexedDB] getArchivedEventsByIds row read failed', { e })
            }
          }
          finishOne()
        }
        req.onerror = (ev) => {
          if (!loggedErr) {
            loggedErr = true
            logger.warn('[IndexedDB] getArchivedEventsByIds request failed', { err: idbEventToError(ev) })
          }
          finishOne()
        }
      }
    })
  }

  /**
   * Scan {@link StoreNames.EVENT_ARCHIVE} for events authored by `pubkey` (bounded scan).
   * Used for client-side aggregates (e.g. interaction map) from disk cache without a new relay REQ.
   *
   * Cursor order is **event id**, not `created_at`. Never stop at `maxMatches` while scanning — that would
   * keep the first N random-key hits (often old) and drop brand-new notes. Instead keep a working buffer of
   * the newest rows seen so far, trim periodically, then return the top `maxMatches` by time.
   */
  async scanEventArchiveByAuthorPubkey(
    authorPubkey: string,
    options: { kinds?: readonly number[]; maxRowsScanned: number; maxMatches: number }
  ): Promise<Event[]> {
    const pk = authorPubkey.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return []
    const kindSet = options.kinds?.length ? new Set(options.kinds) : null
    const maxRows = Math.min(Math.max(options.maxRowsScanned, 1), 50_000)
    const maxMatches = Math.min(Math.max(options.maxMatches, 1), 2000)
    /** When buffer grows this large, sort by time and shrink so we keep the best candidates while scanning. */
    const workingCap = Math.min(4000, Math.max(maxMatches * 10, 240))
    const keepAfterTrim = Math.min(workingCap, Math.max(maxMatches * 3, maxMatches + 40))
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return []

    return new Promise((resolve, reject) => {
      const buf: Event[] = []
      let scanned = 0
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readonly')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor || scanned >= maxRows) {
          tx.commit()
          buf.sort((a, b) => b.created_at - a.created_at)
          resolve(buf.slice(0, maxMatches))
          return
        }
        scanned += 1
        const row = cursor.value as TArchivedEventRow
        const ev = row?.value
        if (
          ev &&
          isLikelyCachedNostrEvent(ev) &&
          ev.pubkey?.toLowerCase() === pk &&
          (!kindSet || kindSet.has(ev.kind))
        ) {
          buf.push(ev)
          if (buf.length >= workingCap) {
            buf.sort((a, b) => b.created_at - a.created_at)
            buf.length = keepAfterTrim
          }
        }
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async scanEventArchiveByFilters(
    filters: readonly Filter[],
    options: { maxRowsScanned: number; maxMatches: number }
  ): Promise<Event[]> {
    if (filters.length === 0 || options.maxMatches <= 0) return []
    const maxRows = Math.min(Math.max(options.maxRowsScanned, 1), 50_000)
    const maxMatches = Math.min(Math.max(options.maxMatches, 1), 3000)
    const workingCap = Math.min(4000, Math.max(maxMatches * 8, maxMatches + 80))
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return []

    return new Promise((resolve, reject) => {
      const buf: Event[] = []
      let scanned = 0
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readonly')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor || scanned >= maxRows) {
          tx.commit()
          buf.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
          resolve(buf.slice(0, maxMatches))
          return
        }
        scanned++
        const row = cursor.value as TArchivedEventRow | undefined
        const ev = row?.value
        if (ev && !shouldDropEventOnIngest(ev) && eventMatchesAnyLocalFeedFilter(ev, filters)) {
          buf.push(ev)
          if (buf.length > workingCap) {
            buf.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
            buf.length = Math.min(buf.length, Math.max(maxMatches * 3, maxMatches + 40))
          }
        }
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  /**
   * Scan {@link StoreNames.EVENT_ARCHIVE} for events whose kind is in `kinds`.
   * Cursor order follows the store key (not time), so `since` is applied **after** the scan: collect kind
   * matches up to `maxRowsScanned`, then keep `created_at >= since` (when set), sort newest-first, cap.
   */
  async scanEventArchiveByKinds(options: {
    kinds: readonly number[]
    since?: number
    maxRowsScanned: number
    maxMatches: number
  }): Promise<Event[]> {
    const kindSet = new Set(options.kinds)
    const since = options.since
    const maxRows = Math.min(Math.max(options.maxRowsScanned, 1), 50_000)
    const maxMatches = Math.min(Math.max(options.maxMatches, 1), 3000)
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return []

    return new Promise((resolve, reject) => {
      const buf: Event[] = []
      let scanned = 0
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readonly')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor || scanned >= maxRows) {
          tx.commit()
          let picked = buf
          if (since !== undefined) {
            picked = buf.filter((e) => e.created_at >= since)
          }
          picked.sort((a, b) => b.created_at - a.created_at)
          resolve(picked.slice(0, maxMatches))
          return
        }
        scanned += 1
        const row = cursor.value as TArchivedEventRow
        const ev = row?.value
        if (ev && isLikelyCachedNostrEvent(ev) && kindSet.has(ev.kind)) {
          buf.push(ev)
        }
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  /**
   * Hot {@link StoreNames.EVENT_ARCHIVE} rows for NIP-52 calendar notes whose occurrence overlaps the range.
   * Calendar kinds are no longer archived on ingest, but older builds could still have 31922/31923 in the archive.
   */
  async getArchivedCalendarEventsOverlappingWindow(
    rangeStartMs: number,
    rangeEndExclusiveMs: number,
    maxRowsScanned = 30_000,
    maxMatches = 800
  ): Promise<Event[]> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return []

    const kindSet = new Set<number>(CALENDAR_EVENT_KINDS as readonly number[])
    const maxRows = Math.min(Math.max(maxRowsScanned, 1), 50_000)
    const maxOut = Math.min(Math.max(maxMatches, 1), 3000)

    return new Promise((resolve, reject) => {
      const out: Event[] = []
      let scanned = 0
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readonly')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor || scanned >= maxRows || out.length >= maxOut) {
          tx.commit()
          resolve(out)
          return
        }
        scanned += 1
        const row = cursor.value as TArchivedEventRow
        const ev = row?.value
        if (
          ev &&
          isLikelyCachedNostrEvent(ev) &&
          kindSet.has(ev.kind) &&
          !shouldDropEventOnIngest(ev) &&
          calendarOccurrenceOverlapsRange(ev, rangeStartMs, rangeEndExclusiveMs)
        ) {
          out.push(ev)
        }
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async deleteArchivedEvent(eventId: string): Promise<void> {
    const id = eventId.toLowerCase()
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readwrite')
      const del = tx.objectStore(StoreNames.EVENT_ARCHIVE).delete(id)
      del.onsuccess = () => {
        tx.commit()
        resolve()
      }
      del.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  /** Delete lowest (tier, then oldest access) row for archive eviction. */
  async deleteNextEvictionArchiveCandidate(): Promise<{ id: string; approxBytes: number } | null> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) return null
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readwrite')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const idx = store.index('eviction')
      const req = idx.openCursor()
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor) {
          tx.commit()
          resolve(null)
          return
        }
        const row = cursor.value as TArchivedEventRow
        const id = row.key
        const approxBytes = row.approxBytes ?? 0
        cursor.delete()
        tx.commit()
        resolve({ id, approxBytes })
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async getArchiveFootprint(): Promise<{ count: number; bytes: number }> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.EVENT_ARCHIVE)) {
      return { count: 0, bytes: 0 }
    }
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.EVENT_ARCHIVE, 'readonly')
      const store = tx.objectStore(StoreNames.EVENT_ARCHIVE)
      const req = store.openCursor()
      let count = 0
      let bytes = 0
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor) {
          tx.commit()
          resolve({ count, bytes })
          return
        }
        const row = cursor.value as TArchivedEventRow
        count++
        bytes += row.approxBytes ?? 0
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async putTimelinePersistedState(
    timelineKey: string,
    payload: TTimelinePersistedPayload
  ): Promise<void> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.TIMELINE_STATE)) return
    const row = this.formatValue(timelineKey, payload)
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.TIMELINE_STATE, 'readwrite')
      const put = tx.objectStore(StoreNames.TIMELINE_STATE).put(row)
      put.onsuccess = () => {
        tx.commit()
        resolve()
      }
      put.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async getTimelinePersistedState(timelineKey: string): Promise<TTimelinePersistedPayload | null> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.TIMELINE_STATE)) return null
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.TIMELINE_STATE, 'readonly')
      const get = tx.objectStore(StoreNames.TIMELINE_STATE).get(timelineKey)
      get.onsuccess = () => {
        const row = get.result as TValue<TTimelinePersistedPayload> | undefined
        tx.commit()
        resolve(row?.value ?? null)
      }
      get.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async getPiperTtsBlobCache(cacheKey: string, ttlMs: number): Promise<Blob | null> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.PIPER_TTS_CACHE)) return null
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.PIPER_TTS_CACHE, 'readwrite')
      const store = tx.objectStore(StoreNames.PIPER_TTS_CACHE)
      const get = store.get(cacheKey)
      get.onsuccess = () => {
        const row = get.result as TValue<TPiperTtsCacheValue> | undefined
        if (!row?.value?.blob) {
          tx.commit()
          resolve(null)
          return
        }
        if (Date.now() - row.addedAt > ttlMs) {
          const del = store.delete(cacheKey)
          del.onsuccess = () => {
            tx.commit()
            resolve(null)
          }
          del.onerror = () => {
            tx.commit()
            resolve(null)
          }
          return
        }
        tx.commit()
        resolve(row.value.blob)
      }
      get.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async putPiperTtsBlobCache(
    cacheKey: string,
    blob: Blob,
    mimeType: string,
    opts: { ttlMs: number; maxEntries: number; maxBytes: number }
  ): Promise<void> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.PIPER_TTS_CACHE)) return
    const row = this.formatValue(cacheKey, { blob, mimeType })
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.PIPER_TTS_CACHE, 'readwrite')
      const put = tx.objectStore(StoreNames.PIPER_TTS_CACHE).put(row)
      put.onsuccess = () => {
        tx.commit()
        resolve()
      }
      put.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
    await this.prunePiperTtsBlobCache(opts.ttlMs, opts.maxEntries, opts.maxBytes)
  }

  /** Drop expired Piper blobs, then oldest rows until under entry / byte caps. */
  async prunePiperTtsBlobCache(ttlMs: number, maxEntries: number, maxBytes: number): Promise<void> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.PIPER_TTS_CACHE)) return
    const now = Date.now()
    const rows: Array<{ key: string; addedAt: number; bytes: number }> = []

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.PIPER_TTS_CACHE, 'readonly')
      const req = tx.objectStore(StoreNames.PIPER_TTS_CACHE).openCursor()
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor) {
          tx.commit()
          resolve()
          return
        }
        const row = cursor.value as TValue<TPiperTtsCacheValue>
        const key = cursor.key as string
        const bytes = row.value?.blob?.size ?? 0
        rows.push({ key, addedAt: row.addedAt, bytes })
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })

    const toDelete = new Set<string>()
    for (const r of rows) {
      if (now - r.addedAt > ttlMs) toDelete.add(r.key)
    }
    const survivors = rows.filter((r) => !toDelete.has(r.key)).sort((a, b) => a.addedAt - b.addedAt)
    let totalBytes = survivors.reduce((s, r) => s + r.bytes, 0)
    let totalCount = survivors.length
    while (totalCount > maxEntries || totalBytes > maxBytes) {
      const victim = survivors.shift()
      if (!victim) break
      toDelete.add(victim.key)
      totalBytes -= victim.bytes
      totalCount--
    }

    for (const key of toDelete) {
      await this.deleteStoreItem(StoreNames.PIPER_TTS_CACHE, key)
    }
  }

  private approxLibraryPublicationIndexBytes(ev: Event): number {
    try {
      return new Blob([JSON.stringify(ev)]).size
    } catch {
      return 2048
    }
  }

  async pruneUnverifiedLibraryPublicationIndexCacheEvents(): Promise<number> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.LIBRARY_PUBLICATION_INDEX)) return 0

    const toDelete: string[] = []
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.LIBRARY_PUBLICATION_INDEX, 'readonly')
      const req = tx.objectStore(StoreNames.LIBRARY_PUBLICATION_INDEX).openCursor()
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor) {
          tx.commit()
          resolve()
          return
        }
        const row = cursor.value as TLibraryPublicationIndexCacheRow
        if (row?.value?.kind === ExtendedKind.PUBLICATION && !isVerifiedPublicationIndex(row.value)) {
          toDelete.push(cursor.key as string)
        }
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })

    for (const key of toDelete) {
      await this.deleteStoreItem(StoreNames.LIBRARY_PUBLICATION_INDEX, key)
    }
    return toDelete.length
  }

  async getLibraryPublicationIndexCacheEvents(): Promise<Event[]> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.LIBRARY_PUBLICATION_INDEX)) return []

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.LIBRARY_PUBLICATION_INDEX, 'readonly')
      const req = tx.objectStore(StoreNames.LIBRARY_PUBLICATION_INDEX).openCursor()
      const out: Event[] = []
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor) {
          tx.commit()
          resolve(out)
          return
        }
        const row = cursor.value as TLibraryPublicationIndexCacheRow
        if (row?.value?.kind === ExtendedKind.PUBLICATION) out.push(row.value)
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async getLibraryPublicationIndexCacheFootprint(): Promise<{ count: number; bytes: number }> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.LIBRARY_PUBLICATION_INDEX)) {
      return { count: 0, bytes: 0 }
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.LIBRARY_PUBLICATION_INDEX, 'readonly')
      const req = tx.objectStore(StoreNames.LIBRARY_PUBLICATION_INDEX).openCursor()
      let count = 0
      let bytes = 0
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor) {
          tx.commit()
          resolve({ count, bytes })
          return
        }
        const row = cursor.value as TLibraryPublicationIndexCacheRow
        count += 1
        bytes += row.approxBytes ?? this.approxLibraryPublicationIndexBytes(row.value)
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  async mergeLibraryPublicationIndexCacheEvents(
    events: Event[],
    opts: { maxEntries: number; maxBytes: number }
  ): Promise<void> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.LIBRARY_PUBLICATION_INDEX) || events.length === 0) {
      return
    }

    const now = Date.now()
    const storeName = StoreNames.LIBRARY_PUBLICATION_INDEX

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      let pending = events.length
      if (pending === 0) {
        tx.commit()
        resolve()
        return
      }

      const finishOne = () => {
        pending -= 1
        if (pending === 0) {
          tx.commit()
          resolve()
        }
      }

      for (const ev of events) {
        const get = store.get(ev.id)
        get.onsuccess = () => {
          const prev = get.result as TLibraryPublicationIndexCacheRow | undefined
          const row: TLibraryPublicationIndexCacheRow = {
            key: ev.id,
            value: ev,
            addedAt: prev?.addedAt ?? now,
            lastAccessAt: now,
            approxBytes: this.approxLibraryPublicationIndexBytes(ev)
          }
          const put = store.put(row)
          put.onsuccess = () => finishOne()
          put.onerror = (e) => {
            finishOne()
            if (pending === 0) reject(idbEventToError(e))
          }
        }
        get.onerror = (e) => {
          finishOne()
          if (pending === 0) reject(idbEventToError(e))
        }
      }
    })

    await this.pruneLibraryPublicationIndexCache(opts.maxEntries, opts.maxBytes)
  }

  async pruneLibraryPublicationIndexCache(maxEntries: number, maxBytes: number): Promise<void> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.LIBRARY_PUBLICATION_INDEX)) return

    const rows: Array<{ key: string; lastAccessAt: number; bytes: number }> = []
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.LIBRARY_PUBLICATION_INDEX, 'readonly')
      const req = tx.objectStore(StoreNames.LIBRARY_PUBLICATION_INDEX).openCursor()
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor) {
          tx.commit()
          resolve()
          return
        }
        const row = cursor.value as TLibraryPublicationIndexCacheRow
        rows.push({
          key: cursor.key as string,
          lastAccessAt: row.lastAccessAt ?? row.addedAt,
          bytes: row.approxBytes ?? this.approxLibraryPublicationIndexBytes(row.value)
        })
        cursor.continue()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })

    rows.sort((a, b) => a.lastAccessAt - b.lastAccessAt)
    const toDelete = new Set<string>()
    let totalBytes = rows.reduce((s, r) => s + r.bytes, 0)
    let totalCount = rows.length
    while (totalCount > maxEntries || totalBytes > maxBytes) {
      const victim = rows.shift()
      if (!victim) break
      toDelete.add(victim.key)
      totalBytes -= victim.bytes
      totalCount -= 1
    }

    for (const key of toDelete) {
      await this.deleteStoreItem(StoreNames.LIBRARY_PUBLICATION_INDEX, key)
    }
  }

  async clearLibraryPublicationIndexCacheStore(): Promise<void> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.LIBRARY_PUBLICATION_INDEX)) return
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.LIBRARY_PUBLICATION_INDEX, 'readwrite')
      const req = tx.objectStore(StoreNames.LIBRARY_PUBLICATION_INDEX).clear()
      req.onsuccess = () => {
        tx.commit()
        resolve()
      }
      req.onerror = (e) => {
        tx.commit()
        reject(idbEventToError(e))
      }
    })
  }

  /**
   * Get all tombstoned keys
   */
  async getAllTombstones(): Promise<Set<string>> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(new Set())
      }
      if (!this.db.objectStoreNames.contains(StoreNames.TOMBSTONE_LIST)) {
        return resolve(new Set())
      }
      const transaction = this.db.transaction(StoreNames.TOMBSTONE_LIST, 'readonly')
      const store = transaction.objectStore(StoreNames.TOMBSTONE_LIST)
      const request = store.getAll()

      request.onsuccess = () => {
        const rows = request.result as TValue[]
        const keys = new Set<string>()
        for (const row of rows) {
          if (row.value !== null) {
            keys.add(row.key)
          }
        }
        transaction.commit()
        resolve(keys)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(idbEventToError(event))
      }
    })
  }

  /**
   * Remove tombstoned events from cache (cleanup)
   */
  async removeTombstonedFromCache(): Promise<number> {
    const tombstones = await this.getAllTombstones()
    let removed = 0

    for (const key of tombstones) {
      // Parse key format: could be event id or "kind:pubkey" or "kind:pubkey:d" (replaceable coordinate)
      // Or just event ID for non-replaceable events
      const parts = key.split(':')
      if (parts.length === 1) {
        // Event ID - remove from publication store + hot archive (+ calendar RSVP by id)
        const idLower = /^[0-9a-f]{64}$/i.test(key) ? key.toLowerCase() : key
        await Promise.allSettled([
          this.deleteStoreItem(StoreNames.PUBLICATION_EVENTS, key),
          this.deleteArchivedEvent(key),
          ...(this.db?.objectStoreNames.contains(StoreNames.CALENDAR_RSVP_EVENTS)
            ? [this.deleteStoreItem(StoreNames.CALENDAR_RSVP_EVENTS, idLower)]
            : [])
        ])
        removed++
      } else if (parts.length >= 2) {
        // Replaceable coordinate: kind:64-hex-pubkey[:d...] (d may contain ':' per NIP-33)
        const kind = parseInt(parts[0]!, 10)
        const pubkey = parts[1]!
        const d = parts.length > 2 ? parts.slice(2).join(':') : undefined
        if (!isNaN(kind) && /^[0-9a-f]{64}$/i.test(pubkey)) {
          try {
            const storeName = this.getStoreNameByKind(kind)
            if (storeName) {
              await this.deleteStoreItem(storeName, this.getReplaceableEventKey(pubkey.toLowerCase(), d))
              removed++
            }
            if (
              isCalendarEventKind(kind) &&
              d != null &&
              d !== '' &&
              this.db?.objectStoreNames.contains(StoreNames.CALENDAR_EVENTS)
            ) {
              const calKey = normalizeReplaceableCoordinateString(
                getReplaceableCoordinate(kind, pubkey.toLowerCase(), d)
              )
              await this.deleteStoreItem(StoreNames.CALENDAR_EVENTS, calKey)
              removed++
            }
          } catch {
            // Ignore errors
          }
        }
      }
    }

    return removed
  }

  /**
   * Persist a NIP-52 calendar note (31922/31923). Keyed by {@link replaceableEventDedupeKey}; keeps newest
   * `created_at` per coordinate.
   */
  async putCalendarEventRow(ev: Event): Promise<void> {
    if (!isCalendarEventKind(ev.kind)) return
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.CALENDAR_EVENTS)) return

    const key = replaceableEventDedupeKey(ev)
    const win = getCalendarOccurrenceWindowMs(ev)
    const occurrenceStartMs = win?.startMs ?? ev.created_at * 1000
    const occurrenceEndExclusiveMs = win?.endExclusiveMs ?? occurrenceStartMs + 3_600_000

    const clean = { ...ev } as Event
    delete (clean as { relayStatuses?: unknown }).relayStatuses
    if (/^[0-9a-f]{64}$/i.test(clean.id)) {
      clean.id = clean.id.toLowerCase()
    }

    const row: TCalendarEventCacheRow = {
      key,
      value: clean,
      addedAt: Date.now(),
      occurrenceStartMs,
      occurrenceEndExclusiveMs
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.CALENDAR_EVENTS, 'readwrite')
      const store = tx.objectStore(StoreNames.CALENDAR_EVENTS)
      const getReq = store.get(key)
      getReq.onerror = (e) => reject(idbEventToError(e))
      getReq.onsuccess = () => {
        const prev = getReq.result as TCalendarEventCacheRow | undefined
        if (prev?.value?.created_at != null && prev.value.created_at > ev.created_at) {
          resolve()
          return
        }
        const putReq = store.put(row)
        putReq.onerror = (e) => reject(idbEventToError(e))
        putReq.onsuccess = () => resolve()
      }
    })
  }

  /** Persist a NIP-52 RSVP (31925). Indexed by normalized `a` coordinate or `e:<calendar-id>`. */
  async putCalendarRsvpEventRow(ev: Event): Promise<void> {
    if (ev.kind !== ExtendedKind.CALENDAR_EVENT_RSVP) return
    const rawA = ev.tags.find(tagNameEquals('a'))?.[1]?.trim()
    const rawE = ev.tags.find(tagNameEquals('e'))?.[1]?.trim()
    const eHex =
      rawE && /^[0-9a-f]{64}$/i.test(rawE) ? rawE.toLowerCase() : ''
    let parentCoordinate = ''
    if (rawA) {
      parentCoordinate = normalizeReplaceableCoordinateString(rawA)
    } else if (eHex) {
      parentCoordinate = `e:${eHex}`
    }
    if (!parentCoordinate) return
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.CALENDAR_RSVP_EVENTS)) return

    const id = /^[0-9a-f]{64}$/i.test(ev.id) ? ev.id.toLowerCase() : ev.id
    const clean = { ...ev } as Event
    delete (clean as { relayStatuses?: unknown }).relayStatuses
    clean.id = id

    const row: TCalendarRsvpCacheRow = {
      key: id,
      value: clean,
      addedAt: Date.now(),
      parentCoordinate
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.CALENDAR_RSVP_EVENTS, 'readwrite')
      const putReq = tx.objectStore(StoreNames.CALENDAR_RSVP_EVENTS).put(row)
      putReq.onerror = (e) => reject(idbEventToError(e))
      putReq.onsuccess = () => resolve()
    })
  }

  /**
   * Calendar events whose occurrence overlaps `[rangeStartMs, rangeEndExclusiveMs)` (local week bounds).
   * Uses `occurrenceStartMs` index with a wide lower bound so long-lived date ranges are not missed.
   */
  async getCalendarEventsForOccurrenceWindow(
    rangeStartMs: number,
    rangeEndExclusiveMs: number,
    maxScan = 5000
  ): Promise<Event[]> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.CALENDAR_EVENTS)) return []

    const lower = rangeStartMs - 550 * 86_400_000
    const upper = rangeEndExclusiveMs + 86_400_000

    return new Promise((resolve, reject) => {
      const out: Event[] = []
      const tx = this.db!.transaction(StoreNames.CALENDAR_EVENTS, 'readonly')
      const store = tx.objectStore(StoreNames.CALENDAR_EVENTS)
      let index: IDBIndex
      try {
        index = store.index('occurrenceStartMs')
      } catch {
        resolve([])
        return
      }
      const range = IDBKeyRange.bound(lower, upper, false, false)
      const req = index.openCursor(range)
      req.onerror = (e) => reject(idbEventToError(e))
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null
        if (!cursor || out.length >= maxScan) {
          resolve(out)
          return
        }
        const row = cursor.value as TCalendarEventCacheRow
        if (
          row?.value &&
          calendarOccurrenceOverlapsRange(row.value, rangeStartMs, rangeEndExclusiveMs)
        ) {
          out.push(row.value)
        }
        cursor.continue()
      }
    })
  }

  /** RSVPs for a calendar note: `a` coordinate index plus `e:<event-id>` rows. */
  async getCalendarRsvpEventsForCalendarEvent(calendarEvent: Event, limit = 400): Promise<Event[]> {
    const coord = normalizeReplaceableCoordinateString(
      getReplaceableCoordinateFromEvent(calendarEvent)
    )
    const eKey = calendarRsvpParentKeyFromEventId(calendarEventHexId(calendarEvent))
    const [byCoord, byE] = await Promise.all([
      this.getCalendarRsvpEventsByParentCoordinate(coord, limit),
      eKey ? this.getCalendarRsvpEventsByParentCoordinate(eKey, limit) : Promise.resolve([])
    ])
    const seen = new Set<string>()
    const out: Event[] = []
    for (const ev of [...byCoord, ...byE]) {
      const id = ev.id.toLowerCase()
      if (seen.has(id)) continue
      seen.add(id)
      out.push(ev)
    }
    out.sort((a, b) => b.created_at - a.created_at)
    return out.slice(0, limit)
  }

  /** Cached RSVPs for a calendar replaceable coordinate (`kind:pubkey:d`) or `e:<hex>`. */
  async getCalendarRsvpEventsByParentCoordinate(
    parentCoordinate: string,
    limit = 400
  ): Promise<Event[]> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.CALENDAR_RSVP_EVENTS)) return []
    const norm = normalizeReplaceableCoordinateString(parentCoordinate.trim())
    if (!norm) return []

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.CALENDAR_RSVP_EVENTS, 'readonly')
      const store = tx.objectStore(StoreNames.CALENDAR_RSVP_EVENTS)
      let index: IDBIndex
      try {
        index = store.index('parentCoordinate')
      } catch {
        resolve([])
        return
      }
      const req = index.getAll(IDBKeyRange.only(norm))
      req.onerror = (e) => reject(idbEventToError(e))
      req.onsuccess = () => {
        const rows = (req.result as TCalendarRsvpCacheRow[]) ?? []
        const events = rows.map((r) => r.value).filter(Boolean)
        events.sort((a, b) => b.created_at - a.created_at)
        resolve(events.slice(0, limit))
      }
    })
  }

  async putPaymentNotificationRow(ev: Event): Promise<void> {
    const row = paymentNotificationIdbRowFromEvent(ev)
    if (!row) return
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.PAYMENT_NOTIFICATION_EVENTS)) return

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.PAYMENT_NOTIFICATION_EVENTS, 'readwrite')
      const store = tx.objectStore(StoreNames.PAYMENT_NOTIFICATION_EVENTS)
      const getReq = store.get(row.key)
      getReq.onerror = (e) => reject(idbEventToError(e))
      getReq.onsuccess = () => {
        const prev = getReq.result as PaymentNotificationIdbRow | undefined
        if (prev?.value?.created_at != null && prev.value.created_at > ev.created_at) {
          resolve()
          return
        }
        const putReq = store.put(row)
        putReq.onerror = (e) => reject(idbEventToError(e))
        putReq.onsuccess = () => resolve()
      }
    })
  }

  async putPaymentAttestationRow(ev: Event): Promise<void> {
    const row = paymentAttestationIdbRowFromEvent(ev)
    if (!row) return
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(StoreNames.PAYMENT_ATTESTATION_EVENTS)) return

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(StoreNames.PAYMENT_ATTESTATION_EVENTS, 'readwrite')
      const store = tx.objectStore(StoreNames.PAYMENT_ATTESTATION_EVENTS)
      const getReq = store.get(row.key)
      getReq.onerror = (e) => reject(idbEventToError(e))
      getReq.onsuccess = () => {
        const prev = getReq.result as PaymentAttestationIdbRow | undefined
        if (prev?.value?.created_at != null && prev.value.created_at > ev.created_at) {
          resolve()
          return
        }
        const putReq = store.put(row)
        putReq.onerror = (e) => reject(idbEventToError(e))
        putReq.onsuccess = () => resolve()
      }
    })
  }

  private async getIndexedEventsByField(
    storeName: string,
    indexName: string,
    fieldValue: string,
    limit: number
  ): Promise<Event[]> {
    await this.initPromise
    if (!this.db?.objectStoreNames.contains(storeName)) return []
    const key = fieldValue.trim().toLowerCase()
    if (!key) return []

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      let index: IDBIndex
      try {
        index = store.index(indexName)
      } catch {
        resolve([])
        return
      }
      const req = index.getAll(IDBKeyRange.only(key))
      req.onerror = (e) => reject(idbEventToError(e))
      req.onsuccess = () => {
        const rows = (req.result as { value: Event }[]) ?? []
        const events = rows.map((r) => r.value).filter(Boolean)
        events.sort((a, b) => b.created_at - a.created_at)
        resolve(events.slice(0, limit))
      }
    })
  }

  async getPaymentNotificationsForRecipient(recipientPubkey: string, limit = 200): Promise<Event[]> {
    return this.getIndexedEventsByField(
      StoreNames.PAYMENT_NOTIFICATION_EVENTS,
      'recipientPubkey',
      recipientPubkey,
      limit
    )
  }

  async getPaymentNotificationsForReferencedEvent(eventId: string, limit = 200): Promise<Event[]> {
    return this.getIndexedEventsByField(
      StoreNames.PAYMENT_NOTIFICATION_EVENTS,
      'referencedEventId',
      eventId,
      limit
    )
  }

  async getPaymentNotificationsForReferencedCoordinate(coordinate: string, limit = 200): Promise<Event[]> {
    const norm = normalizeReplaceableCoordinateString(coordinate.trim())
    if (!norm) return []
    return this.getIndexedEventsByField(
      StoreNames.PAYMENT_NOTIFICATION_EVENTS,
      'referencedCoordinate',
      norm,
      limit
    )
  }

  async getPaymentAttestationsForAuthor(authorPubkey: string, limit = 500): Promise<Event[]> {
    return this.getIndexedEventsByField(
      StoreNames.PAYMENT_ATTESTATION_EVENTS,
      'authorPubkey',
      authorPubkey,
      limit
    )
  }

  async getPaymentAttestationsForTargetEvent(targetEventId: string, limit = 20): Promise<Event[]> {
    return this.getIndexedEventsByField(
      StoreNames.PAYMENT_ATTESTATION_EVENTS,
      'targetEventId',
      targetEventId,
      limit
    )
  }

  async getPaymentSuperchatEventsMatchingFilters(filters: Filter[], maxMatches: number): Promise<Event[]> {
    const out: Event[] = []
    const seen = new Set<string>()
    const push = (events: Event[]) => {
      for (const ev of events) {
        if (shouldDropEventOnIngest(ev)) continue
        if (seen.has(ev.id)) continue
        seen.add(ev.id)
        out.push(ev)
      }
    }

    for (const filter of filters) {
      const kindsList = filter.kinds
      const want9740 =
        !kindsList?.length ||
        kindsList.includes(ExtendedKind.PAYMENT_NOTIFICATION)
      const want9741 = !kindsList?.length || kindsList.includes(ExtendedKind.PAYMENT_ATTESTATION)
      const limit = Math.min(filter.limit ?? maxMatches, maxMatches)

      if (want9740) {
        const pTags = filter['#p']
        if (Array.isArray(pTags)) {
          for (const p of pTags) {
            if (typeof p !== 'string') continue
            push(await this.getPaymentNotificationsForRecipient(p, limit))
          }
        }
        const eTags = filter['#e']
        if (Array.isArray(eTags)) {
          for (const eid of eTags) {
            if (typeof eid !== 'string') continue
            push(await this.getPaymentNotificationsForReferencedEvent(eid, limit))
          }
        }
        const aTags = filter['#a']
        if (Array.isArray(aTags)) {
          for (const coord of aTags) {
            if (typeof coord !== 'string') continue
            push(await this.getPaymentNotificationsForReferencedCoordinate(coord, limit))
          }
        }
      }

      if (want9741 && Array.isArray(filter.authors)) {
        for (const author of filter.authors) {
          if (typeof author !== 'string') continue
          push(await this.getPaymentAttestationsForAuthor(author, limit))
        }
      }

      if (Array.isArray(filter.ids)) {
        await this.initPromise
        for (const id of filter.ids) {
          if (typeof id !== 'string' || !/^[0-9a-f]{64}$/i.test(id)) continue
          const hex = id.toLowerCase()
          if (this.db?.objectStoreNames.contains(StoreNames.PAYMENT_NOTIFICATION_EVENTS)) {
            const ev = await new Promise<Event | undefined>((resolve) => {
              const tx = this.db!.transaction(StoreNames.PAYMENT_NOTIFICATION_EVENTS, 'readonly')
              const req = tx.objectStore(StoreNames.PAYMENT_NOTIFICATION_EVENTS).get(hex)
              req.onsuccess = () => resolve((req.result as PaymentNotificationIdbRow | undefined)?.value)
              req.onerror = () => resolve(undefined)
            })
            if (ev) push([ev])
          }
          if (this.db?.objectStoreNames.contains(StoreNames.PAYMENT_ATTESTATION_EVENTS)) {
            const ev = await new Promise<Event | undefined>((resolve) => {
              const tx = this.db!.transaction(StoreNames.PAYMENT_ATTESTATION_EVENTS, 'readonly')
              const req = tx.objectStore(StoreNames.PAYMENT_ATTESTATION_EVENTS).get(hex)
              req.onsuccess = () => resolve((req.result as PaymentAttestationIdbRow | undefined)?.value)
              req.onerror = () => resolve(undefined)
            })
            if (ev) push([ev])
          }
        }
      }

      if (out.length >= maxMatches) break
    }

    return out
      .filter((ev) => eventMatchesAnyLocalFeedFilter(ev, filters))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, maxMatches)
  }
}

const instance = IndexedDbService.getInstance()
export default instance
