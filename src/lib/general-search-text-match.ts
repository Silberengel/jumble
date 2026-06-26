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
  'source',
  'type',
  'release_date',
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
/** Tag metadata only (no {@link Event.content}). */
export function metadataSearchHaystack(ev: Event): string {
  const chunks: string[] = []
  for (const name of GENERAL_SEARCH_TEXT_TAG_NAMES) {
    const line = tagLine(ev, name)
    if (line) chunks.push(line)
  }
  return chunks.join('\n').toLowerCase()
}

export function generalSearchHaystack(ev: Event): string {
  const chunks: string[] = [ev.content ?? '']
  for (const name of GENERAL_SEARCH_TEXT_TAG_NAMES) {
    const line = tagLine(ev, name)
    if (line) chunks.push(line)
  }
  return chunks.join('\n').toLowerCase()
}

/**
 * Fold typographic quotes/apostrophes to their ASCII equivalents so a straight apostrophe typed by the
 * user (o'clock) matches the curly one stored in the text (o’clock), and vice versa.
 */
export function foldTypographicQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
}

/**
 * Reduce text to lowercase alphanumeric tokens joined by single spaces so neither punctuation nor
 * typographic markup can block a phrase match. This deliberately mirrors how {@link findFlexiblePhraseSlice}
 * tokenizes the query (split on every non-alphanumeric run), keeping the "does it match?" gate and the
 * "where is it?" slice extractor in lockstep.
 *
 * Collapsing every non-`\p{L}\p{N}` run to a single space transparently handles, among others:
 * letter case; ASCII vs. curly quotes/apostrophes (o'clock ↔ o’clock); every dash variant and the
 * double-hyphen → em-dash rewrite; ellipsis (... ↔ …); the zero-width space AsciiDoctor inserts after
 * em-dashes; thin/non-breaking spaces; hard line breaks; and arbitrary runs of commas/periods/etc.
 */
export function normalizeSearchMatchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function phraseNeedlesForQuery(raw: string): string[] {
  const normalized = normalizeGeneralSearchQuery(raw).toLowerCase()
  const qSpace = normalized.replace(/-/g, ' ')
  return qSpace !== normalized ? [normalized, qSpace] : [normalized]
}

function haystackIncludesPhrase(haystack: string, needle: string): boolean {
  const matchHaystack = normalizeSearchMatchText(haystack)
  const matchNeedle = normalizeSearchMatchText(needle)
  return matchNeedle.length >= 2 && matchHaystack.includes(matchNeedle)
}

/** True when the raw query is wrapped in matching quote characters. */
export function isQuotedSearchQuery(raw: string): boolean {
  const s = raw.trim()
  return (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('“') && s.endsWith('”')) ||
    (s.startsWith('‘') && s.endsWith('’'))
  )
}

/** Contiguous phrase match only (no scattered-word fallback). */
export function haystackMatchesPhraseQuery(haystack: string, query: string): boolean {
  const raw = query.trim()
  if (!raw) return false

  for (const needle of phraseNeedlesForQuery(raw)) {
    if (haystackIncludesPhrase(haystack, needle)) return true
  }
  return false
}

/**
 * Relevance score for ranking search hits (higher = better).
 * Phrase hits dominate; scattered multi-word matches score much lower.
 */
export function scoreHaystackSearchQuery(haystack: string, query: string): number {
  const raw = query.trim()
  if (!raw) return 0

  const lower = foldTypographicQuotes(haystack.toLowerCase())

  if (isQuotedSearchQuery(raw)) {
    return haystackMatchesPhraseQuery(haystack, raw) ? 10_000 + normalizeGeneralSearchQuery(raw).length : 0
  }

  for (const needle of phraseNeedlesForQuery(raw)) {
    if (needle && haystackIncludesPhrase(haystack, needle)) return 10_000 + needle.length
  }

  const words = generalSearchQueryTerms(raw).map(foldTypographicQuotes)
  if (words.length >= 2) {
    const matched = words.filter((w) => lower.includes(w))
    if (matched.length === words.length) {
      return 100 * matched.length + matched.reduce((sum, w) => sum + w.length, 0)
    }
    if (matched.length >= 2) {
      return 10 * matched.length + matched.reduce((sum, w) => sum + w.length, 0)
    }
    return 0
  }

  if (words.length === 1 && lower.includes(words[0])) return words[0].length
  return 0
}

