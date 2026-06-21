import { StorageKey } from '@/constants'
import { isMobileBrowserProfile } from '@/lib/client-platform'

/** Avoid importing local-storage.service (pulls indexedDb → client.service during module init). */
function isCacheRelaysEnabledSync(): boolean {
  try {
    return window.localStorage.getItem(StorageKey.CACHE_RELAYS_ENABLED) !== 'false'
  } catch {
    return true
  }
}

/** Caps when cache relays are enabled — browser note archive stays minimal. */
export const LIGHT_ARCHIVE_DEFAULTS = {
  sessionLruMobile: 150,
  sessionLruDesktopBrowser: 5000,
  maxMbMobile: 32,
  maxMbDesktopBrowser: 64,
  maxEventsMobile: 400,
  maxEventsDesktopBrowser: 800
} as const

export type TNotePersistencePolicy = {
  /** True when cache relays are enabled and at least one URL is configured. */
  lightArchive: boolean
  sessionLruMax: number
  archiveMaxEvents: number
  archiveMaxBytes: number
  /** Bulk timeline ingest → EVENT_ARCHIVE. */
  persistFeedNotesToArchive: boolean
  /** Broad archive cursor scans in local feed helpers. */
  scanArchiveOnLocalFeed: boolean
  /** Open note / bookmark → keep a small durable copy in EVENT_ARCHIVE. */
  foregroundMicroArchive: boolean
}

let cacheRelayUrlsHint: string[] = []

/** Updated from NostrProvider when kind 10432 or the device toggle changes. */
export function bindLightArchiveCacheRelayUrls(urls: readonly string[]): void {
  cacheRelayUrlsHint = [...urls]
}

export function getLightArchiveCacheRelayUrlsHint(): readonly string[] {
  return cacheRelayUrlsHint
}

export function isLightArchiveActiveSync(): boolean {
  return isCacheRelaysEnabledSync() && cacheRelayUrlsHint.length > 0
}

function readPositiveInt(key: string, fallback: number): number {
  try {
    const v = window.localStorage.getItem(key)
    if (v === null || v === '' || v === '0') return fallback
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

function defaultSessionLruForMode(light: boolean): number {
  if (isMobileBrowserProfile()) {
    return light ? LIGHT_ARCHIVE_DEFAULTS.sessionLruMobile : 100
  }
  return light ? LIGHT_ARCHIVE_DEFAULTS.sessionLruDesktopBrowser : 2500
}

function defaultMaxMbForMode(light: boolean): number {
  if (isMobileBrowserProfile()) {
    return light ? LIGHT_ARCHIVE_DEFAULTS.maxMbMobile : 48
  }
  return light ? LIGHT_ARCHIVE_DEFAULTS.maxMbDesktopBrowser : 2048
}

function defaultMaxEventsForMode(light: boolean): number {
  if (isMobileBrowserProfile()) {
    return light ? LIGHT_ARCHIVE_DEFAULTS.maxEventsMobile : 500
  }
  return light ? LIGHT_ARCHIVE_DEFAULTS.maxEventsDesktopBrowser : 80_000
}

/** Single source for session LRU + EVENT_ARCHIVE behavior (full vs light-archive). */
export function getNotePersistencePolicy(): TNotePersistencePolicy {
  const light = isLightArchiveActiveSync()
  const sessionDefault = defaultSessionLruForMode(light)
  const mbDefault = defaultMaxMbForMode(light)
  const eventsDefault = defaultMaxEventsForMode(light)

  const sessionLruMax = readPositiveInt(StorageKey.SESSION_EVENT_LRU_MAX, sessionDefault)
  const maxMb = readPositiveInt(StorageKey.EVENT_ARCHIVE_MAX_MB, mbDefault)
  const maxEvents = readPositiveInt(StorageKey.EVENT_ARCHIVE_MAX_EVENTS, eventsDefault)

  return {
    lightArchive: light,
    sessionLruMax: Math.max(32, Math.min(200_000, sessionLruMax)),
    archiveMaxEvents: Math.max(light ? 0 : 50, maxEvents),
    archiveMaxBytes: Math.max(light ? 4 : 8, maxMb) * 1024 * 1024,
    persistFeedNotesToArchive: !light,
    scanArchiveOnLocalFeed: !light,
    foregroundMicroArchive: light
  }
}
