import { ExtendedKind, isNip52CalendarCardKind, NIP71_VIDEO_KINDS } from '@/constants'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { getEventArchiveConfig } from '@/lib/event-archive-config'
import { isNip18RepostKind, isNip25ReactionKind, isReplaceableEvent } from '@/lib/event'
import logger from '@/lib/logger'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import indexedDb from '@/services/indexed-db.service'

/** “Primary” notes / threads — evicted last. */
const CORE_FEED_KINDS = new Set<number>([
  kinds.ShortTextNote,
  11,
  ExtendedKind.COMMENT,
  ExtendedKind.PICTURE,
  ...NIP71_VIDEO_KINDS,
  9802 // highlights
])

let footprint: { count: number; bytes: number } | null = null
const pending = new Map<string, Event>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let archiveFlushInProgress = false

/** Hard cap so a relay flood cannot grow an unbounded RAM queue before the first flush. */
const MAX_PENDING_ARCHIVE = 4000
/** IndexedDB + trim work per flush so one timer tick cannot process tens of thousands of rows. */
const MAX_ARCHIVE_ROWS_PER_FLUSH = 150

export function invalidateArchiveFootprintCache(): void {
  footprint = null
}

async function ensureFootprint(): Promise<void> {
  if (footprint === null) {
    footprint = await indexedDb.getArchiveFootprint()
  }
}

function archiveTierForEvent(ev: Event): number {
  if (isNip25ReactionKind(ev.kind) || ev.kind === kinds.Zap || isNip18RepostKind(ev.kind)) {
    return 0
  }
  if (CORE_FEED_KINDS.has(ev.kind)) return 2
  return 1
}

function shouldSkipArchiving(ev: Event): boolean {
  if (shouldDropEventOnIngest(ev)) return true
  if (isNip52CalendarCardKind(ev.kind) || ev.kind === ExtendedKind.CALENDAR_EVENT_RSVP) return true
  if (
    ev.kind === ExtendedKind.PAYMENT_NOTIFICATION ||
    ev.kind === ExtendedKind.PAYMENT_ATTESTATION
  ) {
    return true
  }
  if (isReplaceableEvent(ev.kind) && indexedDb.hasReplaceableEventStoreForKind(ev.kind)) {
    return true
  }
  return false
}

function approxEventBytes(ev: Event): number {
  try {
    return new Blob([JSON.stringify(ev)]).size
  } catch {
    return 512
  }
}

async function trimArchiveIfNeeded(): Promise<void> {
  const cfg = getEventArchiveConfig()
  await ensureFootprint()
  let guard = 0
  while (
    footprint !== null &&
    guard < 5000 &&
    (footprint.count > cfg.maxEvents || footprint.bytes > cfg.maxBytes)
  ) {
    guard++
    const victim = await indexedDb.deleteNextEvictionArchiveCandidate()
    if (!victim) {
      footprint = await indexedDb.getArchiveFootprint()
      break
    }
    footprint.count = Math.max(0, footprint.count - 1)
    footprint.bytes = Math.max(0, footprint.bytes - victim.approxBytes)
  }
}

async function flushArchiveQueue(): Promise<void> {
  if (archiveFlushInProgress) return
  archiveFlushInProgress = true
  try {
    while (pending.size > 0) {
      const batch: Event[] = []
      for (const id of pending.keys()) {
        if (batch.length >= MAX_ARCHIVE_ROWS_PER_FLUSH) break
        const ev = pending.get(id)
        if (ev) {
          pending.delete(id)
          batch.push(ev)
        }
      }
      if (batch.length === 0) break
      for (const ev of batch) {
        if (shouldSkipArchiving(ev)) continue
        const id = /^[0-9a-f]{64}$/i.test(ev.id) ? ev.id.toLowerCase() : ev.id
        const tier = archiveTierForEvent(ev)
        const bytes = approxEventBytes(ev)
        try {
          await indexedDb.putArchivedEventRow(ev, tier, bytes)
        } catch (e) {
          logger.warn('[EventArchive] put failed', { id: id.slice(0, 8), e })
        }
      }
    }
    footprint = await indexedDb.getArchiveFootprint()
    await trimArchiveIfNeeded()
  } catch (e) {
    logger.warn('[EventArchive] flush failed', { e })
  } finally {
    archiveFlushInProgress = false
  }
  if (pending.size > 0) {
    void flushArchiveQueue().catch((e) => logger.warn('[EventArchive] flush', e))
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null || archiveFlushInProgress) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushArchiveQueue().catch((e) => logger.warn('[EventArchive] flush', e))
  }, 450)
}

/** Queue a non-replaceable event for IndexedDB archive (mobile + desktop web; caps differ). */
export function queuePersistSeenEvent(ev: Event): void {
  if (shouldSkipArchiving(ev)) return
  const id = /^[0-9a-f]{64}$/i.test(ev.id) ? ev.id.toLowerCase() : ev.id
  if (!/^[0-9a-f]{64}$/.test(id)) return
  while (pending.size >= MAX_PENDING_ARCHIVE) {
    const first = pending.keys().next().value
    if (first === undefined) break
    pending.delete(first)
  }
  pending.set(id, ev)
  scheduleFlush()
}

export async function loadArchivedEventForFetch(hexId: string): Promise<Event | undefined> {
  const ev = await indexedDb.getArchivedEventById(hexId, true)
  if (!ev || shouldDropEventOnIngest(ev)) return undefined
  return ev
}

export async function prefetchArchivedEvents(hexIds: string[]): Promise<Event[]> {
  if (hexIds.length === 0) return []
  return indexedDb.getArchivedEventsByIds(hexIds)
}
