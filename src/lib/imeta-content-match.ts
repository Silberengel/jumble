import { ExtendedKind } from '@/constants'
import { getImetaInfosFromEvent } from '@/lib/event'
import { isImageUrlPresentInText } from '@/lib/image-url-identity'
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
import { kinds } from 'nostr-tools'

/** Kinds whose `image` tag is NIP-23 cover metadata (hero / inline cover), not inline tag media. */
export function isNip23StyleCoverImageKind(kind: number): boolean {
  return (
    kind === kinds.LongFormArticle ||
    kind === ExtendedKind.WIKI_ARTICLE ||
    kind === ExtendedKind.PUBLICATION ||
    kind === ExtendedKind.PUBLICATION_CONTENT ||
    kind === ExtendedKind.NOSTR_SPECIFICATION
  )
}

/** True when `mediaUrl` is the event's NIP-23 cover (`image` tag / parsed metadata image). */
export function isMetadataCoverImageUrl(
  event: Event,
  mediaUrl: string,
  metadataImageUrl?: string | null
): boolean {
  const cleaned = cleanUrl(mediaUrl)
  if (!cleaned) return false
  const meta = metadataImageUrl ? cleanUrl(metadataImageUrl) : null
  if (meta && cleaned === meta) return true
  if (!isNip23StyleCoverImageKind(event.kind)) return false
  const imageTag = event.tags.find((t) => t[0] === 'image' && t[1])
  const tagUrl = imageTag?.[1] ? cleanUrl(imageTag[1]) : null
  return !!(tagUrl && cleaned === tagUrl)
}

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

export function hasMediaUrlInContent(content: string): boolean {
  return collectMediaUrlsInContent(content).size > 0
}

/**
 * After a NIP-41 edit, `content` may reference a new image while kind-1 `imeta` / `r` tags
 * still describe the pre-edit blob. Suppress those stale tag images when the body already
 * shows a different inline image (mirrors of the same blob via `x` are still allowed).
 */
export function isStaleTagImageAfterContentImage(
  event: Event,
  mediaUrl: string,
  content?: string
): boolean {
  const text = content ?? event.content ?? ''
  if (event.kind !== kinds.ShortTextNote && event.kind !== ExtendedKind.COMMENT) {
    return false
  }
  if (!hasImageUrlInContent(text)) return false
  if (isImageUrlPresentInText(text, mediaUrl)) return false

  const cleaned = cleanUrl(mediaUrl)
  if (!cleaned) return false

  const contentBlobKeys = collectContentBlobIdentityKeys(text)
  for (const info of getImetaInfosFromEvent(event)) {
    const ic = cleanUrl(info.url)
    if (!ic || ic !== cleaned) continue
    const blobKey = mediaBlobIdentityKey(ic, info.x)
    if (blobKey && contentBlobKeys.has(blobKey)) return false
  }
  const blobKey = mediaBlobIdentityKey(cleaned)
  if (blobKey && contentBlobKeys.has(blobKey)) return false

  return true
}

function collectContentBlobIdentityKeys(content: string): Set<string> {
  const keys = new Set<string>()
  for (const url of collectMediaUrlsInContent(content)) {
    const key = mediaBlobIdentityKey(url)
    if (key) keys.add(key)
  }
  return keys
}

/**
 * Orphaned `imeta` (URL not literally in content) goes behind the accordion when true.
 * - Kinds 20–22: accordion when the body already contains an embeddable media URL (image, video, audio, …).
 * - All other kinds: accordion when the body has no embeddable media URL.
 */
