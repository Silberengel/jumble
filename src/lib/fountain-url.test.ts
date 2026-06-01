import { describe, expect, it } from 'vitest'
import {
  fountainDisplayTitleFromOgTitle,
  fountainEmbedMinHeight,
  fountainOpenUrlKind,
  isFountainOpenUrl
} from './fountain-url'

describe('fountain-url', () => {
  it('recognizes episode URLs', () => {
    const url = 'https://fountain.fm/episode/iZHflqr7FsRmZXk4RH3i'
    expect(isFountainOpenUrl(url)).toBe(true)
    expect(fountainOpenUrlKind(url)).toBe('episode')
    expect(fountainEmbedMinHeight(url)).toBe(200)
  })

  it('recognizes show URLs', () => {
    const url = 'https://fountain.fm/show/68gcLZFDRxOzgGeZmXq6'
    expect(fountainOpenUrlKind(url)).toBe('show')
    expect(fountainEmbedMinHeight(url)).toBe(120)
  })

  it('shortens og titles', () => {
    expect(
      fountainDisplayTitleFromOgTitle(
        'Bitcoin And | Bitcoin & Economic News • Bombing Strategy | Bitcoin News • Listen on Fountain'
      )
    ).toBe('Bitcoin And | Bitcoin & Economic News • Bombing Strategy | Bitcoin News')
  })

  it('rejects non-fountain hosts and invalid paths', () => {
    expect(isFountainOpenUrl('https://example.com/episode/x')).toBe(false)
    expect(isFountainOpenUrl('https://fountain.fm/')).toBe(false)
    expect(isFountainOpenUrl('https://fountain.fm/episode/')).toBe(false)
    expect(isFountainOpenUrl('https://fountain.fm/foo/bar')).toBe(false)
  })
})
