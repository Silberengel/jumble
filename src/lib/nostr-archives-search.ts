import { mergedSearchNoteHasPreviewBody } from '@/lib/merged-search-note-preview'
import nostrArchivesApi from '@/services/nostr-archives-api.service'
import type { Event } from 'nostr-tools'

export type TArchivesNotesSearchResult = {
  ok: boolean
  events: Event[]
  total: number
}

/**
 * Notes search via Nostr Archives REST (`GET /v1/notes/search`).
 * Verified events are persisted by the API client; returns empty when API is unavailable.
 */
export async function searchArchivesNotesForGeneralSearch(params: {
  query: string
  kinds: readonly number[]
  limit?: number
}): Promise<TArchivesNotesSearchResult> {
  const q = params.query.trim()
  if (!q || !nostrArchivesApi.isAvailable()) {
    return { ok: false, events: [], total: 0 }
  }

  const kindSet = new Set(params.kinds)
  if (kindSet.size === 0) return { ok: false, events: [], total: 0 }

  const res = await nostrArchivesApi.searchNotes({
    q,
    limit: Math.min(100, params.limit ?? 100),
    order: 'newest'
  })
  if (!res.ok) return { ok: false, events: [], total: 0 }

  const events = res.data.notes.filter((ev) => kindSet.has(ev.kind) && mergedSearchNoteHasPreviewBody(ev))
  return { ok: true, events, total: res.data.total }
}
