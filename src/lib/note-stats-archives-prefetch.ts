import nostrArchivesApi from '@/services/nostr-archives-api.service'
import noteStatsService from '@/services/note-stats.service'
import type { TArchivesInteractionCounts } from '@/types/nostr-archives'

const BATCH_DELAY_MS = 48
const MAX_BATCH_SIZE = 20
const PREFETCH_CONCURRENCY = 5
const RECENT_TTL_MS = 5 * 60_000

const pending = new Set<string>()
const inFlight = new Set<string>()
const recentById = new Map<string, number>()
let batchTimer: ReturnType<typeof setTimeout> | null = null

function normalizeHexNoteId(noteId: string): string | null {
  const hex = noteId.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null
}

function markRecent(id: string): void {
  recentById.set(id, Date.now())
  if (recentById.size > 500) {
    const cutoff = Date.now() - RECENT_TTL_MS
    for (const [k, t] of recentById) {
      if (t < cutoff) recentById.delete(k)
    }
  }
}

function scheduleBatch(): void {
  if (batchTimer != null) return
  batchTimer = setTimeout(() => {
    batchTimer = null
    void flushBatch()
  }, BATCH_DELAY_MS)
}

async function flushBatch(): Promise<void> {
  if (!nostrArchivesApi.isAvailable()) {
    pending.clear()
    return
  }

  const batch: string[] = []
  for (const id of pending) {
    if (batch.length >= MAX_BATCH_SIZE) break
    if (inFlight.has(id)) continue
    const recentAt = recentById.get(id)
    if (recentAt != null && Date.now() - recentAt < RECENT_TTL_MS) {
      pending.delete(id)
      continue
    }
    batch.push(id)
    pending.delete(id)
  }

  let cursor = 0
  const worker = async () => {
    while (cursor < batch.length) {
      if (!nostrArchivesApi.isAvailable()) return
      const id = batch[cursor++]!
      inFlight.add(id)
      try {
        const res = await nostrArchivesApi.getEventInteractions(id)
        if (res.ok) {
          markRecent(id)
          noteStatsService.applyArchivesInteractionCounts(id, res.data)
        }
      } finally {
        inFlight.delete(id)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PREFETCH_CONCURRENCY, batch.length) }, () => worker())
  )

  if (pending.size > 0) scheduleBatch()
}

/** Queue Archives interaction counts for a note (batched; no-op when API unavailable). */
export function queueArchivesInteractionPrefetch(noteId: string): void {
  const hex = normalizeHexNoteId(noteId)
  if (!hex || !nostrArchivesApi.isAvailable()) return
  if (inFlight.has(hex)) return
  const recentAt = recentById.get(hex)
  if (recentAt != null && Date.now() - recentAt < RECENT_TTL_MS) return
  pending.add(hex)
  scheduleBatch()
}

export function resetArchivesInteractionPrefetchForTests(): void {
  pending.clear()
  inFlight.clear()
  recentById.clear()
  if (batchTimer != null) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
}

export type { TArchivesInteractionCounts }
