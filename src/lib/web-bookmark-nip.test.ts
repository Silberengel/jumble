import { ExtendedKind } from '@/constants'
import { createWebBookmarkDraftEvent } from '@/lib/draft-event'
import { getWebBookmarkArticleUrl } from '@/lib/rss-article'
import {
  expandWebBookmarkDTagQueryValues,
  urlToWebBookmarkDTag,
  webBookmarkDTagToUrl
} from '@/lib/web-bookmark-nip'
import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'

describe('web bookmark NIP-B0 d-tag', () => {
  it('round-trips URL through d-tag helpers', () => {
    const url = 'https://blog.elenarossini.com/the-untold-story/'
    const d = urlToWebBookmarkDTag(url)
    expect(d).toBe('blog.elenarossini.com/the-untold-story/')
    expect(webBookmarkDTagToUrl(d)).toBe('https://blog.elenarossini.com/the-untold-story/')
  })

  it('parses URL from d-tag-only kind 39701 events', () => {
    const event: Pick<Event, 'kind' | 'tags'> = {
      kind: ExtendedKind.WEB_BOOKMARK,
      tags: [
        [
          'd',
          'blog.elenarossini.com/the-untold-story-about-w-social-unconventional-beginnings-strategic-pitches-conflicting-signals/'
        ]
      ]
    }
    expect(getWebBookmarkArticleUrl(event)).toBe(
      'https://blog.elenarossini.com/the-untold-story-about-w-social-unconventional-beginnings-strategic-pitches-conflicting-signals/'
    )
  })

  it('prefers i/I tags over d when both are present', () => {
    const event: Pick<Event, 'kind' | 'tags'> = {
      kind: ExtendedKind.WEB_BOOKMARK,
      tags: [
        ['d', 'example.com/other'],
        ['I', 'https://example.com/preferred']
      ]
    }
    expect(getWebBookmarkArticleUrl(event)).toBe('https://example.com/preferred')
  })

  it('expands d-tag query values from a canonical article URL', () => {
    const vals = expandWebBookmarkDTagQueryValues('https://example.com/path/')
    expect(vals).toContain('example.com/path/')
    expect(vals).toContain('example.com/path')
  })

  it('creates NIP-B0 drafts with only d plus optional metadata', () => {
    const url =
      'https://www.br.de/radio/bayern2/sendungen/radioreisen/nordspanien-asturiens-menschen-und-mythen-kalksteingebirge-picos-de-europa-g-102.html'
    const minimal = createWebBookmarkDraftEvent({ url })
    expect(minimal.kind).toBe(ExtendedKind.WEB_BOOKMARK)
    expect(minimal.content).toBe('')
    expect(minimal.tags).toEqual([
      [
        'd',
        'www.br.de/radio/bayern2/sendungen/radioreisen/nordspanien-asturiens-menschen-und-mythen-kalksteingebirge-picos-de-europa-g-102.html'
      ]
    ])
    expect(minimal.tags.some((t) => t[0] === 'i' || t[0] === 'I')).toBe(false)
    expect(minimal.tags.some((t) => t[0] === 'published_at')).toBe(false)

    const full = createWebBookmarkDraftEvent({
      url,
      title: 'Nordspanien',
      note: 'Detailed description',
      topicTags: ['travel'],
      publishedAtUnix: '1738863000'
    })
    expect(full.content).toBe('Detailed description')
    expect(full.tags).toEqual([
      [
        'd',
        'www.br.de/radio/bayern2/sendungen/radioreisen/nordspanien-asturiens-menschen-und-mythen-kalksteingebirge-picos-de-europa-g-102.html'
      ],
      ['title', 'Nordspanien'],
      ['published_at', '1738863000'],
      ['t', 'travel']
    ])
  })
})
