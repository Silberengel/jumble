import type { Slide } from 'yet-another-react-lightbox'
import type { TImetaInfo } from '@/types'
import { isAudio, isImage, isMedia, isVideo, preferBlossomPrimalDisplayUrl } from '@/lib/url'

function sourceTypeFromPath(url: string, kind: 'video' | 'audio'): string {
  const path = url.split(/[?#]/)[0].toLowerCase()
  if (kind === 'audio') {
    if (path.endsWith('.mka')) return 'audio/x-matroska'
    if (path.endsWith('.opus')) return 'audio/opus'
    if (path.endsWith('.webm')) return 'audio/webm'
    if (path.endsWith('.ogg')) return 'audio/ogg'
    if (path.endsWith('.m4a') || path.endsWith('.aac')) return 'audio/mp4'
    if (path.endsWith('.flac')) return 'audio/flac'
    if (path.endsWith('.wav')) return 'audio/wav'
    return 'audio/mpeg'
  }
  if (path.endsWith('.webm')) return 'video/webm'
  if (path.endsWith('.mkv')) return 'video/x-matroska'
  if (path.endsWith('.ogv')) return 'video/ogg'
  return 'video/mp4'
}

/**
 * Build a Yet Another React Lightbox slide from imeta (or URL + optional MIME).
 * Uses the Video plugin for video/audio URLs so the lightbox can play what we upload.
 */
export function lightboxSlideFromImeta(info: Pick<TImetaInfo, 'url' | 'alt' | 'm' | 'image'>): Slide {
  const url = preferBlossomPrimalDisplayUrl(info.url)
  const title = info.alt || info.url
  const m = info.m?.toLowerCase()

  if (m?.startsWith('image/')) {
    return { src: url, alt: title, title }
  }
  if (m?.startsWith('video/')) {
    return {
      type: 'video',
      title,
      poster: info.image,
      sources: [{ src: url, type: info.m as string }]
    }
  }
  if (m?.startsWith('audio/')) {
    return {
      type: 'video',
      width: 400,
      height: 64,
      title,
      sources: [{ src: url, type: info.m as string }]
    }
  }

  if (isVideo(url)) {
    return {
      type: 'video',
      title,
      poster: info.image,
      sources: [{ src: url, type: sourceTypeFromPath(url, 'video') }]
    }
  }
  if (isAudio(url)) {
    return {
      type: 'video',
      width: 400,
      height: 64,
      title,
      sources: [{ src: url, type: sourceTypeFromPath(url, 'audio') }]
    }
  }
  if (isImage(url)) {
    return { src: url, alt: title, title }
  }
  if (isMedia(url)) {
    return {
      type: 'video',
      title,
      poster: info.image,
      sources: [{ src: url, type: 'video/mp4' }]
    }
  }

  return { src: url, alt: title, title }
}
