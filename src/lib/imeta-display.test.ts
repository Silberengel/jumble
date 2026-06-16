import { describe, expect, it } from 'vitest'
import {
  aspectRatioStyleFromDim,
  buildImetaDimMap,
  imetaPreviewImageUrl
} from './imeta-display'

describe('aspectRatioStyleFromDim', () => {
  it('returns aspect-ratio CSS from valid dim', () => {
    expect(aspectRatioStyleFromDim({ width: 1920, height: 1080 })).toEqual({
      aspectRatio: '1920 / 1080'
    })
  })

  it('ignores invalid dim', () => {
    expect(aspectRatioStyleFromDim(undefined)).toBeUndefined()
    expect(aspectRatioStyleFromDim({ width: 0, height: 100 })).toBeUndefined()
  })
})

describe('imetaPreviewImageUrl', () => {
  it('prefers thumb over image when both are valid images', () => {
    expect(
      imetaPreviewImageUrl({
        url: 'https://example.com/photo.jpg',
        thumb: 'https://example.com/thumb.jpg',
        image: 'https://example.com/poster.jpg'
      })
    ).toBe('https://example.com/thumb.jpg')
  })

  it('skips thumb identical to main url', () => {
    const url = 'https://example.com/same.jpg'
    expect(imetaPreviewImageUrl({ url, thumb: url })).toBeUndefined()
  })

  it('skips video thumb urls and uses image poster', () => {
    expect(
      imetaPreviewImageUrl({
        url: 'https://example.com/video.mp4',
        thumb: 'https://example.com/video.mp4',
        image: 'https://example.com/poster.jpg'
      })
    ).toBe('https://example.com/poster.jpg')
  })
})

describe('buildImetaDimMap', () => {
  it('maps cleaned urls to dim', () => {
    const map = buildImetaDimMap([
      { url: 'https://example.com/a.mp4', dim: { width: 1280, height: 720 } }
    ])
    expect(map.get('https://example.com/a.mp4')).toEqual({ width: 1280, height: 720 })
  })
})
