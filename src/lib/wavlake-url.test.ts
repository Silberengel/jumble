import { describe, expect, it } from 'vitest'
import {
  isWavlakeOpenUrl,
  wavlakeEmbedMinHeight,
  wavlakeOpenUrlKind,
  wavlakeOpenUrlToEmbedSrc
} from './wavlake-url'

describe('wavlake-url', () => {
  it('embeds album URLs', () => {
    const url = 'https://wavlake.com/album/b95132b8-a655-4b47-8394-96d0ea8260d2'
    expect(isWavlakeOpenUrl(url)).toBe(true)
    expect(wavlakeOpenUrlKind(url)).toBe('album')
    expect(wavlakeOpenUrlToEmbedSrc(url)).toBe(
      'https://embed.wavlake.com/album/b95132b8-a655-4b47-8394-96d0ea8260d2'
    )
    expect(wavlakeEmbedMinHeight(url)).toBe(380)
  })

  it('embeds track URLs', () => {
    const url = 'https://wavlake.com/track/2b8f5095-a57c-46ea-9731-18911afee136'
    expect(wavlakeOpenUrlKind(url)).toBe('track')
    expect(wavlakeOpenUrlToEmbedSrc(url)).toBe(
      'https://embed.wavlake.com/track/2b8f5095-a57c-46ea-9731-18911afee136'
    )
    expect(wavlakeEmbedMinHeight(url)).toBe(200)
  })

  it('embeds artist profile slugs', () => {
    const url = 'https://wavlake.com/dj-bitcoin'
    expect(wavlakeOpenUrlKind(url)).toBe('profile')
    expect(wavlakeOpenUrlToEmbedSrc(url)).toBe('https://embed.wavlake.com/dj-bitcoin')
  })

  it('rejects non-wavlake hosts and invalid paths', () => {
    expect(isWavlakeOpenUrl('https://example.com/album/x')).toBe(false)
    expect(isWavlakeOpenUrl('https://wavlake.com/')).toBe(false)
    expect(isWavlakeOpenUrl('https://wavlake.com/album/')).toBe(false)
    expect(isWavlakeOpenUrl('https://wavlake.com/foo/bar/baz')).toBe(false)
  })
})
