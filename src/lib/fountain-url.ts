const FOUNTAIN_HOSTS = new Set(['fountain.fm', 'www.fountain.fm'])

export type FountainEmbedKind = 'episode' | 'show'

export function fountainOpenUrlKind(url: string): FountainEmbedKind | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!FOUNTAIN_HOSTS.has(u.hostname.toLowerCase())) return null
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length !== 2) return null
    const head = parts[0].toLowerCase()
    if (head !== 'episode' && head !== 'show') return null
    return /^[A-Za-z0-9]+$/.test(parts[1]) ? head : null
  } catch {
    return null
  }
}

/** Card min height (episode player vs show link card). */
export function fountainEmbedMinHeight(url: string): number {
  return fountainOpenUrlKind(url) === 'episode' ? 200 : 120
}

export function isFountainOpenUrl(url: string): boolean {
  return fountainOpenUrlKind(url) != null
}

/** Shorten Fountain og:title for display in embed cards. */
export function fountainDisplayTitleFromOgTitle(ogTitle: string | null | undefined): string | undefined {
  if (!ogTitle) return undefined
  const trimmed = ogTitle
    .replace(/\s*•\s*Listen on Fountain\s*$/i, '')
    .replace(/\s*•\s*$/g, '')
    .trim()
  return trimmed || undefined
}