/** Substring / multi-word match over a pre-built lowercase haystack. */
export function haystackMatchesSearchQuery(haystack: string, query: string): boolean {
  return scoreHaystackSearchQuery(haystack, query) > 0
}

export function publicationContentSectionTitle(event: Event): string {
  for (const tag of event.tags ?? []) {
    if ((tag[0] || '').trim().toLowerCase() === 'title' && tag[1]?.trim()) {
      return tag[1].trim()
    }
  }
  return ''
}

/** Kind-30041 sections often split a sentence across `title` and `content` tags. */
export function publicationContentSectionHaystack(event: Event): string {
  const title = publicationContentSectionTitle(event)
  const body = event.content ?? ''
  if (!title) return body
  if (!body.trim()) return title
  return `${title}\n${body}`
}

/** Match kind-30041 section `title` + {@link Event.content}. */
export function publicationContentMatchesSearchQuery(ev: Event, query: string): boolean {
  return scorePublicationContentEventSearchQuery(ev, query) > 0
}

export function scorePublicationContentEventSearchQuery(event: Event, query: string): number {
  return scoreHaystackSearchQuery(publicationContentSectionHaystack(event).toLowerCase(), query)
}

/** Body-only scoring (legacy); prefer {@link scorePublicationContentEventSearchQuery}. */
export function scorePublicationContentSearchQuery(content: string, query: string): number {
  return scoreHaystackSearchQuery((content ?? '').toLowerCase(), query)
}

/** Best substring to highlight for a query that matched {@code haystack} (case preserved in caller). */
function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Locate the full phrase as it actually appears in {@code haystack}, tolerating any whitespace and
 * punctuation between query words (line breaks, commas, etc.). Returns the original-cased slice so the
 * whole matched passage can be highlighted, not just the first word.
 */
function findFlexiblePhraseSlice(haystack: string, raw: string): string | null {
  // Split on every non-alphanumeric run so punctuation between words (incl. apostrophes like the one in
  // "o'clock"/"o’clock") becomes a flexible separator and the whole passage is highlighted.
  const words = normalizeGeneralSearchQuery(raw)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
  if (words.length === 0) return null
  const pattern = words.map(escapeRegExpLiteral).join('[^\\p{L}\\p{N}]+')
  try {
    const match = new RegExp(pattern, 'iu').exec(haystack)
    return match?.[0] ?? null
  } catch {
    return null
  }
}

export function findSearchHighlightNeedle(haystack: string, query: string): string | null {
  const raw = query.trim()
  if (!raw) return null

  const lowerHaystack = foldTypographicQuotes(haystack.toLowerCase())

  for (const needle of phraseNeedlesForQuery(raw)) {
    if (haystackIncludesPhrase(haystack, needle)) {
      // Highlight the entire matched phrase as it appears in the text, not just the first word.
      const phraseSlice = findFlexiblePhraseSlice(haystack, raw)
      if (phraseSlice) return phraseSlice
      return needle
    }
  }

  const words = generalSearchQueryTerms(raw).map(foldTypographicQuotes)
  if (words.length >= 2 && words.every((w) => lowerHaystack.includes(w))) {
    for (const word of words) {
      const idx = lowerHaystack.indexOf(word)
      if (idx !== -1) return haystack.slice(idx, idx + word.length)
    }
  }

  if (words.length === 1) {
    const idx = lowerHaystack.indexOf(words[0])
    if (idx !== -1) return haystack.slice(idx, idx + words[0].length)
  }

  return null
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

  return haystackMatchesSearchQuery(generalSearchHaystack(ev), raw)
}
