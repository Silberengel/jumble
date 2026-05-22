import { describe, expect, it } from 'vitest'
import {
  filterViewerBlockedRelaysForFetch,
  parseBlockedRelayUrlsFromEvent,
  setViewerBlockedRelayUrls
} from './viewer-blocked-relays'

describe('viewer-blocked-relays', () => {
  it('parseBlockedRelayUrlsFromEvent dedupes relay tags', () => {
    setViewerBlockedRelayUrls([])
    const urls = parseBlockedRelayUrlsFromEvent({
      kind: 10006,
      tags: [
        ['relay', 'wss://freelay.sovbit.host/'],
        ['relay', 'wss://freelay.sovbit.host']
      ],
      content: '',
      created_at: 1,
      id: 'x',
      pubkey: 'p',
      sig: 's'
    })
    expect(urls).toEqual(['wss://freelay.sovbit.host/'])
  })

  it('filterViewerBlockedRelaysForFetch matches hostname across schemes', () => {
    setViewerBlockedRelayUrls(['wss://freelay.sovbit.host/'])
    expect(
      filterViewerBlockedRelaysForFetch([
        'wss://freelay.sovbit.host/',
        'wss://relay.example.com/',
        'https://freelay.sovbit.host/'
      ])
    ).toEqual(['wss://relay.example.com/'])
  })
})
