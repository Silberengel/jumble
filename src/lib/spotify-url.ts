const EMBEDDABLE_KINDS = new Set(['track', 'album', 'playlist', 'episode', 'show'])

/**
 * Build Spotify embed iframe `src` from an open.spotify.com link, or null if not embeddable.
 */
export function spotifyOpenUrlToEmbedSrc(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.hostname.toLowerCase() !== 'open.spotify.com') return null
    const parts = u.pathname.split('/').filter(Boolean)
    let i = 0
    if (parts[0]?.match(/^intl-[a-z]{2}$/i)) i += 1
    const kind = parts[i]?.toLowerCase()
    const id = parts[i + 1]
    if (!kind || !id || !EMBEDDABLE_KINDS.has(kind)) return null
    return `https://open.spotify.com/embed/${kind}/${id}${u.search}`
  } catch {
    return null
  }
}

export function isSpotifyOpenUrl(url: string): boolean {
  return spotifyOpenUrlToEmbedSrc(url) != null
}
