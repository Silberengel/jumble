import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'

type SessionEventPeek = (hexId: string) => Event | undefined

/** Wired from client.service at init — avoids a static import cycle with client.service. */
let peekSessionCachedEvent: SessionEventPeek | null = null

export function bindLocalEventResolveSessionPeek(peek: SessionEventPeek) {
  peekSessionCachedEvent = peek
}

function normalizeHexIds(ids: readonly string[]): string[] {
  return [
    ...new Set(
      ids
        .map((x) => x.trim().toLowerCase())
        .filter((x) => /^[0-9a-f]{64}$/.test(x))
    )
  ]
}

/**
 * Resolve events by hex id from session LRU, hot archive, publication store, and replaceable list stores.
 * Replaceable kinds (bookmark lists, etc.) are not written to EVENT_ARCHIVE.
 */
export async function resolveLocalEventsByHexIds(ids: readonly string[]): Promise<Event[]> {
  const wanted = normalizeHexIds(ids)
  if (wanted.length === 0) return []

  const byId = new Map<string, Event>()

  if (peekSessionCachedEvent) {
    for (const id of wanted) {
      const sess = peekSessionCachedEvent(id)
      if (sess) byId.set(id, sess)
    }
  }

  const missingArchive = wanted.filter((id) => !byId.has(id))
  if (missingArchive.length > 0) {
    try {
      for (const ev of await indexedDb.getArchivedEventsByIds(missingArchive)) {
        byId.set(ev.id.toLowerCase(), ev)
      }
    } catch {
      /* optional */
    }
  }

  const missingPublication = wanted.filter((id) => !byId.has(id))
  await Promise.all(
    missingPublication.map(async (id) => {
      try {
        const ev = await indexedDb.getEventFromPublicationStore(id)
        if (ev) byId.set(id, ev)
      } catch {
        /* optional */
      }
    })
  )

  const missingReplaceable = wanted.filter((id) => !byId.has(id))
  if (missingReplaceable.length > 0) {
    try {
      for (const ev of await indexedDb.findStoredReplaceableEventsByIds(missingReplaceable)) {
        byId.set(ev.id.toLowerCase(), ev)
      }
    } catch {
      /* optional */
    }
  }

  const out: Event[] = []
  const seen = new Set<string>()
  for (const id of wanted) {
    const ev = byId.get(id)
    if (!ev || seen.has(ev.id)) continue
    seen.add(ev.id)
    out.push(ev)
  }
  return out
}
