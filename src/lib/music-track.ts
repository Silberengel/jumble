import { isMusicTrackKind } from '@/constants'
import { tagNameEquals } from '@/lib/tag'
import type { Event } from 'nostr-tools'

export type TMusicTrack = {
  title: string
  artist?: string
  audioUrl: string
  imageUrl?: string
  videoUrl?: string
  album?: string
  trackNumber?: string
  released?: string
  durationSec?: number
  format?: string
  explicit?: boolean
  alt?: string
  genres: string[]
  language?: string
}

function firstTagValue(event: Event, name: string): string | undefined {
  const v = event.tags.find(tagNameEquals(name))?.[1]?.trim()
  return v || undefined
}

function tagValues(event: Event, name: string): string[] {
  return event.tags
    .filter((t) => t[0] === name && t[1]?.trim())
    .map((t) => t[1]!.trim())
}

function mergeMusicTrackGenres(event: Event): string[] {
  const fromT = tagValues(event, 't').filter((t) => t !== 'music')
  const genre = firstTagValue(event, 'genre')
  if (!genre) return fromT
  const key = genre.toLowerCase()
  if (fromT.some((g) => g.toLowerCase() === key)) return fromT
  return [genre, ...fromT]
}

/** Promotional note text that only repeats title/artist should not render below the card. */
export function musicTrackCaptionContent(
  content: string | undefined,
  track: TMusicTrack
): string | null {
  const c = content?.trim()
  if (!c) return null
  const norm = c.toLowerCase()
  const title = track.title.toLowerCase()
  if (!norm.includes(title)) return c
  const artist = track.artist?.toLowerCase()
  if (artist && !norm.includes(artist)) return c
  return null
}

export function formatMusicTrackDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Parse kind 36787 music track metadata from event tags. */
export function getMusicTrackFromEvent(event: Event): TMusicTrack | null {
  if (!isMusicTrackKind(event.kind)) return null

  const title = firstTagValue(event, 'title')
  const audioUrl = firstTagValue(event, 'url')
  if (!title || !audioUrl) return null

  const hasMusicTag = event.tags.some((t) => t[0] === 't' && t[1] === 'music')
  if (!hasMusicTag) return null

  const durationRaw = firstTagValue(event, 'duration')
  const durationSec = durationRaw != null ? Number.parseInt(durationRaw, 10) : NaN

  return {
    title,
    artist: firstTagValue(event, 'artist'),
    audioUrl,
    imageUrl: firstTagValue(event, 'image'),
    videoUrl: firstTagValue(event, 'video'),
    album: firstTagValue(event, 'album'),
    trackNumber: firstTagValue(event, 'track_number'),
    released: firstTagValue(event, 'released'),
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : undefined,
    format: firstTagValue(event, 'format'),
    explicit: firstTagValue(event, 'explicit')?.toLowerCase() === 'true',
    alt: firstTagValue(event, 'alt'),
    genres: mergeMusicTrackGenres(event),
    language: firstTagValue(event, 'language')
  }
}

export function musicTrackDisplayLine(track: TMusicTrack): string {
  if (track.artist) return `${track.artist} — ${track.title}`
  return track.title
}

export function musicTrackMetaLine(track: TMusicTrack): string {
  const parts: string[] = []
  if (track.album) {
    parts.push(track.trackNumber ? `${track.album} #${track.trackNumber}` : track.album)
  } else if (track.trackNumber) {
    parts.push(`#${track.trackNumber}`)
  }
  if (track.released) parts.push(track.released)
  if (track.durationSec) parts.push(formatMusicTrackDuration(track.durationSec))
  if (track.format) parts.push(track.format.toUpperCase())
  if (track.explicit) parts.push('Explicit')
  if (track.genres.length) parts.push(track.genres.slice(0, 3).join(', '))
  return parts.join(' · ')
}
