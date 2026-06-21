import { isMobileBrowserProfile } from '@/lib/client-platform'
import { LIGHT_ARCHIVE_DEFAULTS, getNotePersistencePolicy } from '@/lib/note-persistence-policy'

/** Removed from settings; strip so manual `localStorage` edits cannot flip archive behavior. */
const LEGACY_EVENT_ARCHIVE_ENABLED_KEY = 'eventArchiveEnabled'
let legacyEventArchiveEnabledKeyRemoved = false

/** Platform defaults (overridable in Cache settings) when not in light-archive mode. */
export const EVENT_ARCHIVE_DEFAULTS = {
  sessionLruMobile: 100,
  sessionLruDesktopBrowser: 2500,
  maxMbMobile: 48,
  maxMbDesktopBrowser: 2048,
  maxEventsMobile: 500,
  maxEventsDesktopBrowser: 80_000
} as const

export type TEventArchiveConfig = {
  /** Soft byte budget (approximate, from JSON size). */
  maxBytes: number
  maxEvents: number
  sessionLruMax: number
  lightArchive: boolean
}

/**
 * Effective archive + session LRU limits (Cache settings + light-archive policy from cache relays).
 */
export function getEventArchiveConfig(): TEventArchiveConfig {
  if (typeof window !== 'undefined' && !legacyEventArchiveEnabledKeyRemoved) {
    legacyEventArchiveEnabledKeyRemoved = true
    try {
      window.localStorage.removeItem(LEGACY_EVENT_ARCHIVE_ENABLED_KEY)
    } catch {
      // ignore
    }
  }
  const policy = getNotePersistencePolicy()
  return {
    maxBytes: policy.archiveMaxBytes,
    maxEvents: policy.archiveMaxEvents,
    sessionLruMax: policy.sessionLruMax,
    lightArchive: policy.lightArchive
  }
}

/** Session LRU max (respects light-archive policy and manual overrides). */
export function getDefaultSessionLruMaxSync(): number {
  return getNotePersistencePolicy().sessionLruMax
}

/** Hint text for Cache settings — platform defaults before overrides. */
export function eventArchiveDefaultsHintValues(): {
  lru: number
  mb: number
  ev: number
  light: boolean
} {
  const policy = getNotePersistencePolicy()
  if (policy.lightArchive) {
    return {
      light: true,
      lru: isMobileBrowserProfile()
        ? LIGHT_ARCHIVE_DEFAULTS.sessionLruMobile
        : LIGHT_ARCHIVE_DEFAULTS.sessionLruDesktopBrowser,
      mb: isMobileBrowserProfile()
        ? LIGHT_ARCHIVE_DEFAULTS.maxMbMobile
        : LIGHT_ARCHIVE_DEFAULTS.maxMbDesktopBrowser,
      ev: isMobileBrowserProfile()
        ? LIGHT_ARCHIVE_DEFAULTS.maxEventsMobile
        : LIGHT_ARCHIVE_DEFAULTS.maxEventsDesktopBrowser
    }
  }
  return {
    light: false,
    lru: isMobileBrowserProfile()
      ? EVENT_ARCHIVE_DEFAULTS.sessionLruMobile
      : EVENT_ARCHIVE_DEFAULTS.sessionLruDesktopBrowser,
    mb: isMobileBrowserProfile()
      ? EVENT_ARCHIVE_DEFAULTS.maxMbMobile
      : EVENT_ARCHIVE_DEFAULTS.maxMbDesktopBrowser,
    ev: isMobileBrowserProfile()
      ? EVENT_ARCHIVE_DEFAULTS.maxEventsMobile
      : EVENT_ARCHIVE_DEFAULTS.maxEventsDesktopBrowser
  }
}
