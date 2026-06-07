/** Project Gutenberg cover art: https://www.gutenberg.org/cache/epub/{id}/pg{id}.cover.medium.jpg */

const GUTENBERG_EBOOK_URL = /gutenberg\.org\/ebooks\/(\d+)/i
const GUTENBERG_FILES_URL = /gutenberg\.org\/files\/(\d+)/i
const GUTENBERG_CACHE_URL = /gutenberg\.org\/cache\/epub\/(\d+)/i
/** `pg63983.cover.medium.jpg`, `pg292405.jpg`, … on any host (e.g. nostr.build mirrors). */
const PG_COVER_FILENAME = /[/\s]pg(\d+)(?:\.cover\.(?:small|medium)\.jpg|\.jpg)/i
/** Legacy publication d-tags: `pg28217-dante-et-goethe-dialogues`, `pg28217`, … */
const GUTENBERG_DTAG = /^pg(\d+)(?:-.*)?$/i

const DIRECT_IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i

export function parseGutenbergEbookId(source: string): string | null {
  const trimmed = source.trim()
  if (!trimmed) return null
  for (const pattern of [GUTENBERG_EBOOK_URL, GUTENBERG_FILES_URL, GUTENBERG_CACHE_URL]) {
    const match = trimmed.match(pattern)
    if (match?.[1]) return match[1]
  }
  const fromFilename = trimmed.match(PG_COVER_FILENAME)
  if (fromFilename?.[1]) return fromFilename[1]
  return null
}

export type GutenbergCoverSize = 'small' | 'medium'

export function gutenbergCoverImageUrl(ebookId: string, size: GutenbergCoverSize = 'medium'): string {
  const id = ebookId.trim()
  return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.${size}.jpg`
}

/** Use smaller cover art in library grids (faster download, sufficient at card size). */
export function gutenbergLibraryCoverImageUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed.toLowerCase().includes('gutenberg')) return trimmed
  const id = parseGutenbergEbookId(trimmed)
  if (!id) return trimmed
  return gutenbergCoverImageUrl(id, 'small')
}

export function gutenbergEbookPageUrl(ebookId: string): string {
  return `https://www.gutenberg.org/ebooks/${ebookId.trim()}`
}

/** Parse Project Gutenberg ebook id from a kind-30040 `d` tag (e.g. `pg28217-…`). */
export function parseGutenbergEbookIdFromDTag(dTag: string): string | null {
  const trimmed = dTag.trim()
  if (!trimmed) return null
  const match = trimmed.match(GUTENBERG_DTAG)
  return match?.[1] ?? null
}

/** When `source` points at Project Gutenberg, return the standard medium cover URL. */
export function resolveGutenbergCoverImageUrl(source: string | undefined): string | undefined {
  if (!source?.trim()) return undefined
  if (!source.toLowerCase().includes('gutenberg')) return undefined
  const id = parseGutenbergEbookId(source)
  if (!id) return undefined
  return gutenbergCoverImageUrl(id)
}

/**
 * Normalize a publication `image` tag URL. Gutenberg ebook/files pages become cache cover JPGs;
 * direct `.jpg` / cache cover URLs are kept as-is.
 */
export function normalizeGutenbergCoverImageUrl(url: string): string {
  const trimmed = url.trim()
  const id = parseGutenbergEbookId(trimmed)
  if (!id) return trimmed
  if (trimmed.toLowerCase().includes('gutenberg.org')) {
    if (DIRECT_IMAGE_EXT.test(trimmed)) return trimmed
    return gutenbergCoverImageUrl(id)
  }
  // Third-party PG mirror filename — canonical Gutenberg CDN cover.
  if (PG_COVER_FILENAME.test(trimmed)) return gutenbergCoverImageUrl(id)
  if (trimmed.toLowerCase().includes('gutenberg')) return gutenbergCoverImageUrl(id)
  return trimmed
}

/**
 * Ordered cover URLs to try. Medium is always first (matches detail panel); library may also try small.
 * Non-gutenberg.org mirrors (e.g. nostr.build) keep the original URL, then fall back to gutenberg.org.
 */
export function gutenbergCoverCandidateUrls(url: string, includeSmallFallback: boolean): string[] {
  const trimmed = url.trim()
  if (!trimmed) return []
  const id = parseGutenbergEbookId(trimmed)
  if (!id) return [trimmed]

  const canonical: string[] = [
    gutenbergCoverImageUrl(id, 'medium'),
    ...(includeSmallFallback ? [gutenbergCoverImageUrl(id, 'small')] : [])
  ]

  if (!trimmed.toLowerCase().includes('gutenberg.org')) {
    const ordered = [trimmed]
    for (const candidate of canonical) {
      if (!ordered.includes(candidate)) ordered.push(candidate)
    }
    return ordered
  }

  const ordered = [...canonical]
  for (const candidate of [normalizeGutenbergCoverImageUrl(trimmed), trimmed]) {
    if (!ordered.includes(candidate)) ordered.push(candidate)
  }
  return ordered
}
