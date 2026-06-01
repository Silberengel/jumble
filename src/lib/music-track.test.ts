import { ExtendedKind } from '@/constants'
import {
  formatMusicTrackDuration,
  getMusicTrackFromEvent,
  musicTrackCaptionContent,
  musicTrackDisplayLine,
  musicTrackMetaLine
} from './music-track'
import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'

/** Minimal kind-36787 event for unit tests. */
function musicTrackEvent(
  tags: string[][],
  content = ''
): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1779818315,
    kind: ExtendedKind.MUSIC_TRACK,
    tags,
    content,
    sig: 'c'.repeat(128)
  }
}

const BASE_TAGS: string[][] = [
  ['d', 'track-8rqwm2jwg'],
  ['title', 'Scatman (Ski-Ba-Bop-Ba-Dop-Bop)'],
  ['url', 'https://blossom.primal.net/cc0c235629f80ef4e98cee3475dc0dcc2ba2eea53730a3448d6d4dcb37c30078.mp3'],
  ['artist', 'Scatman John'],
  ['album', "Scatman's World"],
  ['duration', '218'],
  ['format', 'mp3'],
  ['track_number', '5'],
  ['genre', 'Disco Pop'],
  ['t', 'music'],
  ['t', 'gruuv'],
  ['t', 'grooveblossom'],
  ['t', 'disco pop']
]

describe('getMusicTrackFromEvent', () => {
  it('parses a realistic blossom music-track event', () => {
    const track = getMusicTrackFromEvent(musicTrackEvent(BASE_TAGS))
    expect(track).toEqual({
      title: 'Scatman (Ski-Ba-Bop-Ba-Dop-Bop)',
      artist: 'Scatman John',
      audioUrl:
        'https://blossom.primal.net/cc0c235629f80ef4e98cee3475dc0dcc2ba2eea53730a3448d6d4dcb37c30078.mp3',
      imageUrl: undefined,
      videoUrl: undefined,
      album: "Scatman's World",
      trackNumber: '5',
      released: undefined,
      durationSec: 218,
      format: 'mp3',
      explicit: false,
      alt: undefined,
      genres: ['gruuv', 'grooveblossom', 'disco pop'],
      language: undefined
    })
  })

  it('parses optional tags', () => {
    const track = getMusicTrackFromEvent(
      musicTrackEvent([
        ['d', 'summer-nights-2024'],
        ['title', 'Summer Nights'],
        ['url', 'https://cdn.example/audio.mp3'],
        ['image', 'https://cdn.example/art.jpg'],
        ['video', 'https://cdn.example/video.mp4'],
        ['artist', 'The Midnight Collective'],
        ['album', 'Endless Summer'],
        ['track_number', '3'],
        ['released', '2024-06-15'],
        ['duration', '245'],
        ['format', 'mp3'],
        ['explicit', 'true'],
        ['alt', 'Cover art'],
        ['language', 'en'],
        ['t', 'music'],
        ['t', 'electronic']
      ])
    )
    expect(track).toMatchObject({
      imageUrl: 'https://cdn.example/art.jpg',
      videoUrl: 'https://cdn.example/video.mp4',
      released: '2024-06-15',
      durationSec: 245,
      explicit: true,
      alt: 'Cover art',
      language: 'en',
      genres: ['electronic']
    })
    expect(musicTrackDisplayLine(track!)).toBe('The Midnight Collective — Summer Nights')
  })

  it('returns null without title, url, or t=music', () => {
    expect(
      getMusicTrackFromEvent(
        musicTrackEvent([
          ['d', 'x'],
          ['title', 'T'],
          ['url', 'https://a.mp3']
        ])
      )
    ).toBeNull()
    expect(
      getMusicTrackFromEvent(
        musicTrackEvent([
          ['d', 'x'],
          ['url', 'https://a.mp3'],
          ['t', 'music']
        ])
      )
    ).toBeNull()
    expect(
      getMusicTrackFromEvent(
        musicTrackEvent([
          ['d', 'x'],
          ['title', 'T'],
          ['t', 'music']
        ])
      )
    ).toBeNull()
    expect(
      getMusicTrackFromEvent(
        musicTrackEvent([
          ['d', 'x'],
          ['title', 'T'],
          ['url', 'https://a.mp3'],
          ['t', 'rock']
        ])
      )
    ).toBeNull()
  })

  it('ignores invalid or zero duration', () => {
    const noDuration = getMusicTrackFromEvent(
      musicTrackEvent([
        ['d', 'x'],
        ['title', 'T'],
        ['url', 'https://a.mp3'],
        ['t', 'music']
      ])
    )
    expect(noDuration?.durationSec).toBeUndefined()

    const badDuration = getMusicTrackFromEvent(
      musicTrackEvent([
        ['d', 'x'],
        ['title', 'T'],
        ['url', 'https://a.mp3'],
        ['t', 'music'],
        ['duration', 'nope'],
        ['duration', '0']
      ])
    )
    expect(badDuration?.durationSec).toBeUndefined()
  })

  it('prepends genre tag when not duplicated by a t tag', () => {
    const track = getMusicTrackFromEvent(
      musicTrackEvent([
        ['d', 'x'],
        ['title', 'T'],
        ['url', 'https://a.mp3'],
        ['t', 'music'],
        ['genre', 'Disco Pop'],
        ['t', 'synthwave']
      ])
    )
    expect(track?.genres).toEqual(['Disco Pop', 'synthwave'])
  })

  it('dedupes genre tag against t tags case-insensitively', () => {
    const track = getMusicTrackFromEvent(
      musicTrackEvent([
        ['d', 'x'],
        ['title', 'T'],
        ['url', 'https://a.mp3'],
        ['t', 'music'],
        ['genre', 'Disco Pop'],
        ['t', 'disco pop']
      ])
    )
    expect(track?.genres).toEqual(['disco pop'])
  })
})

