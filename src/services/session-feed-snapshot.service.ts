import type { Event } from 'nostr-tools'
import logger from '@/lib/logger'

/** Max events stored per feed key (matches typical initial timeline cap). */
const MAX_EVENTS_PER_FEED = 120
/** Max distinct feeds kept in memory for the tab session. */
const MAX_FEED_KEYS = 48

/** Survives normal reload (F5) within the same browser tab. */
const PERSISTED_FEEDS_SESSION_KEY = 'jumble:feedSnapshots'
/** Legacy one-shot key written by {@link hardReloadPreservingFeedSnapshots}. */
const HARD_REFRESH_SESSION_KEY = 'jumble:hardRefreshFeedSnapshots'

const snapshots = new Map<string, Event[]>()
const accessOrder: string[] = []

let persistDebounceId: ReturnType<typeof setTimeout> | null = null

function bumpAccess(key: string) {
  const i = accessOrder.indexOf(key)
  if (i >= 0) accessOrder.splice(i, 1)
  accessOrder.push(key)
  while (accessOrder.length > MAX_FEED_KEYS) {
    const oldest = accessOrder.shift()
    if (oldest) snapshots.delete(oldest)
  }
}

function persistFeedSnapshotsToSessionStorage(): void {
  try {
    if (snapshots.size === 0) {
      sessionStorage.removeItem(PERSISTED_FEEDS_SESSION_KEY)
      return
    }
    const payload: Record<string, Event[]> = {}
    for (const [k, rows] of snapshots) {
      if (rows?.length) {
        payload[k] = rows.map((e) => ({ ...e }))
      }
    }
    if (Object.keys(payload).length === 0) {
      sessionStorage.removeItem(PERSISTED_FEEDS_SESSION_KEY)
      return
    }
    sessionStorage.setItem(PERSISTED_FEEDS_SESSION_KEY, JSON.stringify(payload))
  } catch (e) {
    logger.warn('[feed-snapshot] Could not persist to sessionStorage', { error: e })
  }
}

function schedulePersistToSessionStorage(): void {
  if (typeof window === 'undefined') return
  if (persistDebounceId != null) clearTimeout(persistDebounceId)
  persistDebounceId = setTimeout(() => {
    persistDebounceId = null
    persistFeedSnapshotsToSessionStorage()
  }, 250)
}

function loadPayloadIntoMemory(payload: Record<string, unknown>, logLabel: string): number {
  let restored = 0
  for (const [k, rows] of Object.entries(payload)) {
    if (!k || !Array.isArray(rows) || rows.length === 0) continue
    const capped = rows
      .filter((e): e is Event => e != null && typeof (e as Event).id === 'string')
      .slice(0, MAX_EVENTS_PER_FEED)
      .map((e) => ({ ...e }))
    if (capped.length > 0) {
      setSessionFeedSnapshot(k, capped, { skipPersist: true })
      restored++
    }
  }
  if (restored > 0) {
    logger.info(`[feed-snapshot] ${logLabel}`, { feeds: restored })
  }
  return restored
}

/**
 * In-memory feed rows for the current tab session. Lets NoteList restore immediately when
 * remounting the same feed (page / spell / relay) and merge fresh REQ results on top.
 */
export function getSessionFeedSnapshot(key: string): Event[] | undefined {
  if (!key) return undefined
  const rows = snapshots.get(key)
  if (!rows?.length) return undefined
  bumpAccess(key)
  return rows
}

export function setSessionFeedSnapshot(
  key: string,
  events: readonly Event[],
  options?: { skipPersist?: boolean }
): void {
  if (!key) return
  const capped = events.slice(0, MAX_EVENTS_PER_FEED).map((e) => ({ ...e }))
  snapshots.set(key, capped)
  bumpAccess(key)
  if (!options?.skipPersist) {
    schedulePersistToSessionStorage()
  }
}

/**
 * Load feed snapshots from sessionStorage into memory (normal reload + legacy hard-reload key).
 * Call once during app bootstrap ({@link main.tsx}).
 */
export function restorePersistedFeedSnapshots(): void {
  try {
    const raw = sessionStorage.getItem(PERSISTED_FEEDS_SESSION_KEY)
    if (raw) {
      const payload = JSON.parse(raw) as Record<string, unknown>
      if (payload && typeof payload === 'object') {
        loadPayloadIntoMemory(payload, 'Restored from sessionStorage')
      }
    }

    const legacy = sessionStorage.getItem(HARD_REFRESH_SESSION_KEY)
    if (legacy) {
      sessionStorage.removeItem(HARD_REFRESH_SESSION_KEY)
      const payload = JSON.parse(legacy) as Record<string, unknown>
      if (payload && typeof payload === 'object') {
        loadPayloadIntoMemory(payload, 'Restored legacy hard-reload snapshots')
        persistFeedSnapshotsToSessionStorage()
      }
    }
  } catch (e) {
    logger.warn('[feed-snapshot] Could not restore from sessionStorage', { error: e })
  }
}

/**
 * Persist in-memory feed snapshots to sessionStorage, then call {@link window.location.reload}.
 * {@link restorePersistedFeedSnapshots} runs on next boot (see `main.tsx`).
 */
export function hardReloadPreservingFeedSnapshots(): void {
  persistFeedSnapshotsToSessionStorage()
  window.location.reload()
}

/** @deprecated Use {@link persistFeedSnapshotsToSessionStorage} — kept for callers. */
export function persistSessionFeedSnapshotsForHardRefresh(): void {
  persistFeedSnapshotsToSessionStorage()
}

/** @deprecated Use {@link restorePersistedFeedSnapshots}. */
export function restoreSessionFeedSnapshotsAfterHardRefresh(): void {
  restorePersistedFeedSnapshots()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (persistDebounceId != null) {
      clearTimeout(persistDebounceId)
      persistDebounceId = null
    }
    persistFeedSnapshotsToSessionStorage()
  })
}
