import { describe, expect, it } from 'vitest'
import {
  isTidalOpenUrl,
  tidalEmbedMinHeight,
  tidalOpenUrlKind,
  tidalOpenUrlToEmbedSrc
} from './tidal-url'

describe('tidal-url', () => {
  it('maps track share URLs to embed.tidal.com', () => {
    const url = 'https://tidal.com/track/3466956'
    expect(isTidalOpenUrl(url)).toBe(true)
    expect(tidalOpenUrlKind(url)).toBe('track')
    expect(tidalOpenUrlToEmbedSrc(url)).toBe('https://embed.tidal.com/tracks/3466956')
    expect(tidalEmbedMinHeight(url)).toBe(120)
  })

  it('accepts browse paths and listen.tidal.com', () => {
    const url = 'https://tidal.com/browse/track/3466956'
    expect(tidalOpenUrlToEmbedSrc(url)).toBe('https://embed.tidal.com/tracks/3466956')
    expect(tidalOpenUrlToEmbedSrc('https://listen.tidal.com/album/123')).toBe(
      'https://embed.tidal.com/albums/123'
    )
  })

  it('maps playlists and videos', () => {
    expect(tidalOpenUrlToEmbedSrc('https://tidal.com/playlist/8bfe8c3f-0e2e-4b5e-9c3e-1234567890ab')).toBe(
      'https://embed.tidal.com/playlists/8bfe8c3f-0e2e-4b5e-9c3e-1234567890ab'
    )
    expect(tidalOpenUrlKind('https://tidal.com/video/99')).toBe('video')
    expect(tidalEmbedMinHeight('https://tidal.com/video/99')).toBe(328)
  })

  it('rejects non-tidal hosts and bare homepages', () => {
    expect(isTidalOpenUrl('https://example.com/track/1')).toBe(false)
    expect(isTidalOpenUrl('https://tidal.com/')).toBe(false)
    expect(isTidalOpenUrl('https://tidal.com/artist/123')).toBe(false)
  })
})
