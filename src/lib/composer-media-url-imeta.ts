import { imageUrlLooksLikeHttpImage } from '@/lib/composer-markup-insert'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { ExtendedKind } from '@/constants'
import {
  blossomSha256FromBlobUrl,
  cleanUrl,
  isAudio,
  isBlossomBudBlobUrl,
  isImage,
  isMedia,
  isVideo
} from '@/lib/url'

const HEAD_PROBE_MS = 8_000

/** True when a URL is likely image/audio/video (by extension, blossom blob, or known hosts). */
export function looksLikeComposerMediaUrl(url: string): boolean {
  const cleaned = cleanUrl(url) || url
  if (isBlossomBudBlobUrl(cleaned)) return true
  if (isImage(cleaned) || isVideo(cleaned) || isAudio(cleaned) || isMedia(cleaned)) return true
  if (imageUrlLooksLikeHttpImage(cleaned)) return true
  try {
    const host = new URL(cleaned).hostname.toLowerCase()
    if (host.endsWith('tenor.com') || host.endsWith('giphy.com')) return true
  } catch {
    /* ignore */
  }
  return false
}

/** Single-line clipboard text → media URL, or null. Supports `![alt](url)` and bare URLs. */
export function extractPastedMediaUrl(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length !== 1) return null
  let line = lines[0]!
  const mdImage = line.match(/^!\[[^\]]*]\((https?:\/\/[^)\s]+)\)$/i)
  if (mdImage) line = mdImage[1]!
  if (!/^https?:\/\//i.test(line)) return null
  const trimmed = line.replace(/[)\]},.;]+$/g, '').trim()
  try {
    const href = new URL(trimmed).toString()
    return looksLikeComposerMediaUrl(href) ? href : null
  } catch {
    return null
  }
}

export function inferMediaKindFromUrl(url: string): number | null {
  const cleaned = cleanUrl(url) || url
  if (isBlossomBudBlobUrl(cleaned)) return ExtendedKind.PICTURE
  if (isImage(cleaned) || imageUrlLooksLikeHttpImage(cleaned)) return ExtendedKind.PICTURE
  if (isAudio(cleaned)) return ExtendedKind.VOICE
  if (isVideo(cleaned)) return ExtendedKind.SHORT_VIDEO
  if (isMedia(cleaned)) {
    const path = cleaned.split(/[?#]/)[0].toLowerCase()
    if (/\.(mp3|m4a|mka|ogg|opus|wav|aac|flac)$/i.test(path)) return ExtendedKind.VOICE
    return ExtendedKind.SHORT_VIDEO
  }
  return null
}

export function mimeFromMediaUrl(url: string, kind?: number | null): string | undefined {
  const path = url.split(/[?#]/)[0].toLowerCase()
  const k = kind ?? inferMediaKindFromUrl(url)
  if (k === ExtendedKind.PICTURE) {
    if (path.endsWith('.png')) return 'image/png'
    if (path.endsWith('.webp')) return 'image/webp'
    if (path.endsWith('.gif')) return 'image/gif'
    if (path.endsWith('.svg')) return 'image/svg+xml'
    if (path.endsWith('.avif')) return 'image/avif'
    return 'image/jpeg'
  }
  if (k === ExtendedKind.VOICE) {
    if (path.endsWith('.mka')) return 'audio/x-matroska'
    if (path.endsWith('.ogg')) return 'audio/ogg'
    if (path.endsWith('.webm')) return 'audio/webm'
    if (path.endsWith('.wav')) return 'audio/wav'
    if (path.endsWith('.flac')) return 'audio/flac'
    if (path.endsWith('.m4a')) return 'audio/mp4'
    return 'audio/mpeg'
  }
  if (path.endsWith('.mkv')) return 'video/x-matroska'
  if (path.endsWith('.webm')) return 'video/webm'
  if (path.endsWith('.3gp')) return 'video/3gpp'
  if (path.endsWith('.3g2')) return 'video/3gpp2'
  if (path.endsWith('.mov')) return 'video/quicktime'
  return 'video/mp4'
}

/**
 * Merge two `imeta` tags for the same URL: `primary` items win, missing keys are filled
 * from `secondary`. Keeps hash fields (`x`, `size`) computed elsewhere (e.g. GIF picker)
 * from being lost when the composer's probe-based enrichment re-registers the tag.
 */
export function mergeImetaTags(primary: string[], secondary?: string[]): string[] {
  if (!secondary?.length) return primary
  const out = [...primary]
  const keys = new Set(primary.slice(1).map((item) => item.split(' ')[0]))
  const values = new Set(primary.slice(1))
  for (const item of secondary.slice(1)) {
    const key = item.split(' ')[0]
    if (key === 'fallback' ? !values.has(item) : !keys.has(key)) {
      out.push(item)
      keys.add(key)
      values.add(item)
    }
  }
  return out
}

export function buildImetaTagFromMediaUrl(
  url: string,
  opts?: { mime?: string; width?: number; height?: number }
): string[] {
  const cleaned = cleanUrl(url) || url
  const tag: string[] = ['imeta', `url ${cleaned}`]
  const mime = opts?.mime ?? mimeFromMediaUrl(cleaned)
  if (mime) tag.push(`m ${mime}`)
  const x = blossomSha256FromBlobUrl(cleaned)
  if (x) tag.push(`x ${x}`)
  if (opts?.width && opts?.height && opts.width > 0 && opts.height > 0) {
    tag.push(`dim ${opts.width}x${opts.height}`)
  }
  return tag
}

function loadImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = window.setTimeout(() => resolve(null), HEAD_PROBE_MS)
    img.onload = () => {
      window.clearTimeout(timer)
      const w = img.naturalWidth
      const h = img.naturalHeight
      resolve(w > 0 && h > 0 ? { width: w, height: h } : null)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      resolve(null)
    }
    img.src = url
  })
}

async function probeRemoteMime(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD', timeoutMs: HEAD_PROBE_MS })
    const ct = res.headers.get('content-type')
    if (ct) return ct.split(';')[0]?.trim() || null
  } catch {
    /* HEAD blocked or unsupported */
  }
  return null
}

/** Best-effort remote probe (HEAD + image decode) to enrich a pasted/external media URL. */
export async function enrichImetaTagFromMediaUrl(url: string): Promise<string[]> {
  const cleaned = cleanUrl(url) || url
  let mime = mimeFromMediaUrl(cleaned)
  const remoteMime = await probeRemoteMime(cleaned)
  if (remoteMime?.startsWith('image/') || remoteMime?.startsWith('audio/') || remoteMime?.startsWith('video/')) {
    mime = remoteMime
  }
  let width: number | undefined
  let height: number | undefined
  if ((mime?.startsWith('image/') ?? isImage(cleaned)) && mime !== 'image/svg+xml') {
    const dims = await loadImageDimensions(cleaned)
    if (dims) {
      width = dims.width
      height = dims.height
    }
  }
  return buildImetaTagFromMediaUrl(cleaned, { mime, width, height })
}
