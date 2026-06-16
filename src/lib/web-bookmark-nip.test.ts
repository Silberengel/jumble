import { ExtendedKind } from '@/constants'
import { createWebBookmarkDraftEvent } from '@/lib/draft-event'
import { getWebBookmarkArticleUrl } from '@/lib/rss-article'
import {
  expandWebBookmarkDTagQueryValues,
  getWebBookmarkReplaceableEventNaddr,
  isNostrTargetWebBookmark,
  urlToWebBookmarkDTag,
  webBookmarkDTagToUrl,
  webBookmarkNostrTargetInteractionFilters
} from '@/lib/web-bookmark-nip'
import { relayHintsForEmbeddedNotePointer } from '@/lib/event'
import { eventReferencesThreadTarget } from '@/lib/op-reference-tags'
import { threadRootRefFromStatsRootEvent } from '@/lib/op-reference-tags'
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

  it('resolves replaceable event bookmarks from a-tag or coordinate d-tag', () => {
    const coord =
      '30023:5a12b41ec15b466321e88c371be2dc47d9193f9c8bba4ab09fc50045bd35aedf:4g2mkzxv'
    const event: Pick<Event, 'kind' | 'tags'> = {
      kind: ExtendedKind.WEB_BOOKMARK,
      tags: [
        ['d', coord],
        ['a', coord, 'wss://dev.relay.edufeed.org/'],
        ['title', 'Community Hub Framework']
      ]
    }
    const naddr = getWebBookmarkReplaceableEventNaddr(event)
    expect(naddr).toMatch(/^naddr1/)
    expect(getWebBookmarkArticleUrl(event)).toBeUndefined()
  })

  it('prioritizes matching a-tag relay for embedded naddr fetch', () => {
    const coord =
      '30023:5a12b41ec15b466321e88c371be2dc47d9193f9c8bba4ab09fc50045bd35aedf:4g2mkzxv'
    const relay = 'wss://dev.relay.edufeed.org/'
    const bookmark = {
      kind: ExtendedKind.WEB_BOOKMARK,
      id: '0'.repeat(64),
      pubkey: '1'.repeat(64),
      created_at: 1,
      sig: 'sig',
      content: '',
      tags: [
        ['d', coord],
        ['a', coord, relay],
        ['title', 'Community Hub Framework']
      ]
    } as Event
    const naddr = getWebBookmarkReplaceableEventNaddr(bookmark)!
    const hints = relayHintsForEmbeddedNotePointer(naddr, bookmark)
    expect(hints[0]).toMatch(/dev\.relay\.edufeed\.org/i)
  })

  it('builds nostr-target bookmark REQ filters on replaceable coordinate', () => {
    const coord =
      '30023:5a12b41ec15b466321e88c371be2dc47d9193f9c8bba4ab09fc50045bd35aedf:4g2mkzxv'
    const filters = webBookmarkNostrTargetInteractionFilters(coord, 50)
    expect(filters).toHaveLength(3)
    expect(filters.every((f) => f.kinds?.includes(ExtendedKind.WEB_BOOKMARK))).toBe(true)
    expect(filters.some((f) => f['#a']?.includes(coord))).toBe(true)
    expect(filters.some((f) => f['#d']?.includes(coord))).toBe(true)
  })

  it('matches article thread root via a-tag coordinate', () => {
    const coord =
      '30023:5a12b41ec15b466321e88c371be2dc47d9193f9c8bba4ab09fc50045bd35aedf:4g2mkzxv'
    const article = {
      kind: 30023,
      id: 'a'.repeat(64),
      pubkey: '5a12b41ec15b466321e88c371be2dc47d9193f9c8bba4ab09fc50045bd35aedf',
      created_at: 1,
      sig: 'sig',
      content: 'article body',
      tags: [['d', '4g2mkzxv']]
    } as Event
    const bookmark = {
      kind: ExtendedKind.WEB_BOOKMARK,
      id: '0'.repeat(64),
      pubkey: '1'.repeat(64),
      created_at: 1,
      sig: 'sig',
      content: '',
      tags: [
        ['d', coord],
        ['a', coord, 'wss://dev.relay.edufeed.org/'],
        ['title', 'Community Hub Framework']
      ]
    } as Event
    expect(isNostrTargetWebBookmark(bookmark)).toBe(true)
    const rootRef = threadRootRefFromStatsRootEvent(article)
    expect(rootRef).toBeDefined()
    expect(eventReferencesThreadTarget(bookmark, rootRef!)).toBe(true)
  })
})
