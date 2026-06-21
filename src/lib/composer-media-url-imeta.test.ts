import { describe, expect, it } from 'vitest'
import {
  buildImetaTagFromMediaUrl,
  extractPastedMediaUrl,
  inferMediaKindFromUrl,
  looksLikeComposerMediaUrl
} from './composer-media-url-imeta'
import { ExtendedKind } from '@/constants'

describe('extractPastedMediaUrl', () => {
  it('accepts a bare image URL', () => {
    expect(extractPastedMediaUrl('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg')
  })

  it('accepts markdown image syntax', () => {
    expect(extractPastedMediaUrl('![cover](https://example.com/a.png)')).toBe('https://example.com/a.png')
  })

  it('rejects multi-line non-media text', () => {
    expect(extractPastedMediaUrl('hello\nworld')).toBeNull()
  })

  it('rejects plain web pages', () => {
    expect(extractPastedMediaUrl('https://example.com/blog/post')).toBeNull()
  })
})

describe('buildImetaTagFromMediaUrl', () => {
  it('includes url and mime for images', () => {
    const tag = buildImetaTagFromMediaUrl('https://x.test/a.webp')
    expect(tag[0]).toBe('imeta')
    expect(tag).toContain('url https://x.test/a.webp')
    expect(tag).toContain('m image/webp')
  })

  it('infers voice kind for mp3', () => {
    expect(inferMediaKindFromUrl('https://x.test/track.mp3')).toBe(ExtendedKind.VOICE)
  })
})

describe('looksLikeComposerMediaUrl', () => {
  it('detects blossom blob URLs', () => {
    const hex = 'a'.repeat(64)
    expect(looksLikeComposerMediaUrl(`https://blossom.test/${hex}`)).toBe(true)
  })
})
