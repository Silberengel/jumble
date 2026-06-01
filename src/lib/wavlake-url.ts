const WAVLAKE_HOSTS = new Set(['wavlake.com', 'www.wavlake.com'])

export type WavlakeEmbedKind = 'track' | 'album' | 'profile'

/**
 * Build Wavlake embed iframe `src` from a wavlake.com link, or null if not embeddable.
 * @see https://github.com/wavlake/embed — same URL paths on embed.wavlake.com
 */
export function wavlakeOpenUrlToEmbedSrc(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!WAVLAKE_HOSTS.has(u.hostname.toLowerCase())) return null
    if (wavlakeOpenUrlKind(url) == null) return null
    return `https://embed.wavlake.com${u.pathname}${u.search}`
  } catch {
    return null
  }
}

export function wavlakeOpenUrlKind(url: string): WavlakeEmbedKind | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!WAVLAKE_HOSTS.has(u.hostname.toLowerCase())) return null
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length === 0) return null
    const head = parts[0].toLowerCase()
    if (head === 'track' || head === 'album') {
      return parts.length === 2 && parts[1] ? head : null
    }
    if (parts.length === 1) return 'profile'
    return null
  } catch {
    return null
  }
}

/** Suggested min iframe height (album/artist pages need more chrome than a single track). */
export function wavlakeEmbedMinHeight(url: string): number {
  return wavlakeOpenUrlKind(url) === 'track' ? 200 : 380
}

export function isWavlakeOpenUrl(url: string): boolean {
  return wavlakeOpenUrlToEmbedSrc(url) != null
}
