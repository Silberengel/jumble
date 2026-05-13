import { profileKind0MatchesSearchQuery } from '@/lib/profile-metadata-search'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/**
 * Whether `query` matches `ev` for local / client-side “full text” discovery aligned with NIP-50 intent:
 * substring match over id, pubkey, stringified kind, raw content, every tag cell, and (for kind 0) parsed
 * profile fields. No row is a hit on recency alone — the term must appear in one of these fields.
 */
export function eventMatchesNip50LocalFullTextQuery(ev: Event, query: string): boolean {
  const raw = query.trim()
  const q = raw.toLowerCase()
  if (!q) return false

  const decodedAuthor = decodeProfileSearchQueryToPubkeyHex(raw)
  if (decodedAuthor && ev.pubkey.toLowerCase() === decodedAuthor) return true

  if (ev.kind === kinds.Metadata && profileKind0MatchesSearchQuery(ev, raw)) return true

  if (ev.id.toLowerCase().includes(q)) return true
  if (ev.pubkey.toLowerCase().includes(q)) return true
  if (String(ev.kind).includes(q)) return true
  if ((ev.content ?? '').toLowerCase().includes(q)) return true
  for (const tag of ev.tags ?? []) {
    if (!Array.isArray(tag)) continue
    for (const cell of tag) {
      if (String(cell).toLowerCase().includes(q)) return true
    }
  }

  return false
}
