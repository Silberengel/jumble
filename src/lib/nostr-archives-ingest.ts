import { archivesJsonToVerifiedEvent } from '@/lib/nostr-archives-event'
import logger from '@/lib/logger'
import client from '@/services/client.service'
import { loadArchivedEventForFetch } from '@/services/event-archive.service'

/**
 * Persist verified events from Nostr Archives into the session cache and IndexedDB archive queue.
 * Skips rows already in session or on-disk archive (no redundant writes).
 */
export async function persistArchivesEventsIfNew(
  rawEvents: readonly unknown[]
): Promise<{ ingested: number; skipped: number }> {
  let ingested = 0
  let skipped = 0

  for (const raw of rawEvents) {
    const ev = archivesJsonToVerifiedEvent(raw)
    if (!ev) {
      skipped += 1
      continue
    }
    const id = ev.id.toLowerCase()
    if (client.peekSessionCachedEvent(id)) {
      skipped += 1
      continue
    }
    const archived = await loadArchivedEventForFetch(id)
    if (archived) {
      skipped += 1
      client.addEventToCache(archived, { explicitNoteLookupHexId: id })
      continue
    }
    client.addEventToCache(ev, { explicitNoteLookupHexId: id })
    ingested += 1
  }

  if (ingested > 0) {
    logger.debug('[nostr-archives] persisted events to cache/archive', { ingested, skipped })
  }
  return { ingested, skipped }
}

/** Collect event-shaped values from mixed API payloads (lists, note page, thread). */
export function collectRawEventsFromArchivesPayload(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return []
  const o = payload as Record<string, unknown>
  const out: unknown[] = []

  const push = (v: unknown) => {
    if (v != null) out.push(v)
  }

  push(o.event)
  if (Array.isArray(o.events)) o.events.forEach(push)
  if (Array.isArray(o.notes)) {
    for (const n of o.notes) {
      if (n && typeof n === 'object') {
        const row = n as Record<string, unknown>
        push(row.event ?? row)
      }
    }
  }
  if (Array.isArray(o.replies)) o.replies.forEach(push)
  if (Array.isArray(o.ancestors)) o.ancestors.forEach(push)

  return out
}

export async function persistArchivesPayloadEvents(payload: unknown): Promise<void> {
  const raws = collectRawEventsFromArchivesPayload(payload)
  if (raws.length === 0) return
  await persistArchivesEventsIfNew(raws)
}