describe('formatMusicTrackDuration', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatMusicTrackDuration(245)).toBe('4:05')
    expect(formatMusicTrackDuration(218)).toBe('3:38')
    expect(formatMusicTrackDuration(3665)).toBe('1:01:05')
  })

  it('returns empty string for invalid input', () => {
    expect(formatMusicTrackDuration(NaN)).toBe('')
    expect(formatMusicTrackDuration(-1)).toBe('')
    expect(formatMusicTrackDuration(Infinity)).toBe('')
  })
})

describe('musicTrackMetaLine', () => {
  it('builds a metadata line from track fields', () => {
    const track = getMusicTrackFromEvent(musicTrackEvent(BASE_TAGS))!
    expect(musicTrackMetaLine(track)).toBe(
      "Scatman's World #5 · 3:38 · MP3 · gruuv, grooveblossom, disco pop"
    )
  })
})

describe('musicTrackCaptionContent', () => {
  const scatmanTrack = () => getMusicTrackFromEvent(musicTrackEvent(BASE_TAGS))!

  it('drops promotional content that repeats title and artist', () => {
    const track = scatmanTrack()
    expect(
      musicTrackCaptionContent(
        'Listen to my song - Scatman (Ski-Ba-Bop-Ba-Dop-Bop) by Scatman John',
        track
      )
    ).toBeNull()
  })

  it('keeps lyrics or notes that are not just title/artist promotion', () => {
    const track = scatmanTrack()
    expect(musicTrackCaptionContent('Verse one…', track)).toBe('Verse one…')
    expect(musicTrackCaptionContent('Listen to my song', track)).toBe('Listen to my song')
    expect(musicTrackCaptionContent('', track)).toBeNull()
    expect(musicTrackCaptionContent('   ', track)).toBeNull()
  })

  it('keeps content that mentions the title but not the artist', () => {
    const track = scatmanTrack()
    expect(musicTrackCaptionContent('Scatman (Ski-Ba-Bop-Ba-Dop-Bop) — live version', track)).toBe(
      'Scatman (Ski-Ba-Bop-Ba-Dop-Bop) — live version'
    )
  })
})