export function shouldHideOrphanedImetaInAccordion(kind: number, content?: string): boolean {
  const hasMedia = hasMediaUrlInContent(content ?? '')
  return isNip71MediaKind(kind) ? hasMedia : !hasMedia
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
 * `imeta` rows for the “View additional media” accordion — every tag URL suppressed from inline
 * rendering ({@link suppressImetaUrlSet}), including redundant mirrors and orphaned hosts.
 */
export function getSuppressedImetaMedia(event: Event, content?: string): TImetaInfo[] {
  const text = content ?? event.content ?? ''
  const hideOrphaned = shouldHideOrphanedImetaInAccordion(event.kind, text)
  const suppressedUrls = suppressImetaUrlSet(event, text, hideOrphaned)
  if (suppressedUrls.size === 0) return []

  const contentUrls = collectMediaUrlsInContent(text)
  const out: TImetaInfo[] = []
  const seen = new Set<string>()
  for (const info of getImetaInfosFromEvent(event)) {
    const cleaned = cleanUrl(info.url)
    if (!cleaned || seen.has(cleaned)) continue
    if (!suppressedUrls.has(cleaned)) continue
    // Inline content already renders this URL — accordion is for mirror/orphan hosts only.
    if (contentUrls.has(cleaned)) continue
    if (!isEmbeddableImeta(info, cleaned)) continue
    seen.add(cleaned)
    out.push({ ...info, url: cleaned })
  }
  return out
}

/** @deprecated Use {@link getSuppressedImetaMedia}. */
export function getAccordionImetaMedia(event: Event, content?: string): TImetaInfo[] {
  return getSuppressedImetaMedia(event, content)
}

/**
 * NIP-94 `imeta` rows whose `url` is not literally present in the event content.
 * Same blob with a different URL (e.g. nostr.build vs blossom) is redundant — not orphaned.
 */
export function getOrphanedImetaMedia(event: Event, content?: string): TImetaInfo[] {
  const text = content ?? event.content ?? ''
  const contentUrls = collectMediaUrlsInContent(text)
  const contentBlobKeys = collectContentBlobIdentityKeys(text)
  const out: TImetaInfo[] = []
  const seen = new Set<string>()

  for (const info of getImetaInfosFromEvent(event)) {
    const cleaned = cleanUrl(info.url)
    if (!cleaned || seen.has(cleaned)) continue
    if (contentUrls.has(cleaned)) continue
    const blobKey = mediaBlobIdentityKey(cleaned, info.x)
    if (blobKey && contentBlobKeys.has(blobKey)) continue
    if (!isEmbeddableImeta(info, cleaned)) continue
    seen.add(cleaned)
    out.push({ ...info, url: cleaned })
  }

  return out
}

/**
 * `imeta` URLs that duplicate media already in the note body (literal URL or same blob hash).
 * Suppressed from inline rendering; mirror URLs appear in the accordion when it applies.
 */
/**
 * True when tag-sourced media (`imeta`, `r`, `image`) duplicates media already in the note body.
 * Used so inline content rendering and tag blocks do not show the same image twice.
 */
export function isTagMediaRedundantWithContent(
  event: Event,
  mediaUrl: string,
  content?: string
): boolean {
  const text = content ?? event.content ?? ''
  const cleaned = cleanUrl(mediaUrl)
  if (!cleaned) return false
  if (isImageUrlPresentInText(text, cleaned)) return true
  if (collectMediaUrlsInContent(text).has(cleaned)) return true
  return redundantImetaUrlSet(event, text).has(cleaned)
}

export function redundantImetaUrlSet(event: Event, content?: string): Set<string> {
  const text = content ?? event.content ?? ''
  const contentUrls = collectMediaUrlsInContent(text)
  const contentBlobKeys = collectContentBlobIdentityKeys(text)
  const out = new Set<string>()

  for (const info of getImetaInfosFromEvent(event)) {
    const cleaned = cleanUrl(info.url)
    if (!cleaned) continue
    if (contentUrls.has(cleaned)) {
      out.add(cleaned)
      continue
    }
    const blobKey = mediaBlobIdentityKey(cleaned, info.x)
    if (blobKey && contentBlobKeys.has(blobKey)) {
      out.add(cleaned)
    }
  }

  return out
}

/** URLs to hide from inline imeta rendering (redundant mirrors + orphaned rows when accordion applies). */
export function suppressImetaUrlSet(
  event: Event,
  content?: string,
  hideOrphanedInAccordion = false
): Set<string> {
  const redundant = redundantImetaUrlSet(event, content)
  if (!hideOrphanedInAccordion) return redundant
  const orphaned = orphanedImetaUrlSet(event, content)
  return new Set([...redundant, ...orphaned])
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

/** Image URLs from `imeta` / `r` / `image` tags that may render inline (not already in body). */
export function collectInlineTagMediaImageUrls(event: Event, content?: string): string[] {
  const text = content ?? event.content ?? ''
  const seen = new Set<string>()
  const out: string[] = []

  const consider = (url: string) => {
    const cleaned = cleanUrl(url)
    if (!cleaned || seen.has(cleaned)) return
    if (!isImage(cleaned) && !isBlossomBudBlobUrl(cleaned)) return
    if (isTagMediaRedundantWithContent(event, url, text)) return
    if (isStaleTagImageAfterContentImage(event, url, text)) return
    if (isImageUrlPresentInText(text, url)) return
    seen.add(cleaned)
    out.push(url)
  }

  for (const info of getImetaInfosFromEvent(event)) {
    if (info.m?.startsWith('image/') || isImage(info.url) || isBlossomBudBlobUrl(info.url)) {
      consider(info.url)
    }
  }

  for (const tag of event.tags) {
    if (tag[0] === 'r' && tag[1]) consider(tag[1])
    if (tag[0] === 'image' && tag[1]) {
      if (isNip23StyleCoverImageKind(event.kind)) continue
      consider(tag[1])
    }
  }

  return out
}
