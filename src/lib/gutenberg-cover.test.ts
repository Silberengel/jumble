import { describe, expect, it } from 'vitest'
import {
  gutenbergCoverImageUrl,
  gutenbergEbookPageUrl,
  gutenbergLibraryCoverImageUrl,
  normalizeGutenbergCoverImageUrl,
  parseGutenbergEbookId,
  parseGutenbergEbookIdFromDTag,
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

  it('builds medium cover URL by default', () => {
    expect(gutenbergCoverImageUrl('58363')).toBe(
      'https://www.gutenberg.org/cache/epub/58363/pg58363.cover.medium.jpg'
    )
    expect(gutenbergCoverImageUrl('58363', 'small')).toBe(
      'https://www.gutenberg.org/cache/epub/58363/pg58363.cover.small.jpg'
    )
  })

  it('gutenbergLibraryCoverImageUrl prefers small covers for library grids', () => {
    expect(
      gutenbergLibraryCoverImageUrl(
        'https://www.gutenberg.org/cache/epub/58363/pg58363.cover.medium.jpg'
      )
    ).toBe('https://www.gutenberg.org/cache/epub/58363/pg58363.cover.small.jpg')
    expect(gutenbergLibraryCoverImageUrl('https://example.com/cover.jpg')).toBe(
      'https://example.com/cover.jpg'
    )
  })

  it('resolveGutenbergCoverImageUrl requires gutenberg source', () => {
    expect(
      resolveGutenbergCoverImageUrl('https://www.gutenberg.org/ebooks/58363')
    ).toBe('https://www.gutenberg.org/cache/epub/58363/pg58363.cover.medium.jpg')
    expect(resolveGutenbergCoverImageUrl('https://example.com/book')).toBeUndefined()
  })

  it('parses ebook id from legacy pg-prefixed d-tags', () => {
    expect(parseGutenbergEbookIdFromDTag('pg28217-dante-et-goethe-dialogues')).toBe('28217')
    expect(parseGutenbergEbookIdFromDTag('pg28217')).toBe('28217')
    expect(parseGutenbergEbookIdFromDTag('jane-eyre')).toBeNull()
  })

  it('builds gutenberg.org ebook page URL', () => {
    expect(gutenbergEbookPageUrl('28217')).toBe('https://www.gutenberg.org/ebooks/28217')
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
