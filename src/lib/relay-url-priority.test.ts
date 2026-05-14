import { describe, expect, it } from 'vitest'
import {
  buildPrioritizedReadRelayUrls,
  dedupeNormalizeRelayUrlsOrdered,
  filterContextAuthorReadRelaysForPublish
} from '@/lib/relay-url-priority'
import { buildProfilePageReadRelayUrls, getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { stripMailboxLocalUrlsForRemoteViewers } from '@/lib/relay-list-sanitize'
import { syncViewerRelayStackNostrLandAggrEligible } from '@/lib/nostr-land-relay-eligibility'

describe('filterContextAuthorReadRelaysForPublish', () => {
  it('drops loopback, LAN, and .onion; keeps public relays', () => {
    const out = filterContextAuthorReadRelaysForPublish([
      'ws://localhost:4869/',
      'wss://127.0.0.1/',
      'wss://192.168.0.5/',
      'wss://abcdefghijklmnop.onion/',
      'wss://relay.example.com/'
    ])
    expect(out).toEqual(['wss://relay.example.com/'])
  })

  it('dedupes like dedupeNormalizeRelayUrlsOrdered', () => {
    const a = dedupeNormalizeRelayUrlsOrdered(['wss://relay.example.com/', 'wss://relay.example.com/'])
    const b = filterContextAuthorReadRelaysForPublish([
      'wss://relay.example.com/',
      'wss://relay.example.com/',
      'ws://localhost:4869/'
    ])
    expect(b).toEqual(a)
  })
})

describe('stripMailboxLocalUrlsForRemoteViewers', () => {
  it('removes loopback and LAN from read/write/http fields', () => {
    const out = stripMailboxLocalUrlsForRemoteViewers({
      read: ['ws://localhost:4869/', 'wss://relay.example.com/'],
      write: ['wss://192.168.1.1/', 'wss://author-outbox.example/'],
      httpRead: ['http://127.0.0.1:8080/'],
      httpWrite: []
    })
    expect(out.read).toEqual(['wss://relay.example.com/'])
    expect(out.write).toEqual(['wss://author-outbox.example/'])
    expect(out.httpRead).toEqual([])
    expect(out.httpWrite).toEqual([])
  })
})

describe('nostr.land aggregator feed relay policy', () => {
  it('keeps aggr.nostr.land in capped read feed relay stacks when viewer uses nostr.land relays', () => {
    syncViewerRelayStackNostrLandAggrEligible(['wss://nostr.land/'])
    const out = buildPrioritizedReadRelayUrls({
      userReadRelays: [
        'wss://reader-a.example/',
        'wss://reader-b.example/',
        'wss://reader-c.example/'
      ],
      favoriteRelays: [],
      maxRelays: 3,
      applySocialKindBlockedFilter: false
    })

    expect(out).toHaveLength(3)
    expect(out[0]).toBe('wss://aggr.nostr.land/')
    syncViewerRelayStackNostrLandAggrEligible([])
  })

  it('excludes aggr.nostr.land from the favorites feed relay list', () => {
    const out = getFavoritesFeedRelayUrls(
      ['wss://relay.example.com/', 'wss://aggr.nostr.land/'],
      []
    )

    expect(out).toEqual(['wss://relay.example.com/'])
  })
})

describe('buildProfilePageReadRelayUrls', () => {
  it('includes viewed author write relays for remote profile timelines', () => {
    syncViewerRelayStackNostrLandAggrEligible(['wss://nostr.land/'])
    const out = buildProfilePageReadRelayUrls(
      [],
      [],
      {
        read: [],
        write: ['wss://author-outbox.example/']
      },
      false
    )

    expect(out).toContain('wss://author-outbox.example/')
    syncViewerRelayStackNostrLandAggrEligible([])
  })

  it('prioritizes viewed author write relays ahead of long read lists', () => {
    syncViewerRelayStackNostrLandAggrEligible(['wss://nostr.land/'])
    const out = buildProfilePageReadRelayUrls(
      [],
      [],
      {
        read: Array.from({ length: 20 }, (_, i) => `wss://author-inbox-${i}.example/`),
        write: ['wss://author-outbox.example/']
      },
      false
    )

    expect(out[0]).toBe('wss://aggr.nostr.land/')
    expect(out[1]).toBe('wss://author-outbox.example/')
    syncViewerRelayStackNostrLandAggrEligible([])
  })
})
