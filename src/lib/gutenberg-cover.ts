/** Project Gutenberg cover art: https://www.gutenberg.org/cache/epub/{id}/pg{id}.cover.medium.jpg */

const GUTENBERG_EBOOK_URL = /gutenberg\.org\/ebooks\/(\d+)/i
const GUTENBERG_FILES_URL = /gutenberg\.org\/files\/(\d+)/i

export function parseGutenbergEbookId(source: string): string | null {
  const trimmed = source.trim()
  if (!trimmed) return null
  for (const pattern of [GUTENBERG_EBOOK_URL, GUTENBERG_FILES_URL]) {
    const match = trimmed.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

export function gutenbergCoverImageUrl(ebookId: string): string {
  const id = ebookId.trim()
  return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`
}

/** When `source` points at Project Gutenberg, return the standard medium cover URL. */
export function resolveGutenbergCoverImageUrl(source: string | undefined): string | undefined {
  if (!source?.trim()) return undefined
  if (!source.toLowerCase().includes('gutenberg')) return undefined
  const id = parseGutenbergEbookId(source)
  if (!id) return undefined
  return gutenbergCoverImageUrl(id)
}
