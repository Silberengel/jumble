import type { Event } from 'nostr-tools'
import { nip19 } from 'nostr-tools'

/** Tag values joined for tags whose first letter is `name` (e.g. `title`, `summary`). */
function citationTagLine(ev: Event, name: string): string {
  const parts: string[] = []
  for (const row of ev.tags ?? []) {
    if (row[0] !== name) continue
    const rest = row.slice(1).filter(Boolean)
    if (rest.length) parts.push(rest.join(' '))
  }
  return parts.join(' ')
}

/**
 * Lowercased haystack for NIP-32 citation kinds: body plus common metadata tags
 * (title, summary, author, identifiers, etc.). Used for client-side matching when
 * relays do not index these fields for NIP-50.
 */
export function citationPickerHaystack(ev: Event): string {
  const chunks = [
    ev.content ?? '',
    citationTagLine(ev, 'title'),
    citationTagLine(ev, 'summary'),
    citationTagLine(ev, 'author'),
    citationTagLine(ev, 'chapter_title'),
    citationTagLine(ev, 'published_in'),
    citationTagLine(ev, 'published_by'),
    citationTagLine(ev, 'published_on'),
    citationTagLine(ev, 'accessed_on'),
    citationTagLine(ev, 'location'),
    citationTagLine(ev, 'u'),
    citationTagLine(ev, 'doi'),
    citationTagLine(ev, 'c'),
    citationTagLine(ev, 'llm'),
    citationTagLine(ev, 'page_range'),
    citationTagLine(ev, 'editor'),
    citationTagLine(ev, 'version')
  ]
  return chunks.join('\n').toLowerCase()
}

export function citationPickerMatchesQuery(ev: Event, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const h = citationPickerHaystack(ev)
  if (h.includes(q)) return true
  const words = q.split(/\s+/).filter((w) => w.length > 1)
  if (words.length >= 2 && words.every((w) => h.includes(w))) return true
  return false
}

/** Hex id, `note1…`, or `nevent1…` for direct citation lookup. */
export function tryParseCitationEventIdFromQuery(query: string): string | null {
  const t = query.trim()
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase()
  try {
    const d = nip19.decode(t)
    if (d.type === 'note') return d.data as string
    if (d.type === 'nevent') return d.data.id
  } catch {
    /* ignore */
  }
  return null
}
