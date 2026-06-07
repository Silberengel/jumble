import { describe, expect, it } from 'vitest'
import {
  gutenbergCoverImageUrl,
  normalizeGutenbergCoverImageUrl,
  parseGutenbergEbookId,
  resolveGutenbergCoverImageUrl
} from '@/lib/gutenberg-cover'

describe('gutenberg-cover', () => {
  it('parses ebook id from gutenberg.org URLs', () => {
    expect(parseGutenbergEbookId('https://www.gutenberg.org/ebooks/58363')).toBe('58363')
    expect(parseGutenbergEbookId('https://www.gutenberg.org/ebooks/58363/')).toBe('58363')
    expect(parseGutenbergEbookId('https://www.gutenberg.org/files/21020/21020-h/21020-h.htm')).toBe(
      '21020'
    )
    expect(
      parseGutenbergEbookId('https://www.gutenberg.org/cache/epub/16702/pg16702.cover.medium.jpg')
    ).toBe('16702')
  })

  it('builds medium cover URL', () => {
    expect(gutenbergCoverImageUrl('58363')).toBe(
      'https://www.gutenberg.org/cache/epub/58363/pg58363.cover.medium.jpg'
    )
  })

  it('resolveGutenbergCoverImageUrl requires gutenberg source', () => {
    expect(
      resolveGutenbergCoverImageUrl('https://www.gutenberg.org/ebooks/58363')
    ).toBe('https://www.gutenberg.org/cache/epub/58363/pg58363.cover.medium.jpg')
    expect(resolveGutenbergCoverImageUrl('https://example.com/book')).toBeUndefined()
  })

  it('normalizeGutenbergCoverImageUrl converts ebook pages to cover JPG', () => {
    expect(normalizeGutenbergCoverImageUrl('https://www.gutenberg.org/ebooks/16702')).toBe(
      'https://www.gutenberg.org/cache/epub/16702/pg16702.cover.medium.jpg'
    )
    expect(
      normalizeGutenbergCoverImageUrl(
        'https://www.gutenberg.org/cache/epub/16702/pg16702.cover.medium.jpg'
      )
    ).toBe('https://www.gutenberg.org/cache/epub/16702/pg16702.cover.medium.jpg')
    expect(normalizeGutenbergCoverImageUrl('https://example.com/cover.jpg')).toBe(
      'https://example.com/cover.jpg'
    )
  })
})
