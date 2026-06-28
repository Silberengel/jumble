import { kinds } from 'nostr-tools'
import { ExtendedKind } from '@/constants'
import {
  filterPublishingRelayUrls,
  filterRelayUrlsForSocialKindPublish,
  isSocialKindBlockedRelayUrl
} from '@/lib/social-kind-blocked-relays'
import { describe, expect, it } from 'vitest'

describe('social-kind-blocked-relays', () => {
  it('matches essayist by hostname even with a path suffix', () => {
    expect(isSocialKindBlockedRelayUrl('wss://essayist.decentnewsroom.com/')).toBe(true)
    expect(isSocialKindBlockedRelayUrl('wss://essayist.decentnewsroom.com/npub1abc')).toBe(true)
  })

  it('strips essayist for kind 1 and reactions but not long-form', () => {
    const urls = ['wss://relay.damus.io/', 'wss://essayist.decentnewsroom.com/']
    expect(filterRelayUrlsForSocialKindPublish(urls, kinds.ShortTextNote)).toEqual([
      'wss://relay.damus.io/'
    ])
    expect(filterRelayUrlsForSocialKindPublish(urls, kinds.Reaction)).toEqual([
      'wss://relay.damus.io/'
    ])
    expect(filterRelayUrlsForSocialKindPublish(urls, kinds.LongFormArticle)).toEqual(urls)
  })

  it('filterPublishingRelayUrls applies read-only and social filters', () => {
    const out = filterPublishingRelayUrls(
      ['wss://aggr.nostr.land/', 'wss://essayist.decentnewsroom.com/', 'wss://relay.damus.io/'],
      ExtendedKind.COMMENT
    )
    expect(out).toEqual(['wss://relay.damus.io/'])
  })
})
