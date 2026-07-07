import type { TPrimaryPageName } from '@/PageManager'

export function extractValidNoteId(raw: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw).trim()
    } catch {
      return raw.trim()
    }
  })()
  const withoutPrefix = decoded.startsWith('nostr:') ? decoded.slice(6) : decoded
  if (/^[0-9a-f]{64}$/i.test(withoutPrefix)) return withoutPrefix.toLowerCase()
  const lower = withoutPrefix.toLowerCase()
  if (
    lower.startsWith('note1') ||
    lower.startsWith('nevent1') ||
    lower.startsWith('naddr1')
  ) {
    return withoutPrefix
  }
  return null
}

export function parseNoteUrl(url: string): { noteId: string; context?: string } | null {
  const contextualMatch = url.match(
    /\/(discussions|search|library|profile|home|feed|spells|explore|rss|calendar)\/notes\/(.+)$/
  )
  if (contextualMatch) {
    const noteId = extractValidNoteId(contextualMatch[2])
    if (!noteId) return null
    return { noteId, context: contextualMatch[1] }
  }

  const standardMatch = url.match(/\/notes\/(.+)$/)
  if (standardMatch) {
    const noteId = extractValidNoteId(standardMatch[1])
    if (!noteId) return null
    return { noteId }
  }

  return null
}

export function buildNoteUrl(noteId: string, currentPage: TPrimaryPageName | null): string {
  const contextualPages: TPrimaryPageName[] = [
    'search',
    'library',
    'profile',
    'feed',
    'spells',
    'explore',
    'calendar'
  ]

  if (currentPage && contextualPages.includes(currentPage)) {
    return `/${currentPage}/notes/${noteId}`
  }

  return `/notes/${noteId}`
}
