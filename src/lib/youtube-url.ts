/**
 * Parse a YouTube watch / Shorts / Live / embed / youtu.be URL for the player API.
 * Covers common host variants (www, m, music, youtube-nocookie).
 */
import { YOUTUBE_URL_REGEX } from '@/constants'

export function parseYoutubeUrl(url: string): { videoId: string | null; isShort: boolean } {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { videoId: null, isShort: false }
    }
    const host = u.hostname.toLowerCase()
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      const videoId = id ? decodeURIComponent(id.split('?')[0]!).trim() : null
      return { videoId: videoId && videoId.length >= 6 ? videoId : null, isShort: false }
    }
    if (
      !(
        host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtube-nocookie.com' ||
        host === 'www.youtube-nocookie.com'
      )
    ) {
      return { videoId: null, isShort: false }
    }
    const path = u.pathname
    if (path.startsWith('/shorts/')) {
      const id = path.slice('/shorts/'.length).split('/')[0]?.trim()
      return { videoId: id || null, isShort: true }
    }
    if (path.startsWith('/live/')) {
      const id = path.slice('/live/'.length).split('/')[0]?.trim()
      return { videoId: id || null, isShort: false }
    }
    if (path.startsWith('/embed/')) {
      const id = path.slice('/embed/'.length).split('/')[0]?.trim()
      return { videoId: id || null, isShort: false }
    }
    if (path === '/watch' || path.startsWith('/watch/')) {
      const v = u.searchParams.get('v')?.trim()
      if (v) return { videoId: v, isShort: false }
    }
    return { videoId: null, isShort: false }
  } catch {
    return { videoId: null, isShort: false }
  }
}

/** True when the in-app YouTube player can embed this URL (watch, Shorts, live, youtu.be, embed). */
export function isEmbeddableYoutubeUrl(url: string): boolean {
  return parseYoutubeUrl(url).videoId != null
}

/** Check whether a URL points at YouTube (watch, embed, shorts, youtu.be). */
export function isYouTubeUrl(url: string): boolean {
  if (!url) return false
  const flags = YOUTUBE_URL_REGEX.flags.replace('g', '')
  const regex = new RegExp(YOUTUBE_URL_REGEX.source, flags)
  return regex.test(url)
}
