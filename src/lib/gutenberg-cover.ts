/** Project Gutenberg cover art: https://www.gutenberg.org/cache/epub/{id}/pg{id}.cover.medium.jpg */

const GUTENBERG_EBOOK_URL = /gutenberg\.org\/ebooks\/(\d+)/i
const GUTENBERG_FILES_URL = /gutenberg\.org\/files\/(\d+)/i
const GUTENBERG_CACHE_URL = /gutenberg\.org\/cache\/epub\/(\d+)/i
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
  return null
}

export function gutenbergCoverImageUrl(ebookId: string): string {
  const id = ebookId.trim()
  return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`
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
  if (!trimmed.toLowerCase().includes('gutenberg')) return trimmed
  const id = parseGutenbergEbookId(trimmed)
  if (!id) return trimmed
  if (DIRECT_IMAGE_EXT.test(trimmed)) return trimmed
  return gutenbergCoverImageUrl(id)
}
