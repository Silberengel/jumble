import { ExtendedKind } from '@/constants'
import {
  buildRssArticleUrlThreadInteractionFilterGroups,
  isRssArticleUrlThreadInteraction,
  isRssUrlThreadAntwortenTailKind
} from '@/lib/rss-web-feed'
import { describe, expect, it } from 'vitest'
import { kinds, type Event } from 'nostr-tools'

function fakeEvent(partial: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    content: '',
    sig: 'sig',
    ...partial
  }
}

describe('RSS URL thread responses', () => {
  const url = 'https://github.com/nostr-protocol/nips/blob/master/B0.md'

  it('matches comments, highlights, web bookmarks, and page reactions', () => {
    expect(
      isRssArticleUrlThreadInteraction(
        fakeEvent({
          kind: ExtendedKind.COMMENT,
          tags: [['i', url]]
        }),
        url
      )
    ).toBe(true)
    expect(
      isRssArticleUrlThreadInteraction(
        fakeEvent({
          kind: kinds.Highlights,
          tags: [['r', url]]
        }),
        url
      )
    ).toBe(true)
    expect(
      isRssArticleUrlThreadInteraction(
        fakeEvent({
          kind: ExtendedKind.WEB_BOOKMARK,
          tags: [['d', 'github.com/nostr-protocol/nips/blob/master/B0.md']]
        }),
        url
      )
    ).toBe(true)
    expect(
      isRssArticleUrlThreadInteraction(
        fakeEvent({
          kind: kinds.Reaction,
          tags: [['r', url], ['e', 'c'.repeat(64)]]
        }),
        url
      )
    ).toBe(true)
  })

  it('rejects unrelated kinds on the same URL scope', () => {
    expect(
      isRssArticleUrlThreadInteraction(
        fakeEvent({ kind: ExtendedKind.EXTERNAL_REACTION, tags: [['i', url]] }),
        url
      )
    ).toBe(false)
  })

  it('requests web bookmarks by d-tag and legacy i/I tags', () => {
    const { nonSocial } = buildRssArticleUrlThreadInteractionFilterGroups(url, 20)
    expect(nonSocial.some((f) => f.kinds?.includes(ExtendedKind.WEB_BOOKMARK) && f['#d'])).toBe(true)
    expect(nonSocial.some((f) => f.kinds?.includes(ExtendedKind.WEB_BOOKMARK) && f['#i'])).toBe(true)
    expect(nonSocial.some((f) => f.kinds?.includes(kinds.Reaction) && f['#r'])).toBe(true)
    expect(nonSocial.some((f) => f.kinds?.includes(kinds.Highlights) && f['#r'])).toBe(true)
  })

  it('classifies tail kinds for URL thread layout', () => {
    expect(isRssUrlThreadAntwortenTailKind(kinds.Highlights)).toBe(true)
    expect(isRssUrlThreadAntwortenTailKind(ExtendedKind.WEB_BOOKMARK)).toBe(true)
    expect(isRssUrlThreadAntwortenTailKind(kinds.Reaction)).toBe(true)
    expect(isRssUrlThreadAntwortenTailKind(ExtendedKind.COMMENT)).toBe(false)
  })
})
