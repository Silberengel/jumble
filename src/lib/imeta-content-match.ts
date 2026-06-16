import { ExtendedKind } from '@/constants'
import { getImetaInfosFromEvent } from '@/lib/event'
import {
  blossomSha256FromBlobUrl,
  cleanUrl,
  isAudio,
  isBlossomBudBlobUrl,
  isHlsPlaylistUrl,
  isImage,
  isMedia,
  isVideo
} from '@/lib/url'
import type { TImetaInfo } from '@/types'
import type { Event } from 'nostr-tools'

/** NIP-71 media note kinds (picture / video / short video). */
export function isNip71MediaKind(kind: number): boolean {
  return (
    kind === ExtendedKind.PICTURE ||
    kind === ExtendedKind.VIDEO ||
    kind === ExtendedKind.SHORT_VIDEO
  )
}

function isImageMediaUrl(cleaned: string): boolean {
  return isImage(cleaned)
}

/** Image URLs in note body text (excludes video/audio). */
export function collectImageUrlsInContent(content: string): Set<string> {
  const urls = new Set<string>()
  if (!content) return urls
  const urlRegex = /https?:\/\/[^\s<>"']+/g
  let match: RegExpExecArray | null
  while ((match = urlRegex.exec(content)) !== null) {
    const cleaned = cleanUrl(match[0])
    if (cleaned && isImageMediaUrl(cleaned)) {
      urls.add(cleaned)
    }
  }
  return urls
}

export function hasImageUrlInContent(content: string): boolean {
  return collectImageUrlsInContent(content).size > 0
}

/**
 * Orphaned `imeta` (URL not literally in content) goes behind the accordion when true.
 * - Kinds 20–22: accordion only when the body already contains an image URL.
 * - All other kinds: accordion when the body has no image URL.
 */
export function shouldHideOrphanedImetaInAccordion(kind: number, content?: string): boolean {
  const hasImage = hasImageUrlInContent(content ?? '')
  return isNip71MediaKind(kind) ? hasImage : !hasImage
}

function isEmbeddableMediaUrl(cleaned: string): boolean {
  return (
    isImage(cleaned) ||
    isMedia(cleaned) ||
    isVideo(cleaned) ||
    isAudio(cleaned) ||
    isHlsPlaylistUrl(cleaned) ||
    isBlossomBudBlobUrl(cleaned)
  )
}

function isEmbeddableImeta(info: TImetaInfo, cleaned: string): boolean {
  const nip94Signals = !!(info.blurHash || info.dim || info.x)
  return (
    info.m?.startsWith('image/') ||
    info.m?.startsWith('video/') ||
    info.m?.startsWith('audio/') ||
    info.m === 'application/vnd.apple.mpegurl' ||
    isEmbeddableMediaUrl(cleaned) ||
    (nip94Signals && !!info.url)
  )
}

/** Media URLs appearing in note body text (NIP-01 / long-form content). */
export function collectMediaUrlsInContent(content: string): Set<string> {
  const urls = new Set<string>()
  if (!content) return urls
  const urlRegex = /https?:\/\/[^\s<>"']+/g
  let match: RegExpExecArray | null
  while ((match = urlRegex.exec(content)) !== null) {
    const cleaned = cleanUrl(match[0])
    if (cleaned && isEmbeddableMediaUrl(cleaned)) {
      urls.add(cleaned)
    }
  }
  return urls
}

/**
 * NIP-94 `imeta` rows whose `url` is not literally present in the event content.
 * Same blob with a different URL (e.g. nostr.build vs blossom) counts as orphaned.
 */
export function getOrphanedImetaMedia(event: Event, content?: string): TImetaInfo[] {
  const text = content ?? event.content ?? ''
  const contentUrls = collectMediaUrlsInContent(text)
  const out: TImetaInfo[] = []
  const seen = new Set<string>()

  for (const info of getImetaInfosFromEvent(event)) {
    const cleaned = cleanUrl(info.url)
    if (!cleaned || seen.has(cleaned)) continue
    if (contentUrls.has(cleaned)) continue
    if (!isEmbeddableImeta(info, cleaned)) continue
    seen.add(cleaned)
    out.push({ ...info, url: cleaned })
  }

  return out
}

export function orphanedImetaUrlSet(event: Event, content?: string): Set<string> {
  return new Set(
    getOrphanedImetaMedia(event, content)
      .map((info) => cleanUrl(info.url))
      .filter((url): url is string => !!url)
  )
}

export type ImetaMediaCategory = 'image' | 'video' | 'audio'

export function categorizeImetaMedia(info: TImetaInfo): ImetaMediaCategory | null {
  const cleaned = cleanUrl(info.url)
  if (!cleaned) return null
  if (
    info.m?.startsWith('video/') ||
    isVideo(cleaned) ||
    isHlsPlaylistUrl(cleaned) ||
    /mpegurl/i.test(info.m || '')
  ) {
    return 'video'
  }
  if (info.m?.startsWith('audio/') || isAudio(cleaned)) {
    return 'audio'
  }
  if (info.m?.startsWith('image/') || isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) {
    return 'image'
  }
  if (isMedia(cleaned)) {
    return 'video'
  }
  return null
}

/** SHA-256 identity for matching the same blob across different host URLs. */
export function mediaBlobIdentityKey(url: string, x?: string | null): string | null {
  const fromX = x?.trim()
  if (fromX && /^[a-f0-9]{64}$/i.test(fromX)) {
    return `sha256:${fromX.toLowerCase()}`
  }
  const blossom = blossomSha256FromBlobUrl(url)
  if (blossom) return `sha256:${blossom.toLowerCase()}`
  try {
    const filename = new URL(url.trim()).pathname.split('/').pop() || ''
    const base = filename.replace(
      /\.(mp4|webm|mov|m4v|mkv|jpg|jpeg|png|gif|webp|avif|mp3|m4a|wav|ogg|opus)$/i,
      ''
    )
    if (/^[a-f0-9]{64}$/i.test(base)) {
      return `sha256:${base.toLowerCase()}`
    }
  } catch {
    /* ignore */
  }
  return null
}
