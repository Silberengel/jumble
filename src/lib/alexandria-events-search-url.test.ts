import { describe, expect, it } from 'vitest'
import {
  ALEXANDRIA_NEXT_EVENTS_BASE,
  buildAlexandriaEventsSearchUrlForTSearchParams
} from './alexandria-events-search-url'

describe('buildAlexandriaEventsSearchUrlForTSearchParams', () => {
  it('maps profile search to n= query', () => {
    const url = buildAlexandriaEventsSearchUrlForTSearchParams({
      type: 'profile',
      search: 'npub1test'
    })
    expect(url).toBe(`${ALEXANDRIA_NEXT_EVENTS_BASE}?n=npub1test`)
  })

  it('maps hashtag search to t= query', () => {
    const url = buildAlexandriaEventsSearchUrlForTSearchParams({
      type: 'hashtag',
      search: 'nostr'
    })
    expect(url).toBe(`${ALEXANDRIA_NEXT_EVENTS_BASE}?t=nostr`)
  })

  it('maps relay search to q= query', () => {
    const url = buildAlexandriaEventsSearchUrlForTSearchParams({
      type: 'relay',
      search: 'wss://relay.example.com'
    })
    expect(url).toBe(`${ALEXANDRIA_NEXT_EVENTS_BASE}?q=wss%3A%2F%2Frelay.example.com`)
  })

  it('maps notes search to free-text q= when no special tokens', () => {
    const url = buildAlexandriaEventsSearchUrlForTSearchParams({
      type: 'notes',
      search: 'hello world'
    })
    expect(url).toBe(`${ALEXANDRIA_NEXT_EVENTS_BASE}?q=hello%20world`)
  })
})
