import { ExtendedKind } from '@/constants'
import { getLatestEvent } from '@/lib/event'
import { normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import type { QueryService } from '@/services/client-query.service'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/** Replaceable list kinds the logged-in viewer publishes to their write outboxes. */
export const VIEWER_LIST_REPLACEABLE_KINDS: readonly number[] = [
  kinds.RelayList,
  ExtendedKind.FAVORITE_RELAYS,
  ExtendedKind.BLOCKED_RELAYS,
  ExtendedKind.CACHE_RELAYS,
  ExtendedKind.HTTP_RELAY_LIST
]

export function dedupeWriteOutboxUrls(writeUrls: readonly string[], max = 8): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of writeUrls) {
    const n = normalizeAnyRelayUrl(raw) || normalizeUrl(raw) || raw.trim()
    if (!n) continue
    const key = n.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
    if (out.length >= max) break
  }
  return out
}

/**
 * Fetch the viewer's published list replaceables from each NIP-65 write outbox individually.
 * List events are usually on outboxes, not profile index relays.
 */
export async function fetchViewerListReplaceablesFromWriteOutboxes(
  queryService: QueryService,
  pubkey: string,
  writeUrls: readonly string[],
  options: {
    signal?: AbortSignal
    globalTimeout?: number
    eoseTimeout?: number
  }
): Promise<Map<number, Event>> {
  const out = new Map<number, Event>()
  const relays = dedupeWriteOutboxUrls(writeUrls)
  if (relays.length === 0) return out

  const fetchOpts = {
    signal: options.signal,
    globalTimeout: options.globalTimeout ?? 12_000,
    eoseTimeout: options.eoseTimeout ?? 4_000,
    foreground: true as const,
    replaceableRace: false as const,
    firstRelayResultGraceMs: false as const
  }

  const batches = await Promise.all(
    relays.map((url) =>
      queryService
        .fetchEvents(
          [url],
          {
            authors: [pubkey],
            kinds: [...VIEWER_LIST_REPLACEABLE_KINDS]
          },
          fetchOpts
        )
        .catch(() => [] as Event[])
    )
  )

  for (const events of batches) {
    for (const kind of VIEWER_LIST_REPLACEABLE_KINDS) {
      const best = getLatestEvent(events.filter((e) => e.kind === kind))
      if (!best) continue
      const prev = out.get(kind)
      if (!prev || prev.created_at < best.created_at) {
        out.set(kind, best)
      }
    }
  }
  return out
}

export function pickNewestListEvent(
  current: Event | undefined | null,
  incoming: Event | undefined | null
): Event | undefined {
  if (!incoming) return current ?? undefined
  if (!current) return incoming
  return incoming.created_at >= current.created_at ? incoming : current
}
