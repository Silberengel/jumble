const TIDAL_HOSTS = new Set(['tidal.com', 'www.tidal.com', 'listen.tidal.com'])

const EMBEDDABLE_KINDS = new Set(['track', 'album', 'playlist', 'video'])

const EMBED_COLLECTION: Record<string, string> = {
  track: 'tracks',
  album: 'albums',
  playlist: 'playlists',
  video: 'videos'
}

export type TidalEmbedKind = 'track' | 'album' | 'playlist' | 'video'

function parseTidalPath(pathname: string): { kind: TidalEmbedKind; id: string } | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return null
  let i = 0
  if (parts[0]?.toLowerCase() === 'browse') i = 1
  const kindRaw = parts[i]?.toLowerCase()
  const id = parts[i + 1]
  if (!kindRaw || !id || !EMBEDDABLE_KINDS.has(kindRaw)) return null
  const kind = kindRaw as TidalEmbedKind
  if (kind === 'playlist') {
    if (!/^[0-9a-f-]{8,}$/i.test(id)) return null
  } else if (!/^[0-9]+$/.test(id)) {
    return null
  }
  return { kind, id }
}

export function tidalOpenUrlKind(url: string): TidalEmbedKind | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!TIDAL_HOSTS.has(u.hostname.toLowerCase())) return null
    return parseTidalPath(u.pathname)?.kind ?? null
  } catch {
    return null
  }
}

/** Build Tidal embed iframe `src` from a tidal.com share link, or null if not embeddable. */
export function tidalOpenUrlToEmbedSrc(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!TIDAL_HOSTS.has(u.hostname.toLowerCase())) return null
    const parsed = parseTidalPath(u.pathname)
    if (!parsed) return null
    const collection = EMBED_COLLECTION[parsed.kind]
    return `https://embed.tidal.com/${collection}/${parsed.id}`
  } catch {
    return null
  }
}

/** Suggested min iframe height (track bar vs album/playlist chrome vs video). */
export function tidalEmbedMinHeight(url: string): number {
  const kind = tidalOpenUrlKind(url)
  if (kind === 'track') return 120
  if (kind === 'video') return 328
  return 275
}

export function tidalEmbedMinHeightClass(url: string): string {
  const kind = tidalOpenUrlKind(url)
  if (kind === 'track') return 'min-h-[120px]'
  if (kind === 'video') return 'aspect-video min-h-[200px]'
  return 'min-h-[275px]'
}

export function isTidalOpenUrl(url: string): boolean {
  return tidalOpenUrlToEmbedSrc(url) != null
}
