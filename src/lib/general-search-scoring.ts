import type { Event } from 'nostr-tools'

/**
 * Pure, dependency-light text scoring/normalization primitives shared by the main thread and the library
 * search Web Worker. Kept free of profile/citation/nip05 imports (which pull in `window`/network code) so
 * this module is safe to import inside a Worker. The thin `eventMatchesGeneralSearchQuery` wrapper that adds
 * npub/nevent/kind-0 resolution lives in `general-search-text-match.ts`, which re-exports everything here.
 */

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

/**
 * Common English function words that carry little discriminating power for relay token search. Used only
 * to pick the most distinctive window of a long passage for the relay query; never affects local matching.
 */
const RELAY_QUERY_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'it', 'its', 'this', 'that', 'these', 'those', 'i',
  'you', 'he', 'she', 'we', 'they', 'not', 'no', 'so', 'do', 'does', 'did', 'me', 'my', 'him', 'her',
  'them', 'his', 'their', 'our', 'all', 'how', 'what', 'when', 'where', 'who', 'why', 'from', 'up'
])

const DEFAULT_RELAY_QUERY_MAX_WORDS = 12
const DEFAULT_RELAY_QUERY_MAX_CHARS = 96

function relayQueryWordScore(word: string): number {
  const w = word.toLowerCase()
  if (!w || RELAY_QUERY_STOPWORDS.has(w)) return 0
  return w.length
}

/**
 * Long passages make relay content search (loose token-AND ranking) return nothing or bury the right
 * section, so we send the relay a bounded, distinctive contiguous window instead of the whole quote.
 * The full passage is still used for local matching, ranking, and highlighting — this only shapes the
 * string handed to the relay. Returns the query unchanged when it already fits the budget.
 */
export function buildRelayContentSearchQuery(
  raw: string,
  opts?: { maxWords?: number; maxChars?: number }
): string {
  const normalized = normalizeGeneralSearchQuery(raw)
  if (!normalized) return ''

  const maxWords = Math.max(1, opts?.maxWords ?? DEFAULT_RELAY_QUERY_MAX_WORDS)
  const maxChars = Math.max(1, opts?.maxChars ?? DEFAULT_RELAY_QUERY_MAX_CHARS)

  if (normalized.length <= maxChars) {
    const wordCount = normalized.split(/\s+/).filter(Boolean).length
    if (wordCount <= maxWords) return normalized
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return normalized.slice(0, maxChars).trim()

  const windowLen = Math.min(maxWords, words.length)
  let bestStart = 0
  let bestScore = -1
  for (let start = 0; start + windowLen <= words.length; start++) {
    let score = 0
    for (let i = start; i < start + windowLen; i++) score += relayQueryWordScore(words[i])
    if (score > bestScore) {
      bestScore = score
      bestStart = start
    }
  }

  const windowWords = words.slice(bestStart, bestStart + windowLen)
  // Clamp to the character budget at word boundaries (the window was chosen for distinctiveness, so
  // trimming trailing words keeps the most discriminating terms).
  while (windowWords.length > 1 && windowWords.join(' ').length > maxChars) {
    windowWords.pop()
  }
  return windowWords.join(' ')
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

/** Tag metadata only (no {@link Event.content}). */
export function metadataSearchHaystack(ev: Event): string {
  const chunks: string[] = []
  for (const name of GENERAL_SEARCH_TEXT_TAG_NAMES) {
    const line = tagLine(ev, name)
    if (line) chunks.push(line)
  }
  return chunks.join('\n').toLowerCase()
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

/** Shortest token we index/query; 1-char tokens are too unselective to be worth an index entry. */
const SEARCH_TOKEN_MIN_LEN = 2
/** Cap distinct tokens persisted per event so a single long section can't bloat the multiEntry index. */
const MAX_INDEXED_TOKENS_PER_EVENT = 256

/**
 * Distinct lowercase alphanumeric word tokens (length >= {@link SEARCH_TOKEN_MIN_LEN}) from {@code text},
 * in first-seen order. Tokenization mirrors {@link normalizeSearchMatchText} so persisted tokens line up
 * with how queries are tokenized for the IndexedDB token-index fast path.
 */
export function searchTextTokens(text: string, max: number = Number.POSITIVE_INFINITY): string[] {
  const normalized = normalizeSearchMatchText(text)
  if (!normalized) return []
  const seen = new Set<string>()
  for (const word of normalized.split(' ')) {
    if (word.length < SEARCH_TOKEN_MIN_LEN || seen.has(word)) continue
    seen.add(word)
    if (seen.size >= max) break
  }
  return Array.from(seen)
}

/** Word tokens persisted alongside a publication row for the IndexedDB token index. */
export function buildEventSearchTokens(ev: Event): string[] {
  return searchTextTokens(generalSearchHaystack(ev), MAX_INDEXED_TOKENS_PER_EVENT)
}

/** Word tokens for a search query, used to look up candidate rows in the token index. */
export function searchQueryTokens(query: string): string[] {
  return searchTextTokens(query)
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
 * Strict contiguous-phrase match over an event's readable text. Unlike `eventMatchesGeneralSearchQuery`,
 * this never matches on scattered shared words, so long passage queries only match the section that actually
 * contains the quote (used to keep the relevant section from being crowded out by recency-sorted noise).
 */
export function eventMatchesPhraseSearchQuery(ev: Event, query: string): boolean {
  const raw = query.trim()
  if (!raw) return false
  return haystackMatchesPhraseQuery(generalSearchHaystack(ev), raw)
}
