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

  if (ev.kind === kinds.Metadata) {
    try {
      const o = JSON.parse(ev.content || '{}') as {
        name?: unknown
        display_name?: unknown
        about?: unknown
        nip05?: unknown
      }
      const pick = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : '')
      const nip05 = pick(o.nip05)
      const blob = [pick(o.name), pick(o.display_name), pick(o.about), nip05]
        .filter(Boolean)
        .join(' ')
      if (blob.includes(q)) return true
      const qNeedle = q.startsWith('@') ? q.slice(1) : q
      if (q.startsWith('@') && qNeedle.length > 0 && blob.includes(qNeedle)) return true
    } catch {
      /* ignore invalid profile JSON */
    }
  }

  return false
}
