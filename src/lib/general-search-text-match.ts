import { tryParseCitationEventIdFromQuery } from '@/lib/citation-picker-search'
import { profileKind0MatchesSearchQuery } from '@/lib/profile-metadata-search'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/** Strip outer quotes and collapse whitespace for matching and relay index hints. */
export function normalizeGeneralSearchQuery(raw: string): string {
  let s = raw.trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('“') && s.endsWith('”')) ||
    (s.startsWith('‘') && s.endsWith('’'))
  ) {
    s = s.slice(1, -1).trim()
  }
  return s.replace(/\s+/g, ' ')
}

/** Significant terms for multi-word matching and optional relay `#t` / `search` hints. */
export function generalSearchQueryTerms(raw: string): string[] {
  const norm = normalizeGeneralSearchQuery(raw).toLowerCase()
  return norm
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length > 1)
}

/** Nostr tag names whose values are human-readable text for general search. */
const GENERAL_SEARCH_TEXT_TAG_NAMES = new Set([
  'title',
  'summary',
  'description',
  'context',
  'subject',
  'name',
  'alt',
  'caption',
  'd',
  't',
  'author',
  'chapter_title',
  'published_in',
  'published_by',
  'location',
  'editor',
  'version',
  'llm'
])

function tagLine(ev: Event, name: string): string {
  const parts: string[] = []
  for (const row of ev.tags ?? []) {
    if (!Array.isArray(row) || row[0] !== name) continue
    const rest = row.slice(1).filter(Boolean)
    if (rest.length) parts.push(rest.join(' '))
  }
  return parts.join(' ')
}

/**
 * Lowercased haystack from human-readable fields only: `content`, common metadata tags
 * (title, summary, description, context, …), and kind-0 profile JSON fields.
 */
export function generalSearchHaystack(ev: Event): string {
  const chunks: string[] = [ev.content ?? '']
  for (const name of GENERAL_SEARCH_TEXT_TAG_NAMES) {
    const line = tagLine(ev, name)
    if (line) chunks.push(line)
  }
  return chunks.join('\n').toLowerCase()
}

/**
 * Client-side “general search”: substring match over readable text fields (not raw id/pubkey/kind).
 * Still resolves npub/nprofile/hex author, note/nevent id, and kind-0 profile queries.
 */
export function eventMatchesGeneralSearchQuery(ev: Event, query: string): boolean {
  const raw = query.trim()
  if (!raw) return false

  const decodedAuthor = decodeProfileSearchQueryToPubkeyHex(raw)
  if (decodedAuthor && ev.pubkey.toLowerCase() === decodedAuthor) return true

  const eventId = tryParseCitationEventIdFromQuery(raw)
  if (eventId && ev.id.toLowerCase() === eventId) return true

  if (ev.kind === kinds.Metadata && profileKind0MatchesSearchQuery(ev, raw)) return true

  const normalized = normalizeGeneralSearchQuery(raw)
  const q = normalized.toLowerCase()
  const qSpace = q.replace(/-/g, ' ')
  const needles = qSpace !== q ? [q, qSpace] : [q]

  const haystack = generalSearchHaystack(ev)
  for (const needle of needles) {
    if (needle && haystack.includes(needle)) return true
  }

  const words = generalSearchQueryTerms(raw)
  if (words.length >= 2 && words.every((w) => haystack.includes(w))) return true

  return false
}
